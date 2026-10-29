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
