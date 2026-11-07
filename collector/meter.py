"""Enerji biriktirme ve şarj oturumu algılama (saf mantık, test edilebilir).

Enerji = güç x süre (iki ölçüm arasında yamuk kuralı).

Kopukluk (Pi kapalı, modem/Wi-Fi yok) — prizler bu sırada çalışmaya devam eder:
  - 10 dk'ya kadar: öncesi ve sonrası güçlerin ortalaması sürmüş sayılır.
  - 10 dk – 3 saat, güç önce ve sonra "sabit ve yüksek" ise (araç şarjı gibi: ikisi de
    >= 300 W ve birbirine %25 yakın): ortalama güçle doldurulur.
  - Diğer durumlarda 12 saate kadar: iki güçten KÜÇÜĞÜ sürmüş sayılır (temkinli alt sınır;
    ör. ev taban yükü). Daha uzun boşluk doldurulmaz.
  Doldurulan enerji kesintinin denk geldiği saatlere dağıtılır ve "est" altında toplanır.
"""
from __future__ import annotations

from datetime import datetime, timedelta

GAP_MAX_S = 600              # bu kadarına kadar ortalama güç (eski davranış)
GAP_STEADY_MAX_S = 3 * 3600  # sabit yüksek güçte (şarj) ortalamayla doldurma sınırı
GAP_BASE_MAX_S = 12 * 3600   # küçük güçle temkinli doldurma sınırı
GAP_STEADY_W = 300
GAP_STEADY_RATIO = 0.75

# Şarj oturumu eşikleri (Mennekes 10 A ≈ 2,2 kW)
SESSION_START_W = 300
SESSION_START_N = 2          # art arda en az kaç ölçüm
SESSION_START_S = 10         # ve en az kaç saniye (ölçüm sıklığından bağımsız olsun)
SESSION_END_W = 50
SESSION_END_S = 120          # kademeli bitiş (araç doldu): bu kadar süre düşük güç -> bitti
SESSION_END_FAST_S = 30      # ani düşüş (kablo çekildi / araçtan durduruldu): daha çabuk bitti
SESSION_RESUME_S = 900       # bittikten sonra bu süre içinde yeniden başlarsa aynı şarjın devamı sayılır
SESSION_MIN_KWH = 0.05       # bundan küçükse oturum sayılmaz
FULL_TAIL_RATIO = 0.6        # bitişten önceki son güç tepenin bu oranından düşükse: araç doldu


def day_key(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")


class DeviceMeter:
    def __init__(self, dev_id: str, state: dict, poll_s: float):
        self.id = dev_id
        self.st = state.setdefault(dev_id, {"last_ts": None, "last_w": None,
                                            "hours": {}, "days": {}})
        self.poll_s = poll_s
        self.last_gap: dict | None = None      # son doldurulan kesinti (günlüğe yazmak için)

    def add(self, ts: float, w: float | None) -> float:
        """Ölçüm ekler, bu aralıkta biriken kWh'yi döndürür."""
        st = self.st
        added = 0.0
        if w is not None and st["last_ts"] is not None and st["last_w"] is not None:
            t0, w0 = st["last_ts"], st["last_w"]
            dt = ts - t0
            if 0 < dt <= GAP_MAX_S:
                added = (w0 + w) / 2.0 * dt / 3_600_000.0
                self._book(ts, added)
            elif dt > GAP_MAX_S:
                lo, hi = min(w0, w), max(w0, w)
                if dt <= GAP_STEADY_MAX_S and lo >= GAP_STEADY_W and lo >= GAP_STEADY_RATIO * hi:
                    p, tur = (w0 + w) / 2.0, "sabit"
                elif dt <= GAP_BASE_MAX_S:
                    p, tur = lo, "taban"
                else:
                    p, tur = 0.0, "yok"
                added = p * dt / 3_600_000.0
                if added > 0:
                    self._book_span(t0, ts, added)
                    st["est"] = round(st.get("est", 0.0) + added, 4)
                self.last_gap = {"bas": t0, "bit": ts, "kwh": added, "tur": tur}
        if w is not None:
            st["last_ts"], st["last_w"] = ts, w
        return added

    def _book_span(self, t0: float, t1: float, kwh: float) -> None:
        """kWh'yi [t0, t1) aralığının saatlerine orantılı dağıtır."""
        t = t0
        while t < t1:
            d = datetime.fromtimestamp(t).replace(minute=0, second=0, microsecond=0)
            nxt = min(t1, (d + timedelta(hours=1)).timestamp())
            self._book(t, kwh * (nxt - t) / (t1 - t0))
            t = nxt

    def _book(self, ts: float, kwh: float) -> None:
        d = datetime.fromtimestamp(ts)
        dk = d.strftime("%Y-%m-%d")
        hours = self.st["hours"].setdefault(dk, [0.0] * 24)
        hours[d.hour] += kwh
        self.st["days"][dk] = self.st["days"].get(dk, 0.0) + kwh
        # yalnız bugün ve dün saatlik tutulur
        for k in sorted(self.st["hours"])[:-2]:
            del self.st["hours"][k]

    def month_total(self, ym: str) -> float:
        return sum(v for k, v in self.st["days"].items() if k.startswith(ym))


class SessionTracker:
    """Araç şarj oturumlarını güç eğrisinden ayırır."""

    def __init__(self, state: dict):
        self.st = state.setdefault("session", {"active": None, "hi_n": 0, "hi_first": None,
                                               "low_since": None})

    @property
    def active(self) -> dict | None:
        return self.st["active"]

    def update(self, ts: float, w: float | None, kwh_added: float) -> tuple[str | None, dict | None]:
        """('basladi'|'devam'|'bitti'|None, oturum) döndürür.
        'devam': az önce biten şarj SESSION_RESUME_S içinde yeniden başladı (duraklama / fişi çekip takma),
        aynı oturum yeniden açıldı."""
        st = self.st
        if w is None:
            if st["active"]:
                st["active"]["kwh"] += kwh_added
            return None, st["active"]
        a = st["active"]
        if a is None:
            if w >= SESSION_START_W:
                st["hi_n"] += 1
                st["hi_first"] = st["hi_first"] or ts
                if st["hi_n"] >= SESSION_START_N and ts - st["hi_first"] >= SESSION_START_S:
                    son = st.get("son")
                    if son and st["hi_first"] - son["end"] <= SESSION_RESUME_S:
                        son.update({"active": True, "end": None, "last_w": w})
                        son.pop("full", None)
                        son["kwh"] += kwh_added
                        st["active"], st["son"] = son, None
                        st["hi_n"], st["hi_first"], st["low_since"] = 0, None, None
                        return "devam", son
                    st["son"] = None
                    start = st["hi_first"]
                    st["active"] = {
                        "id": datetime.fromtimestamp(start).strftime("%Y%m%d-%H%M"),
                        "start": int(start), "end": None, "kwh": kwh_added,
                        "peak_w": w, "last_w": w, "active": True}
                    st["hi_n"], st["hi_first"], st["low_since"] = 0, None, None
                    return "basladi", st["active"]
            else:
                st["hi_n"], st["hi_first"] = 0, None
            return None, None
        a["kwh"] += kwh_added
        a["peak_w"] = max(a["peak_w"], w)
        a["last_w"] = w
        if w >= SESSION_END_W:
            a["tail_w"] = w          # şarj sürerken görülen son güç
        if w < SESSION_END_W:
            st["low_since"] = st["low_since"] or ts
            # son şarj gücü tepeye yakınken birden düştüyse kablo çekilmiştir: çabuk bitir (kısa duraklama olursa
            # SESSION_RESUME_S içinde aynı oturum devam eder)
            ani = a.get("tail_w") is not None and a["tail_w"] >= FULL_TAIL_RATIO * a["peak_w"]
            if ts - st["low_since"] >= (SESSION_END_FAST_S if ani else SESSION_END_S):
                a["end"] = int(st["low_since"])
                a["active"] = False
                # Araç hedefine ulaşınca gücü kademeli düşürür (son güç tepenin çok altında);
                # fiş çekilince güç birden kesilir (son güç ≈ tepe)
                tail = a.pop("tail_w", None)
                a["full"] = bool(tail is not None and tail < FULL_TAIL_RATIO * a["peak_w"])
                st["active"], st["low_since"] = None, None
                if a["kwh"] < SESSION_MIN_KWH:
                    return None, None
                st["son"] = dict(a)          # 15 dk içinde yeniden başlarsa devam ettirilir
                return "bitti", a
        else:
            st["low_since"] = None
        return None, a


# Priz "iş" algılama (çamaşır, kurutma, yazıcı...): güç bir süre yüksek kalıp beklemeye düşünce "bitti"
JOB_RUN_W = 50        # bunun üstü: çalışıyor
JOB_RUN_S = 60        # en az bu kadar süre (kısa sıçramalar iş sayılmaz)
JOB_END_W = 50        # bunun altı: beklemede
JOB_END_S = 180       # varsayılan bekleme: bu kadar süre beklemede kalırsa iş bitti (cihaz başına ayarlanır)
JOB_MIN_S = 300       # bundan kısa işler bildirilmez
JOB_MIN_KWH = 0.02
JOB_RESUME_S = 600    # "bitti"den sonra bu süre içinde yeniden çalışırsa aynı iş sayılır (erken bildirim)
JOB_WAIT_STEPS = (60, 120, 180, 300, 600, 900)   # bekleme kademeleri (sn)


def next_wait(gap_s: float) -> int:
    """Ölçülen duraklamayı (30 sn payla) kapsayan ilk bekleme kademesi."""
    return next((s for s in JOB_WAIT_STEPS if s >= gap_s + 30), JOB_WAIT_STEPS[-1])


class JobTracker:
    """Prizdeki cihazın bir işi (yıkama, baskı, pişirme) bitirdiğini güç eğrisinden anlar.

    update() olay döndürür: ("bitti", iş) | ("devam", {"gap": sn}) | (None, None).
    "devam": bildirimi yapılmış iş, JOB_RESUME_S içinde sürdü; bekleme süresi kısa kalmış demektir.
    """

    def __init__(self, state: dict):
        self.st = state
        for k in ("hi_since", "job", "low_since", "last"):
            self.st.setdefault(k, None)

    def update(self, ts: float, w: float | None, kwh_added: float,
               end_s: float = JOB_END_S) -> tuple[str | None, dict | None]:
        st = self.st
        job = st["job"]
        if w is None:                       # okunamadı: durumu koru, enerjiyi say
            if job:
                job["kwh"] += kwh_added
            return None, None
        if job is None:
            last = st["last"]
            if last and ts - last["end"] > JOB_RESUME_S:
                st["last"] = last = None
            if w >= JOB_RUN_W:
                st["hi_since"] = st["hi_since"] or ts
                if ts - st["hi_since"] >= JOB_RUN_S:
                    if last and st["hi_since"] - last["end"] <= JOB_RESUME_S:
                        # erken "bitti": aynı iş sürüyor; işi kaldığı yerden devam ettir
                        gap = st["hi_since"] - last["end"]
                        st["job"] = {"start": last["start"], "kwh": last["kwh"] + kwh_added,
                                     "peak_w": max(last["peak_w"], w)}
                        st["hi_since"], st["low_since"], st["last"] = None, None, None
                        return "devam", {"gap": gap}
                    st["job"] = {"start": st["hi_since"], "kwh": kwh_added, "peak_w": w}
                    st["hi_since"], st["low_since"] = None, None
            else:
                st["hi_since"] = None
            return None, None
        job["kwh"] += kwh_added
        job["peak_w"] = max(job["peak_w"], w)
        if w < JOB_END_W:
            st["low_since"] = st["low_since"] or ts
            if ts - st["low_since"] >= end_s:
                done = {**job, "end": st["low_since"]}
                st["job"], st["low_since"] = None, None
                if done["end"] - done["start"] >= JOB_MIN_S and done["kwh"] >= JOB_MIN_KWH:
                    st["last"] = {k: done[k] for k in ("start", "end", "kwh", "peak_w")}
                    return "bitti", done
        else:
            st["low_since"] = None
        return None, None


def merge_months(bills: dict | None, meter: dict | None) -> list[float]:
    """Yılın 12 ayı: fatura (elle girilen) ile sayaç ölçümünden büyük olanı.
    Sayaç ay ortasında başladıysa o ayın faturası eksik kısmı tamamlar."""
    bills, meter = bills or {}, meter or {}
    out = []
    for m in range(1, 13):
        k = f"{m:02d}"
        out.append(max(float(bills.get(k) or 0), float(meter.get(k) or 0)))
    return out
