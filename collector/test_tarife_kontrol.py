"""tarife_kontrol.py testleri (ağ yok, sahte sayfa/veriyle):  python test_tarife_kontrol.py"""
from datetime import date

import tarife_kontrol as T

VERINOKTA = """<table><tr><th>AG tek zamanlı grup</th><th>Düşük enerji kr/kWh</th><th>Yüksek enerji kr/kWh</th><th>Dağıtım kr/kWh</th></tr>
<tr><td>Mesken</td><td>49,4065</td><td>189,5808</td><td>242,4900</td></tr>
<tr><td>Kamu/Özel hizmetler ve diğer</td><td>287,3087</td><td>345,4688</td><td>247,9368</td></tr></table>"""

HAKEDIS = """<table><tr><th></th><th></th><th>TEMMUZ</th><th>AĞUSTOS</th><th>EYLÜL</th><th>EKİM</th><th>KASIM</th><th>ARALIK</th></tr>
<tr><td>Abone Grubu</td><td>Tarife Türü</td><td>Dağıtım Bedeli</td><td>Reaktif Bedeli</td><td>Dağıtım Bedeli</td><td>Reaktif Bedeli</td><td>Dağıtım Bedeli</td><td>Reaktif Bedeli</td><td>Dağıtım Bedeli</td><td>Reaktif Bedeli</td><td>Dağıtım Bedeli</td><td>Reaktif Bedeli</td><td>Dağıtım Bedeli</td><td>Reaktif Bedeli</td></tr>
<tr><td>Aydınlatma</td><td>Tek</td><td>237,469</td><td></td><td>237,469</td><td></td><td>237,469</td><td></td><td>237,469</td><td></td><td>237,469</td><td></td><td>237,469</td><td></td></tr>
<tr><td>Mesken</td><td>Tek</td><td>242,49</td><td></td><td>242,49</td><td></td><td>242,49</td><td></td><td>242,49</td><td></td><td>250,10</td><td></td><td>250,10</td><td></td></tr>
<tr><td>Mesken</td><td>Tek</td><td>204,0402</td><td></td><td>204,0402</td><td></td><td>204,0402</td><td></td><td>204,0402</td><td></td><td>204,0402</td><td></td><td>204,0402</td><td></td></tr></table>"""


def test_formul_faturayla_ayni():
    # kullanıcının faturası: 3,238 (240 kWh'e kadar) / 4,857 ₺ (üstü)
    assert T.fiyat(0.494065, 2.4249) == 3.238
    assert T.fiyat(1.895808, 2.4249) == 4.857


def test_verinokta_okunur():
    v = T.oku_verinokta(VERINOKTA)
    assert v == {"e1": 49.4065, "e2": 189.5808, "d": 242.49}


def test_verinokta_bozuksa_hata():
    for bozuk in ("<table></table>", VERINOKTA.replace("189,5808", "12,0")):
        try:
            T.oku_verinokta(bozuk)
            assert False, "hata bekleniyordu"
        except ValueError:
            pass


def test_hakedis_ay_sutunu():
    assert T.oku_hakedis_dagitim(HAKEDIS, date(2026, 10, 5)) == 242.49
    assert T.oku_hakedis_dagitim(HAKEDIS, date(2026, 11, 5)) == 250.10   # Kasım farklı: çelişki yakalanır
    try:
        T.oku_hakedis_dagitim(HAKEDIS, date(2026, 3, 1))                  # bu tabloda Mart yok
        assert False
    except ValueError:
        pass


def test_sktt_hesabi():
    piyasa = {"priceSeries": [{"points": [{"date": f"2026-10-{g:02d}", "price": "3.0"} for g in range(1, 32)]}],
              "yekdemUnitCosts": [{"year": 2026, "month": 10, "unitCostPerMwh": "500"},
                                  {"year": 2026, "month": 10, "unitCostPerMwh": "526.39"}]}   # revize: sonraki geçerli
    s = T.sktt_hesapla(piyasa, 2026, 10, 2.4249)
    assert s["ptf"] == 3.0 and s["yekdem"] == 0.5264
    enerji = (3.0 + 0.52639) * 1.05
    assert s["sktt_tl"] == T.fiyat(enerji, 2.4249)
    try:
        T.sktt_hesapla(piyasa, 2026, 9, 2.4249)      # eylül verisi yok
        assert False
    except ValueError:
        pass


if __name__ == "__main__":
    n = 0
    for k, f in sorted(globals().items()):
        if k.startswith("test_"):
            f(); n += 1
    print(f"{n} test OK")
