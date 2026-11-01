"""Toplayıcının uçtan uca testi (sahte priz + sahte Firebase):  python test_collector.py"""
import hashlib
import hmac
import time

import collector as C
from providers import Reading


class FakeFB:
    def __init__(self):
        self.data = {}

    def _set(self, path, val):
        parts = [p for p in path.strip("/").split("/") if p]
        d = self.data
        for p in parts[:-1]:
            d = d.setdefault(p, {})
        if parts:
            d[parts[-1]] = val

    def get(self, path, **_):
        d = self.data
        for p in [p for p in path.strip("/").split("/") if p]:
            if not isinstance(d, dict) or p not in d:
                return None
            d = d[p]
        return d

    def put(self, path, val): self._set(path, val)

    def patch(self, path, val):
        for k, v in val.items():
            self._set(f"{path}/{k}" if path else k, v)

    def delete(self, path):
        parts = path.strip("/").split("/")
        d = self.get("/".join(parts[:-1]))
        if isinstance(d, dict):
            d.pop(parts[-1], None)

    def safe(self, fn, *a, **kw): return fn(*a, **kw)


class FakePlug:
    can_switch = True

    def __init__(self): self.w, self.on = 0.0, True

    def read(self): return Reading(ok=True, on=self.on, w=self.w, v=230.0, a=self.w / 230)

    def set_switch(self, on): self.on = on


class FakeNtfy:
    def __init__(self): self.sent = []

    def send(self, title, msg, **kw): self.sent.append((title, msg))


def make():
    C.load_json = lambda p, d: {"firebase_url": "x", "control_secret": "gizli", "poll_seconds": 10} \
        if p == C.CFG_FILE else d
    C.save_json = lambda p, d: None
    c = C.Collector()
    c.fb, c.ntfy = FakeFB(), FakeNtfy()
    plug = FakePlug()
    c.meta = {"togg": {"name": "Togg T10X", "type": "ev_sarj", "enabled": True}}
    c.providers = {"togg": plug}
    c.meters = {"togg": C.DeviceMeter("togg", c.state["meters"], 10)}
    c.sessions = {"togg": C.SessionTracker({})}
    c.settings = {"tariff": {str(time.localtime().tm_year): {"normal_tl": 3.0, "sktt_tl": 6.0}}}
    return c, plug


def sign(dev, act, secret=b"gizli"):
    ts, nonce = int(time.time() * 1000), str(time.time_ns())
    sig = hmac.new(secret, f"{dev}|{act}|{ts}|{nonce}".encode(), hashlib.sha256).hexdigest()
    return {"device": dev, "action": act, "ts": ts, "nonce": nonce, "sig": sig}


def test_sarj_oturumu_uctan_uca():
    c, plug = make()
    t = time.time()
    real = time.time
    try:
        def step(w):
            nonlocal t
            plug.w = w
            C.time.time = lambda: t
            c.poll_once()
            t += 10
        for _ in range(3): step(1.0)
        for _ in range(360): step(2200.0)
        for _ in range(40): step(0.5)
    finally:
        C.time.time = real
    sess = c.fb.data["sessions"]["togg"]
    s = next(iter(sess.values()))
    assert 2.1 < s["kwh"] < 2.3 and abs(s["tl"] - s["kwh"] * 3.0) < 0.02, s
    assert abs(s["tl_sktt"] - s["kwh"] * 6.0) < 0.02
    titles = [x[0] for x in c.ntfy.sent]
    assert any("başladı" in x for x in titles) and any("bitti" in x for x in titles)


def test_imzali_komut():
    c, plug = make()
    c.fb.data["commands"] = {"k1": sign("togg", "off"), "k2": sign("togg", "off", b"yanlis")}
    c.run_commands()
    assert plug.on is False
    assert c.fb.data["command_results"]["k1"]["ok"] is True
    assert c.fb.data["command_results"]["k2"]["ok"] is False
    assert c.fb.data["commands"] == {}


def test_tekrar_saldirisi_reddedilir():
    c, plug = make()
    cmd = sign("togg", "off")
    c.fb.data["commands"] = {"a": dict(cmd)}
    c.run_commands()
    plug.on = True
    c.fb.data["commands"] = {"b": dict(cmd)}
    c.run_commands()
    assert plug.on is True and c.fb.data["command_results"]["b"]["ok"] is False


def test_kablo_sariliyken_sarj_acilmaz():
    c, plug = make()
    plug.on = False
    c.winder = {"online": True, "state": "sarili"}
    c.fb.data["commands"] = {"k": sign("togg", "on")}
    c.run_commands()
    assert plug.on is False and "Kablo" in c.fb.data["command_results"]["k"]["msg"]


def test_sarj_surerken_sarici_calismaz():
    c, plug = make()
    c.live["togg"] = Reading(ok=True, on=True, w=2200.0)
    c.fb.data["commands"] = {"k": sign("sarici", "sar")}
    c.run_commands()
    assert "winder" not in c.fb.data
    assert c.fb.data["command_results"]["k"]["ok"] is False


if __name__ == "__main__":
    import sys
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn(); print("OK  ", name)
            except Exception as e:
                fails += 1; print("HATA", name, repr(e))
    print("TUM TESTLER GECTI" if not fails else f"{fails} test başarısız")
    sys.exit(1 if fails else 0)


def _priz_calistir(bildirim):
    c, _ = make()
    plug = FakePlug()
    c.meta = {"camasir": {"name": "Çamaşır", "type": "priz", "enabled": True, "bitti_bildirim": bildirim}}
    c.providers = {"camasir": plug}
    c.meters = {"camasir": C.DeviceMeter("camasir", c.state["meters"], 3)}
    c.sessions = {}
    c.jobs = {"camasir": C.JobTracker({})}
    t, real = time.time(), time.time
    try:
        def step(w):
            nonlocal t
            plug.w = w
            C.time.time = lambda: t
            c.poll_once()
            t += 3
        for _ in range(400): step(1800.0)    # 20 dk çalışma
        for _ in range(120): step(2.0)       # 6 dk bekleme
    finally:
        C.time.time = real
    c.pool.shutdown(wait=True)
    return c.ntfy.sent


def test_priz_is_bitti_bildirimi():
    sent = _priz_calistir(True)
    assert len(sent) == 1 and sent[0][0] == "Çamaşır bitti", sent
    assert "20 dk" in sent[0][1] and "kWh" in sent[0][1] and "₺" in sent[0][1], sent


def test_priz_bildirimi_kapaliysa_gonderilmez():
    assert _priz_calistir(False) == []


def test_erken_bitti_bekleme_otomatik_artar():
    c, _ = make()
    plug = FakePlug()
    c.meta = {"camasir": {"name": "Çamaşır", "type": "priz", "enabled": True, "bitti_dk": 1}}
    c.fb.data["devices"] = {"camasir": dict(c.meta["camasir"])}
    c.providers = {"camasir": plug}
    c.meters = {"camasir": C.DeviceMeter("camasir", c.state["meters"], 3)}
    c.sessions = {}
    c.jobs = {"camasir": C.JobTracker({})}
    t, real = time.time(), time.time
    try:
        def step(w, n):
            nonlocal t
            for _ in range(n):
                plug.w = w
                C.time.time = lambda: t
                c.poll_once()
                t += 3
        step(1800.0, 200)   # 10 dk yıkama
        step(3.0, 50)       # 2,5 dk su alma (1 dk bekleme ile erken "bitti")
        step(1800.0, 200)   # devam
        step(3.0, 100)      # gerçekten bitti (artık 3 dk bekleme)
    finally:
        C.time.time = real
    c.pool.shutdown(wait=True)
    sent = c.ntfy.sent
    assert len(sent) == 2, sent                                  # erken + gerçek
    assert c.fb.data["devices"]["camasir"]["bitti_dk"] == 3
    assert c.fb.data["devices"]["camasir"]["bitti_dk_oto"] is True
    assert "1 → 3 dk" in sent[1][1], sent[1]


def test_bekci_bozuk_yanitta_yeniden_baslatir():
    c, plug = make()
    plug.proto_bad_since = C.time.monotonic() - 700      # 11,6 dk bozuk yanıt
    c.state["self_restart_ts"] = 0
    c.running = True
    c.watchdog()
    assert c.running is False and c.restart_requested
    # saatte bir: hemen ardından tekrar tetiklenmez
    c2, plug2 = make()
    plug2.proto_bad_since = C.time.monotonic() - 700
    c2.state["self_restart_ts"] = time.time() - 600
    c2.running = True
    c2.watchdog()
    assert c2.running is True


def test_tuya_hata_sonrasi_kapatir_ve_ara_verir():
    import providers.tuya_local as T
    kapanan = []

    class FakeDev:
        def status(self): return {"Error": "Unexpected Payload from Device"}
        def close(self): kapanan.append(1)
    p = T.TuyaPlug.__new__(T.TuyaPlug)
    p.t, p.dps, p.scale = {"dev_id": "x"}, T.DEFAULT_DPS, T.DEFAULT_SCALE
    p.fails, p.skip_until, p.last_err, p.proto_bad_since = 0, 0.0, "", None
    p.versions, p.vi = [3.4, 3.5, 3.3], 0
    p._connect = lambda: FakeDev()
    p.d = FakeDev()
    for _ in range(6):
        assert p.read().ok is False
    assert len(kapanan) == 6                        # her hatada kapatıldı
    assert p.skip_until > T.time.monotonic()        # 6 hatadan sonra ara
    assert p.proto_bad_since is not None            # protokol hatası izleniyor
    p.d.status = lambda: {"Error": "Network Error: Unable to Connect"}
    p.skip_until = 0
    p.read()
    assert p.proto_bad_since is None                # priz kapalı: bekçi tetiklenmez


def test_tuya_bozuk_yanitta_surum_degistirir():
    import providers.tuya_local as T
    surumler = []

    class Dev:
        def __init__(self, v): self.v = v
        def status(self):
            return {"dps": {"1": True, "19": 100}} if self.v == 3.5 else {"Error": "Unexpected Payload from Device"}
        def close(self): pass
    p = T.TuyaPlug.__new__(T.TuyaPlug)
    p.t, p.dps, p.scale = {"dev_id": "x"}, T.DEFAULT_DPS, T.DEFAULT_SCALE
    p.fails, p.skip_until, p.last_err, p.proto_bad_since = 0, 0.0, "", None
    p.versions, p.vi = [3.4, 3.5, 3.3], 0

    def conn():
        surumler.append(p.versions[p.vi])
        return Dev(p.versions[p.vi])
    p._connect = conn
    p.d = conn()
    sonuc = [p.read().ok for _ in range(4)]
    assert sonuc == [False, False, False, True], sonuc   # 3 hatadan sonra 3.5'e geçip okudu
    assert surumler == [3.4, 3.5]


def test_kesif_bulamadigi_surumu_ezmez():
    import discover as D
    import json, tempfile, os
    from pathlib import Path

    class FakeCloud:
        def __init__(self, **k): pass
        def getdevices(self, verbose=False):
            return [{"id": "t1", "key": "k", "name": "Priz", "category": "cz"}]
    D.tinytuya.Cloud = FakeCloud
    D.tinytuya.deviceScan = lambda **k: {}          # tarama prizi görmedi
    f = Path(tempfile.mkdtemp()) / "devices_local.json"
    f.write_text(json.dumps({"priz": {"provider": "tuya", "tuya": {"dev_id": "t1", "local_key": "k", "ip": "1.2.3.4", "version": 3.4}}}))
    D.sync({"api_key": "a", "api_secret": "b"}, f, {"priz"})
    assert json.loads(f.read_text())["priz"]["tuya"]["version"] == 3.4
