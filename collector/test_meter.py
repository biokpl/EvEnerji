"""Enerji ve oturum testleri:  python test_meter.py"""
from datetime import datetime

from meter import DeviceMeter, SessionTracker, merge_months

T0 = datetime(2026, 10, 30, 22, 0, 0).timestamp()


def test_sabit_guc_enerji():
    st = {}
    m = DeviceMeter("p", st, 10)
    for i in range(361):           # 1 saat, 10 sn'de bir, 2200 W
        m.add(T0 + i * 10, 2200.0)
    assert abs(st["p"]["days"]["2026-10-30"] - 2.2) < 1e-6


def test_kisa_kopukluk_surekli_sayilir():
    st = {}
    m = DeviceMeter("p", st, 10)
    m.add(T0, 1000.0)
    m.add(T0 + 300, 1000.0)        # 5 dk veri yok
    assert abs(st["p"]["days"]["2026-10-30"] - 1000 * 300 / 3.6e6) < 1e-9


def test_uzun_kopukluk_tek_aralik():
    st = {}
    m = DeviceMeter("p", st, 10)
    m.add(T0, 1000.0)
    m.add(T0 + 3600, 1000.0)       # 1 saat veri yok -> yalnız 10 sn sayılır
    assert abs(st["p"]["days"]["2026-10-30"] - 1000 * 10 / 3.6e6) < 1e-9


def test_saat_dizisi_ve_gun_gecisi():
    st = {}
    m = DeviceMeter("p", st, 10)
    t = datetime(2026, 10, 30, 23, 59, 50).timestamp()
    m.add(t, 3600.0)
    m.add(t + 20, 3600.0)          # 00:00:10'a geçer -> ertesi güne yazılır
    assert "2026-10-31" in st["p"]["days"]
    assert st["p"]["hours"]["2026-10-31"][0] > 0


def test_oturum_baslar_ve_biter():
    s = SessionTracker({})
    m = DeviceMeter("p", {}, 10)
    events = []
    t = T0
    for _ in range(3):             # boşta
        events.append(s.update(t, 2.0, m.add(t, 2.0))[0]); t += 10
    for _ in range(360):           # 1 saat şarj
        events.append(s.update(t, 2200.0, m.add(t, 2200.0))[0]); t += 10
    last = None
    for _ in range(40):            # 400 sn boşta
        ev, sess = s.update(t, 1.0, m.add(t, 1.0)); t += 10
        if ev:
            events.append(ev); last = sess
    assert events.count("basladi") == 1 and events.count("bitti") == 1
    assert 2.1 < last["kwh"] < 2.3, last["kwh"]
    assert last["peak_w"] == 2200.0 and s.active is None


def test_kisa_sicrama_oturum_degil():
    s = SessionTracker({})
    ev, _ = s.update(T0, 900.0, 0)
    ev2, _ = s.update(T0 + 10, 5.0, 0)
    assert ev is None and ev2 is None and s.active is None


def test_aylari_birlestir():
    m = merge_months({"01": 300, "10": 320}, {"10": 150, "11": 50})
    assert m[0] == 300 and m[9] == 320 and m[10] == 50 and len(m) == 12


if __name__ == "__main__":
    import sys
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn(); print("OK  ", name)
            except AssertionError as e:
                fails += 1; print("HATA", name, e)
    print("TUM TESTLER GECTI" if not fails else f"{fails} test başarısız")
    sys.exit(1 if fails else 0)
