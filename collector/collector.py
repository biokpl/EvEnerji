"""Ev Enerji toplayıcı servisi (Raspberry Pi, systemd: ev-enerji).

Döngü (poll_seconds, varsayılan 10 sn):
  - kayıtlı her cihazı okur, enerjiyi biriktirir, araç şarj oturumlarını ayırır
  - canlı değerleri Firebase'e yazar; dakikada bir saat/gün/ay toplamlarını yazar
  - uygulamadan gelen imzalı komutları uygular (priz aç/kapa, kablo sarıcı)
  - limit / şarj / güvenlik bildirimlerini ntfy ile gönderir

Firebase düzeni (base_path altında):
  devices/{id}        uygulamanın düzenlediği meta (ad, tür, oda, ikon, renk, enabled)
  live/{id}           anlık w, v, a, on, ts, ok
  hours/{id}/{gün}    24 elemanlı kWh dizisi
  days/{id}/{gün}     kWh
  months/{id}/{yyyy-mm}  kWh
  sessions/{id}/{oturum}  araç şarj oturumları
  settings/...        tarife, faturalar, uyarı eşikleri (uygulama yazar)
  commands/{push}     imzalı komutlar (Pi uygular ve siler)
  winder/state|cmd    kablo sarıcı (ESP32) durumu ve komutu
  discovered/{id}     Tuya bulutunda bulunan ama henüz eklenmemiş prizler
  status              servis kalp atışı
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import signal
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from fb import FB
from meter import DeviceMeter, SessionTracker, day_key, merge_months
from notify import Notifier
from providers import Reading, make_provider
from tariff import Tarife, birim_fiyat, gunluk_butce, yil_durumu, yil_sonu_tahmini

HERE = Path(__file__).resolve().parent
CFG_FILE = HERE / "config.json"
LOCAL_FILE = HERE / "devices_local.json"
STATE_FILE = HERE / "state.json"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])
log = logging.getLogger("collector")

WINDER_BLOCKS_CHARGE = {"sarili", "sariyor", "aciliyor", "hata"}


def load_json(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def save_json(p: Path, data) -> None:
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, p)


def fmt_tl(x: float) -> str:
    s = f"{x:,.0f}".replace(",", ".")
    return f"{s} TL"


def fmt_kwh(x: float) -> str:
    return f"{x:.1f}".replace(".", ",") + " kWh"


class Collector:
    def __init__(self):
        self.cfg = load_json(CFG_FILE, None)
        if not self.cfg:
            sys.exit(f"{CFG_FILE} yok: config.example.json'u kopyalayıp doldur.")
        self.fb = FB(self.cfg["firebase_url"], self.cfg.get("base_path", ""),
                     self.cfg.get("firebase_secret", ""))
        self.ntfy = Notifier(self.cfg.get("ntfy_topic", ""), self.cfg.get("app_url", ""))
        self.poll = float(self.cfg.get("poll_seconds", 10))
        self.flush_every = float(self.cfg.get("flush_seconds", 60))
        self.secret = (self.cfg.get("control_secret") or "").encode()
        self.state = load_json(STATE_FILE, {})
        self.state.setdefault("meters", {})
        self.state.setdefault("alerts", {})
        self.state.setdefault("hi_amp_since", {})
        self.meta: dict = {}
        self.providers: dict = {}
        self.shared: dict = {}
        self.meters: dict[str, DeviceMeter] = {}
        self.sessions: dict[str, SessionTracker] = {}
        self.settings: dict = {}
        self.winder: dict = {}
        self.live: dict[str, Reading] = {}
        self.live_ts: dict[str, float] = {}
        self.used_nonces: dict[str, float] = {}
        self.t_flush = self.t_meta = self.t_cmd = self.t_disc = 0.0
        self.running = True

    # ------------------------------------------------------------ cihazlar
    def refresh_devices(self):
        meta = self.fb.safe(self.fb.get, "devices") or {}
        local = load_json(LOCAL_FILE, {})
        # devices_local'da olup Firebase'de metası olmayanları varsayılanla yayınla
        for did, loc in local.items():
            if did not in meta and loc.get("default_meta"):
                meta[did] = {**loc["default_meta"], "enabled": True}
                self.fb.safe(self.fb.put, f"devices/{did}", meta[did])
        self.meta = meta
        self.settings = self.fb.safe(self.fb.get, "settings") or self.settings
        self.winder = self.fb.safe(self.fb.get, "winder/state") or {}
        for did, m in meta.items():
            if not m.get("enabled") or m.get("provider") == "esp32":
                self.providers.pop(did, None)
                continue
            if did in self.providers:
                continue
            if did not in local:
                log.warning("%s için devices_local.json kaydı yok (discover.py çalıştır)", did)
                continue
            try:
                self.providers[did] = make_provider(did, local[did], self.cfg, self.shared)
                self.meters[did] = DeviceMeter(did, self.state["meters"], self.poll)
                if m.get("type") == "ev_sarj":
                    self.sessions[did] = SessionTracker(self.state.setdefault(f"sess_{did}", {}))
                log.info("Cihaz eklendi: %s (%s)", m.get("name", did), local[did]["provider"])
            except Exception as e:
                log.error("%s başlatılamadı: %s", did, e)

    # ------------------------------------------------------------ tarife / özet
    def home_id(self) -> str | None:
        for did, m in self.meta.items():
            if m.get("type") == "ana_sayac" and m.get("enabled"):
                return did
        return None

    def year_months(self, year: int) -> list[float]:
        hid = self.home_id()
        meter = {}
        if hid and hid in self.meters:
            for m in range(1, 13):
                meter[f"{m:02d}"] = self.meters[hid].month_total(f"{year}-{m:02d}")
        bills = (self.settings.get("bills") or {}).get(str(year), {})
        return merge_months(bills, meter)

    def tariff(self, year: int) -> Tarife:
        return Tarife.from_dict(year, (self.settings.get("tariff") or {}).get(str(year)))

    def price_now(self) -> tuple[float, float]:
        today = date.today()
        t = self.tariff(today.year)
        d = yil_durumu(t, self.year_months(today.year))
        return birim_fiyat(t, d, today.month), t.sktt_tl

    # ------------------------------------------------------------ okuma döngüsü
    def poll_once(self):
        now = time.time()
        live_out = {}
        for did, prov in list(self.providers.items()):
            r: Reading = prov.read()
            m = self.meta.get(did, {})
            w = r.w if r.ok else None
            # okunamazsa 60 sn'ye kadar son değeri sürdür
            if w is None:
                prev = self.live.get(did)
                if prev and now - self.live_ts.get(did, 0) < 60:
                    w = prev.w
            added = self.meters[did].add(now, w)
            if r.ok:
                self.live[did] = r
                self.live_ts[did] = now
            live_out[did] = {"ok": r.ok, "on": r.on, "w": round(r.w or 0, 1),
                             "v": None if r.v is None else round(r.v, 1),
                             "a": None if r.a is None else round(r.a, 3),
                             "ts": int(now), "err": r.err,
                             "today": round(self.meters[did].st["days"].get(day_key(now), 0), 4)}
            if did in self.sessions:
                ev, sess = self.sessions[did].update(now, w, added)
                if sess:
                    live_out[did]["session"] = {"id": sess["id"], "start": sess["start"],
                                                "kwh": round(sess["kwh"], 4)}
                if ev == "basladi":
                    self.on_session_start(did, m, sess)
                elif ev == "bitti":
                    self.on_session_end(did, m, sess)
            self.check_safety(did, m, r, now)
        if live_out:
            self.fb.safe(self.fb.patch, "live", live_out)

    def on_session_start(self, did, m, s):
        log.info("Şarj başladı: %s", s["id"])
        self.fb.safe(self.fb.put, f"sessions/{did}/{s['id']}", s)
        self.ntfy.send(f"{m.get('name', 'Araç')} şarjı başladı",
                       f"Saat {datetime.fromtimestamp(s['start']):%H:%M}. Bitince özet gelecek.",
                       tags="electric_plug", priority=2, open_tab="togg")

    def on_session_end(self, did, m, s):
        price, sktt = self.price_now()
        dur = (s["end"] - s["start"]) / 60
        s.update({"kwh": round(s["kwh"], 3), "birim_tl": price, "tl": round(s["kwh"] * price, 2),
                  "tl_sktt": round(s["kwh"] * sktt, 2), "minutes": round(dur),
                  "avg_w": round(s["kwh"] * 60000 / dur) if dur > 0 else 0})
        s.pop("last_w", None)
        log.info("Şarj bitti: %s %.2f kWh", s["id"], s["kwh"])
        self.fb.safe(self.fb.put, f"sessions/{did}/{s['id']}", s)
        h, mi = divmod(int(dur), 60)
        msg = f"{fmt_kwh(s['kwh'])} · {fmt_tl(s['tl'])} · {h} sa {mi} dk"
        if self.winder.get("online") and self.winder.get("state") == "acik":
            msg += "\nKablo açıkta: uygulamadan sarabilirsin."
        self.ntfy.send(f"{m.get('name', 'Araç')} şarjı bitti", msg, tags="white_check_mark",
                       open_tab="togg")

    def check_safety(self, did, m, r: Reading, now):
        sf = self.cfg.get("safety", {})
        lim = float(m.get("max_amp") or sf.get("max_amp", 16)) * float(sf.get("warn_ratio", 0.85))
        since = self.state["hi_amp_since"]
        if r.ok and r.a and r.a >= lim:
            since.setdefault(did, now)
            mins = (now - since[did]) / 60
            key = f"amp_{did}_{day_key(now)}"
            if mins >= float(sf.get("warn_minutes", 30)) and not self.state["alerts"].get(key):
                self.state["alerts"][key] = True
                self.ntfy.send("Yüksek akım uyarısı",
                               f"{m.get('name', did)} {int(mins)} dakikadır {r.a:.1f} A çekiyor. "
                               "Fiş ve prizin ısınmasını kontrol et.",
                               tags="warning", priority=4, open_tab="cihazlar")
        else:
            since.pop(did, None)

    # ------------------------------------------------------------ dakikalık yazım
    def flush(self):
        now = time.time()
        today = date.today()
        ym = today.strftime("%Y-%m")
        upd = {}
        cutoff = (today - timedelta(days=800)).isoformat()
        for did, mtr in self.meters.items():
            for dk, arr in mtr.st["hours"].items():
                upd[f"hours/{did}/{dk}"] = [round(x, 4) for x in arr]
            for dk in [k for k in mtr.st["days"] if k < cutoff]:
                del mtr.st["days"][dk]
            for dk in sorted(mtr.st["days"])[-2:]:
                upd[f"days/{did}/{dk}"] = round(mtr.st["days"][dk], 4)
            upd[f"months/{did}/{ym}"] = round(mtr.month_total(ym), 3)
            sess = self.sessions.get(did)
            if sess and sess.active:
                a = sess.active
                upd[f"sessions/{did}/{a['id']}/kwh"] = round(a["kwh"], 3)
                upd[f"sessions/{did}/{a['id']}/peak_w"] = a["peak_w"]
        upd["status"] = {"ts": int(now), "devices": len(self.providers),
                         "ntfy": self.cfg.get("ntfy_topic", ""),
                         "host": os.uname().nodename if hasattr(os, "uname") else "pc"}
        self.fb.safe(self.fb.patch, "", upd)
        save_json(STATE_FILE, self.state)
        self.check_limits()

    def check_limits(self):
        if not self.home_id():
            return
        today = date.today()
        y = today.year
        t = self.tariff(y)
        months = self.year_months(y)
        ytd = sum(months)
        hid = self.home_id()
        son30 = sum(v for k, v in self.meters[hid].st["days"].items()
                    if k >= (today - timedelta(days=30)).isoformat())
        bas = ((self.settings.get("tariff") or {}).get(str(y)) or {}).get("baslangic")
        try:
            bas = date.fromisoformat(bas) if bas else None
        except ValueError:
            bas = None
        proj = yil_sonu_tahmini(ytd, son30, today, bas)
        al = self.state["alerts"]
        esikler = (self.settings.get("alerts") or {}).get("esikler", [70, 85, 95])
        for e in sorted(esikler):
            key = f"esik_{y}_{e}"
            if ytd >= t.limit_kwh * e / 100 and not al.get(key):
                al[key] = True
                self.ntfy.send(f"Yıllık limitin %{e}'i doldu",
                               f"{y}: {fmt_kwh(ytd)} / {fmt_kwh(t.limit_kwh)}. "
                               f"Günlük bütçe: {fmt_kwh(gunluk_butce(t.limit_kwh, ytd, today))}.",
                               tags="chart_with_upwards_trend", priority=4 if e >= 85 else 3,
                               open_tab="pano")
        key = f"tahmin_{today:%Y-%m}"
        if proj > t.limit_kwh and ytd < t.limit_kwh and not al.get(key):
            al[key] = True
            self.ntfy.send("Yıl sonu tahmini limiti aşıyor",
                           f"Bu gidişle {y} sonu ≈ {fmt_kwh(proj)} (limit {fmt_kwh(t.limit_kwh)}).",
                           tags="warning", priority=4, open_tab="pano")

    # ------------------------------------------------------------ komutlar
    def verify(self, c: dict) -> bool:
        if not self.secret:
            return False
        try:
            ts = int(c["ts"])
            nonce = str(c["nonce"])
            msg = f"{c['device']}|{c['action']}|{ts}|{nonce}".encode()
            ok = hmac.compare_digest(hmac.new(self.secret, msg, hashlib.sha256).hexdigest(),
                                     str(c["sig"]))
        except (KeyError, ValueError, TypeError):
            return False
        now = time.time()
        if not ok or abs(now - ts / 1000) > 120 or nonce in self.used_nonces:
            return False
        self.used_nonces[nonce] = now
        for k in [k for k, v in self.used_nonces.items() if now - v > 300]:
            del self.used_nonces[k]
        return True

    def run_commands(self):
        cmds = self.fb.safe(self.fb.get, "commands") or {}
        for key, c in list(cmds.items()):
            res = {"ok": False, "ts": int(time.time() * 1000)}
            try:
                if not isinstance(c, dict) or not self.verify(c):
                    res["msg"] = "İmza geçersiz (Ayarlar > Kontrol anahtarı)"
                else:
                    res.update(self.execute(c["device"], c["action"]))
            except Exception as e:
                res["msg"] = str(e)
            log.info("Komut %s -> %s", c, res)
            self.fb.safe(self.fb.put, f"command_results/{key}", res)
            self.fb.safe(self.fb.delete, f"commands/{key}")

    def execute(self, did: str, action: str) -> dict:
        if did == "sarici":
            if action not in ("sar", "ac", "dur", "kalibre"):
                return {"msg": "Geçersiz sarıcı komutu"}
            if action in ("sar", "ac"):
                for cid, m in self.meta.items():
                    lv = self.live.get(cid)
                    if m.get("type") == "ev_sarj" and lv and (lv.w or 0) > 50:
                        return {"msg": "Şarj sürüyor; önce şarjı bitir."}
            self.fb.put("winder/cmd", {"action": action, "ts": int(time.time() * 1000)})
            return {"ok": True, "msg": "Sarıcıya iletildi"}
        m = self.meta.get(did)
        prov = self.providers.get(did)
        if not m or not prov:
            return {"msg": "Cihaz çevrimdışı ya da kayıtlı değil"}
        if not getattr(prov, "can_switch", False):
            return {"msg": "Bu cihaz uzaktan anahtarlanamaz"}
        if action not in ("on", "off"):
            return {"msg": "Geçersiz komut"}
        if action == "on" and m.get("type") == "ev_sarj" and self.winder.get("online") \
                and self.winder.get("state") in WINDER_BLOCKS_CHARGE:
            return {"msg": "Kablo sarılı/hareket halinde; önce kabloyu aç."}
        prov.set_switch(action == "on")
        return {"ok": True, "msg": "Açıldı" if action == "on" else "Kapatıldı"}

    # ------------------------------------------------------------ keşif
    def discover(self):
        tc = self.cfg.get("tuya_cloud") or {}
        if not tc.get("api_key"):
            return
        try:
            import discover
            new = discover.sync(tc, LOCAL_FILE, set(self.meta))
            if new:
                self.fb.safe(self.fb.patch, "discovered", new)
        except Exception as e:
            log.warning("Keşif hatası: %s", e)

    # ------------------------------------------------------------ ana döngü
    def run(self):
        signal.signal(signal.SIGTERM, lambda *_: setattr(self, "running", False))
        log.info("Ev Enerji toplayıcı başladı")
        self.refresh_devices()          # önce kayıtlı cihazlar: keşif bunları "yeni" saymasın
        self.t_meta = time.time()
        self.discover()
        self.t_disc = time.time()
        while self.running:
            t0 = time.time()
            if t0 - self.t_meta >= 60:
                self.refresh_devices()
                self.t_meta = t0
            self.poll_once()
            if t0 - self.t_flush >= self.flush_every:
                self.flush()
                self.t_flush = t0
            if t0 - self.t_disc >= 6 * 3600:
                self.discover()
                self.t_disc = t0
            # komutlar ölçüm aralığı içinde de hızlı kontrol edilir
            while self.running and time.time() - t0 < self.poll:
                if time.time() - self.t_cmd >= 3:
                    self.run_commands()
                    self.t_cmd = time.time()
                time.sleep(0.5)
        self.flush()
        log.info("Durdu")


if __name__ == "__main__":
    Collector().run()
