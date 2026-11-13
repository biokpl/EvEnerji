"""tarife_kontrol.py testleri (ağ yok, sahte EPDK listesi/Excel ve piyasa verisiyle):  python test_tarife_kontrol.py"""
import io
from datetime import date

import tarife_kontrol as T


def _excel(alti=(49.4065, 195.064, 374.7551, 51.3656, 242.49), ustu=(189.5808, 195.064, 374.7551, 51.3656, 242.49)):
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append([None, "4 Nisan 2026 Tarihinden İtibaren Geçerli Vergiler Hariç Elektrik Tarifeleri"])
    ws.append(["Mesken", 203.6685, 209.1502, 388.8424, 65.454, 204.0402])        # OG satırı: karışmamalı
    ws.append([None, "Mesken (8 kWh/gün ve altı)", *alti])
    ws.append([None, "Mesken (8 kWh/gün üstü)", *ustu])
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


class _Yanit:
    def __init__(self, veri): self.veri = veri
    def raise_for_status(self): pass
    def json(self): return self.veri


class _Oturum:
    def __init__(self, model): self.model = model
    def post(self, *a, **k): return _Yanit({"model": self.model})


def _kayit(baslik, karar, excel=True):
    dosyalar = [{"ContentId": "word", "ContentType": 11, "IsFileType": 1}]
    if excel:
        dosyalar.append({"ContentId": f"x{karar}", "ContentType": 9, "IsFileType": 2})
    return {"Title": baslik, "Number": karar, "FastAccessDetail": dosyalar}


def test_formul_faturayla_ayni():
    # kullanıcının faturası: 3,238 (240 kWh'e kadar) / 4,857 ₺ (üstü)
    assert T.fiyat(0.494065, 2.4249) == 3.238
    assert T.fiyat(1.895808, 2.4249) == 4.857


def test_epdk_excel_okunur():
    v = T.oku_epdk_excel(_excel())
    assert v == {"e1": 49.4065, "e2": 189.5808, "gunduz": 195.064, "puant": 374.7551, "gece": 51.3656, "d": 242.49}
    assert (T.fiyat(v["gunduz"] / 100, 2.4249), T.fiyat(v["puant"] / 100, 2.4249), T.fiyat(v["gece"] / 100, 2.4249)) \
        == (4.92, 6.996, 3.261)


def test_epdk_excel_bozuksa_hata():
    for bozuk in (_excel(alti=(49.4, 195.0)),                                  # eksik sütun
                  _excel(ustu=(12.0, 195.064, 374.7551, 51.3656, 242.49)),     # kademe üstü düşük
                  _excel(ustu=(189.5808, 195.064, 374.7551, 51.3656, 250.0))):  # dağıtım farklı
        try:
            T.oku_epdk_excel(bozuk)
            assert False, "hata bekleniyordu"
        except ValueError:
            pass


def test_epdk_en_yeni_karar_secilir():
    o = _Oturum([_kayit("5/4/2025'ten itibaren geçerli olacak elektrik tarifeleri tabloları", "13426"),
                 _kayit("4/4/2026' dan itibaren geçerli olacak elektrik tarifeleri tabloları", "14461"),
                 _kayit("1/1/2027'den itibaren geçerli ...", "15000", excel=False)])   # Excel'i yok: atlanır
    k = T.epdk_son_karar(o)
    assert k["karar"] == "14461" and k["gecerli"] == date(2026, 4, 4) and k["dosya"] == "x14461"


def test_sktt_hesabi():
    gunler = {f"2026-10-{g:02d}": 3.0 for g in range(1, 32)}
    s = T.sktt_hesapla(gunler, 31, 526.39, 2.4249, "2026-10")
    assert s["ptf"] == 3.0 and s["yekdem"] == 0.5264 and s["gun"] == 31
    assert s["sktt_tl"] == T.fiyat((3.0 + 0.52639) * 1.05, 2.4249)
    try:
        T.sktt_hesapla({"2026-10-01": 3.0}, 31, 526.39, 2.4249, "2026-10")   # çok eksik gün
        assert False
    except ValueError:
        pass


def test_ayna_ptf_ay_suzulur():
    piyasa = {"priceSeries": [{"points": [{"date": "2026-09-30", "price": "9.0"}] +
                               [{"date": f"2026-10-{g:02d}", "price": "2.0"} for g in range(1, 32)]}]}
    g = T.ayna_ptf(piyasa, "2026-10")
    assert len(g) == 31 and set(g.values()) == {2.0}


def test_sarj_karari():
    # Kasım 2026 verisi: ev ~6,9 kWh/gün, Togg ~8 kWh/gün; 2027 limiti 3.000
    tf = {"normal_tl": 3.238, "kademe2_tl": 4.857, "kademe_kwh_gun": 8}
    k = T.sarj_karari(6.9, 8.0, tf, 3000, 6.944, 12, 14.9, 2027)
    assert k["evde"] is True and 30000 < k["evde_tl"] < 45000 and k["dc_tl"] > k["evde_tl"]
    assert 7.0 < k["esik_sktt"] < 7.6
    assert T.sarj_karari(6.9, 8.0, tf, 3000, 8.0, 12, 14.9, 2027)["evde"] is False   # son kaynak pahalanırsa DC


def test_po_lpg_okunur():
    sayfa = """<table><tr><th>Şehir</th><th>V/Max Kurşunsuz 95</th><th>V/Max Diesel</th><th>Gazyağı</th>
    <th>Kalorifer Yakıtı</th><th>Fuel Oil</th><th>PO/gaz Otogaz</th></tr>
    <tr><td>ISTANBUL (AVRUPA)</td><td>74.60 62.17 TL/LT</td><td>95.20 79.34</td><td>92.39 77.00</td>
    <td>66.26 55.22</td><td>50.10 41.75</td><td>50.70 42.25 TL/LT</td></tr>
    <tr><td>ISTANBUL (ANADOLU)</td><td>74.40</td><td>62.00</td><td>95.00</td><td>79.17</td><td>1</td><td>1</td><td>1</td><td>1</td><td>1</td><td>1</td><td>50.10</td><td>41.70</td></tr></table>"""
    assert T.oku_po_lpg(sayfa) == 50.70


if __name__ == "__main__":
    n = 0
    for k, f in sorted(globals().items()):
        if k.startswith("test_"):
            f(); n += 1
    print(f"{n} test OK")


def test_oku_hava():
    from tarife_kontrol import oku_hava
    js = {"daily": {"time": ["2026-11-10", "2026-11-11"], "temperature_2m_mean": [11.34, None],
                    "temperature_2m_min": [9.8, 11.4], "temperature_2m_max": [13.8, 17.1]}}
    assert oku_hava(js) == {"2026-11-10": {"ort": 11.3, "min": 9.8, "max": 13.8}}


def test_oku_hava_sabah_aksam():
    from tarife_kontrol import oku_hava
    js = {"daily": {"time": ["2026-11-10"], "temperature_2m_mean": [11.3], "temperature_2m_min": [9.8],
                    "temperature_2m_max": [13.8]},
          "hourly": {"time": ["2026-11-10T08:00", "2026-11-10T17:00"], "temperature_2m": [9.94, 13.1]}}
    assert oku_hava(js)["2026-11-10"] == {"ort": 11.3, "min": 9.8, "max": 13.8, "sabah": 9.9, "aksam": 13.1}
