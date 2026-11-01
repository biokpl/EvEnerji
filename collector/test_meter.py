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


def test_oturum_sik_olcumde_erken_baslamaz():
    # 3 sn'de bir ölçümde de oturum en az 10 sn yüksek güçten sonra başlar
    s = SessionTracker({})
    ev = [s.update(1000 + i * 3, 2200, 0.0)[0] for i in range(5)]   # 0, 3, 6, 9, 12 sn
    assert ev[:4] == [None] * 4
    assert ev[4] == "basladi"
    assert s.active["start"] == 1000


def _oturum(guc_listesi):
    s = SessionTracker({})
    t, son = 1000, None
    for w in guc_listesi:
        ev, ses = s.update(t, w, 0.01)
        if ev == "bitti":
            son = ses
        t += 3
    return son


def test_oturum_doldu_isareti():
    # araç hedefe ulaşınca güç kademeli düşer -> full
    dolu = _oturum([2200] * 10 + [1500, 900, 400, 150] + [0] * 110)
    assert dolu and dolu["full"] is True
    # fiş çekilince güç birden kesilir -> full değil
    cekildi = _oturum([2200] * 10 + [0] * 110)
    assert cekildi and cekildi["full"] is False
    assert "tail_w" not in cekildi


def _is(guc, adim=3, end_s=300, olaylar=None):
    from meter import JobTracker
    j, t, biten = JobTracker({}), 0, []
    for w in guc:
        ev, r = j.update(t, w, w * adim / 3_600_000, end_s)
        if ev == "bitti":
            biten.append(r)
        if ev and olaylar is not None:
            olaylar.append((ev, r))
        t += adim
    return biten


def test_is_biter_ve_bildirilir():
    # 20 dk çalışma (2 dk duraklama dahil), sonra 8 dk beklemede -> tek iş
    guc = [2000] * 200 + [5] * 40 + [400] * 160 + [3] * 160
    biten = _is(guc)
    assert len(biten) == 1
    b = biten[0]
    assert 19 * 60 <= b["end"] - b["start"] <= 21 * 60
    assert b["kwh"] > 0.1 and b["peak_w"] == 2000


def test_kisa_sicrama_is_degil():
    assert _is([5] * 50 + [900] * 10 + [5] * 200) == []      # 30 sn sıçrama
    assert _is([300] * 30 + [5] * 200) == []                  # 90 sn: iş başlar ama 5 dk'dan kısa


def test_bekleme_gucu_esigin_altinda_kalir():
    # yazıcı beklemede 26-40 W: hiç iş başlamaz
    assert _is([26, 40, 33] * 300) == []


def test_erken_bitti_sonra_devam_algilanir():
    from meter import next_wait
    # 10 dk çalış, 2,5 dk dur (1 dk bekleme ile "bitti" der), 10 dk daha çalış, sonra gerçekten bit
    olay = []
    guc = [1500] * 200 + [4] * 50 + [1500] * 200 + [4] * 60
    biten = _is(guc, end_s=60, olaylar=olay)
    turler = [e for e, _ in olay]
    assert turler == ["bitti", "devam", "bitti"], turler
    gap = olay[1][1]["gap"]
    assert 140 <= gap <= 160, gap
    assert next_wait(gap) == 180          # 2,5 dk duraklama -> 3 dk kademe (30 sn payla)
    son = biten[-1]
    assert son["end"] - son["start"] > 20 * 60   # süre işin tamamını kapsar


def test_uzun_aradan_sonra_yeni_is_sayilir():
    olay = []
    _is([1500] * 200 + [4] * 300 + [1500] * 200 + [4] * 60, end_s=60, olaylar=olay)   # 15 dk ara
    assert [e for e, _ in olay] == ["bitti", "bitti"]


def test_bekleme_kademeleri():
    from meter import next_wait
    assert next_wait(20) == 60 and next_wait(100) == 180 and next_wait(200) == 300
    assert next_wait(2000) == 900
