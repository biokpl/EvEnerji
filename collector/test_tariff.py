"""Tarife motoru testleri:  python -m pytest -q  (veya python test_tariff.py)"""
from datetime import date

from tariff import (Tarife, birim_fiyat, gelecek_yil_senaryosu, gunluk_butce,
                    yil_durumu, yil_sonu_tahmini)


def t26(**kw):
    return Tarife(yil=2026, limit_kwh=4000, normal_tl=3.0, sktt_tl=6.0, **kw)


def test_limit_altinda_hep_normal():
    d = yil_durumu(t26(), [300] * 12)  # 3600
    assert d.asim_ayi is None and d.sktt_baslangic is None
    assert abs(d.toplam_tl - 3600 * 3.0) < 1e-6


def test_ekimde_asim_ocakta_sktt():
    # 9 ay x 400 = 3600, Ekim'de 4000'i geçer -> 3 ay sonra = Ocak (gelecek yıl)
    d = yil_durumu(t26(), [400] * 9 + [500, 400, 400])
    assert d.asim_ayi == 10
    assert d.sktt_baslangic == (2027, 1)
    assert all(abs(x - k * 3.0) < 1e-6 for x, k in zip(d.aylik_tl, d.aylik_kwh))


def test_haziranda_asim_eylulden_sktt():
    d = yil_durumu(t26(), [700] * 12)  # Haziran sonunda 4200
    assert d.asim_ayi == 6
    assert d.sktt_baslangic == (2026, 9)
    assert d.aylik_tl[7] == 700 * 3.0   # Ağustos normal
    assert d.aylik_tl[8] == 700 * 6.0   # Eylül son kaynak


def test_onceki_yil_asildiysa_tum_yil_sktt():
    d = yil_durumu(t26(onceki_yil_kwh=4500), [100] * 12)
    assert all(abs(x - 600) < 1e-6 for x in d.aylik_tl)


def test_limit_esit_asim_degil():
    d = yil_durumu(t26(), [1000, 1000, 1000, 1000] + [0] * 8)
    assert d.asim_ayi is None


def test_kademe():
    t = t26(kademe_kwh_ay=240, kademe2_tl=4.5)
    d = yil_durumu(t, [300] + [0] * 11)
    assert abs(d.aylik_tl[0] - (240 * 3.0 + 60 * 4.5)) < 1e-6
    assert birim_fiyat(t, d, 1) == 4.5


def test_tahmin_ve_butce():
    bugun = date(2026, 7, 2)  # 183. gün
    p = yil_sonu_tahmini(1830, 300, bugun)  # yıl ort 10/gün, son 30 gün 10/gün
    assert abs(p - 3650) < 1.0
    b = gunluk_butce(4000, 1830, bugun)
    assert abs(b - (2170 / 183)) < 1e-6


def test_yil_icinde_tasinma():
    # 4 Ağustos'ta taşınıldı; 30 Ekim'e kadar 88 günde 880 kWh (10/gün)
    bugun = date(2026, 10, 30)
    p = yil_sonu_tahmini(880, 300, bugun, date(2026, 8, 4))
    assert abs(p - (880 + 10 * 62)) < 1.0, p


def test_gelecek_yil_senaryosu():
    s = gelecek_yil_senaryosu(3400)
    assert s == {3000: True, 3500: False, 4000: False}


if __name__ == "__main__":
    import sys
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn(); print("OK  ", name)
            except AssertionError as e:
                fails += 1; print("HATA", name, e)
    print("TÜM TESTLER GEÇTİ" if not fails else f"{fails} test başarısız")
    sys.exit(1 if fails else 0)


def test_yasal_limit_2027():
    # EPDK: 1 Ocak 2027'den itibaren 3.000 kWh; ayarda verilirse o kullanılır
    assert Tarife.from_dict(2026, {}).limit_kwh == 4000
    assert Tarife.from_dict(2027, {}).limit_kwh == 3000
    assert Tarife.from_dict(2027, {"limit_kwh": 3500}).limit_kwh == 3500
