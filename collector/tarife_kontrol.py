"""Elektrik tarifesi ve son kaynak (SKTT) fiyatını internetten kendiliğinden günceller.

Her sabah çalışır (systemd: tarife-kontrol.timer); yalnız bir şey değişince bildirim gönderir.

Normal ve üç zamanlı tarife — DOĞRUDAN EPDK'dan (resmi kaynak):
  epdk.gov.tr "Elektrik Faturalarına Esas Tarife Tabloları" listesi (sitenin kendi veri adresi
  /Detay/GetFastAccessList) → en yeni kurul kararının Excel tablosu (/Detay/DownloadDocument).
  "Mesken (8 kWh/gün ve altı / üstü)" satırları: tek zamanlı enerji, gündüz/puant/gece, dağıtım.
  Karar başlığındaki geçerlilik tarihi gelmeden uygulanmaz. Okunamazsa hiçbir şey değişmez,
  "Tarife değişmiş olabilir, Kontrol et..!!" bildirimi (haftada en fazla bir).

SKTT (aylık) — kayıt gerektirmez:
  PTF: EPİAŞ şeffaflık verisinin herkese açık aynası (jsDelivr). EPİAŞ'ın kendisi hesapsız
       otomatik erişimi engelliyor (API 401, ana sayfa "Erişim Talebiniz Engellendi").
  YEKDEM: EPDK Kurul kararıyla Resmî Gazete'de yayımlanan aylık öngörü (settings/yekdem/{yyyy-mm});
       tabloda olmayan ay için aynadaki değer (EPDK karar numarasıyla) alınır ve bildirilir.
  enerji = (PTF + YEKDEM) × 1,05

Faturaya esas fiyat (kullanıcının faturasıyla doğrulandı: 3,238 / 4,857 ₺):
  fiyat = (enerji + dağıtım + enerji × %5 BTV) × 1,10 (KDV)

  python tarife_kontrol.py            # kontrol et, gerekirse güncelle ve bildir
  python tarife_kontrol.py --kuru     # yalnız göster, hiçbir şey yazma/gönderme
"""
from __future__ import annotations

import io
import json
import re
import statistics
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

EPDK = "https://www.epdk.gov.tr"
EPDK_SAYFA = EPDK + "/Detay/Icerik/3-1327/elektrik-faturalarina-esas-tarife-tablolari"
EPDK_LISTE_ID = "1327"      # "Elektrik Faturalarına Esas Tarife Tabloları" hızlı erişim kaydı
PIYASA = "https://cdn.jsdelivr.net/gh/06maslan27/fatura-dedektifi-veri@main/data/piyasa/ptf-yekdem.json"
UA = {"User-Agent": "Mozilla/5.0 (EvEnerji tarife kontrol)"}

BTV, KDV, SKTT_KATSAYI = 0.05, 0.10, 1.05
UYARI_ARALIGI = 7 * 86400     # "kontrol et" bildirimi en fazla haftada bir


def fiyat(enerji_tl: float, dagitim_tl: float) -> float:
    """Vergisiz enerji + dağıtım (₺/kWh) → faturaya esas birim fiyat (₺/kWh)."""
    return round((enerji_tl + dagitim_tl + enerji_tl * BTV) * (1 + KDV), 3)


def epdk_son_karar(oturum: requests.Session) -> dict:
    """EPDK tarife tabloları listesinden en yeni kararı ve Excel dosyasının kimliğini döndürür."""
    r = oturum.post(EPDK + "/Detay/GetFastAccessList", json={"fId": EPDK_LISTE_ID}, timeout=30,
                    headers={**UA, "X-Requested-With": "XMLHttpRequest", "Referer": EPDK_SAYFA})
    r.raise_for_status()
    kayitlar = []
    for k in r.json().get("model") or []:
        excel = [f for f in k.get("FastAccessDetail") or [] if f.get("ContentType") == 9 and f.get("IsFileType") == 2]
        m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", k.get("Title", ""))
        if excel and m:
            gecerli = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
            kayitlar.append({"gecerli": gecerli, "karar": k.get("Number"), "baslik": k.get("Title"),
                             "dosya": excel[0]["ContentId"]})
    if not kayitlar:
        raise ValueError("EPDK listesinde Excel tarife tablosu bulunamadı")
    return max(kayitlar, key=lambda x: x["gecerli"])


def oku_epdk_excel(icerik: bytes) -> dict:
    """Resmi tablodan mesken (alçak gerilim, tek terim) bedelleri, kr/kWh."""
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(icerik), data_only=True, read_only=True)
    satirlar = {}
    for ws in wb.worksheets:
        for r in ws.iter_rows(values_only=True):
            etiket = next((str(c).strip() for c in r if isinstance(c, str) and c.strip()), "")
            sayilar = [float(c) for c in r if isinstance(c, (int, float))]
            if etiket.startswith("Mesken (8 kWh/gün ve altı)"):
                satirlar["alti"] = sayilar
            elif etiket.startswith("Mesken (8 kWh/gün üstü)"):
                satirlar["ustu"] = sayilar
    if "alti" not in satirlar or "ustu" not in satirlar:
        raise ValueError("EPDK tablosunda mesken kademe satırları bulunamadı")
    a, u = satirlar["alti"], satirlar["ustu"]
    if len(a) < 5 or len(u) < 5:
        raise ValueError(f"mesken satırı eksik: {a} / {u}")
    # sıra: tek zamanlı enerji | gündüz | puant | gece | dağıtım
    v = {"e1": a[0], "e2": u[0], "gunduz": a[1], "puant": a[2], "gece": a[3], "d": a[4]}
    if not (0 < v["e1"] < v["e2"] < 2000 and 0 < v["gece"] < v["gunduz"] < v["puant"] < 2000
            and 50 < v["d"] < 2000 and abs(u[4] - a[4]) < 1e-6):
        raise ValueError(f"EPDK değerleri olağan dışı: {v}")
    return v


def ayna_ptf(piyasa: dict, ym: str) -> dict[str, float]:
    """Aynadaki (EPİAŞ kopyası) günlük PTF'ler: {'YYYY-AA-GG': ₺/kWh}."""
    return {p["date"]: float(p["price"]) for s in piyasa.get("priceSeries", []) for p in s.get("points", [])
            if str(p.get("date", "")).startswith(ym)}


def sktt_hesapla(ptf_gun: dict[str, float], gun_sayisi: int, yekdem_tl_mwh: float, dagitim_tl: float, ym: str) -> dict:
    """Bir ayın günlük PTF'leri ve YEKDEM öngörüsünden SKTT (vergiler dahil, ₺/kWh)."""
    if len(ptf_gun) < min(20, gun_sayisi):
        raise ValueError(f"{ym} için PTF eksik ({len(ptf_gun)}/{gun_sayisi} gün)")
    ptf_ort = statistics.mean(ptf_gun.values())
    if not (0.3 < ptf_ort < 20 and 0 <= yekdem_tl_mwh < 5000):
        raise ValueError(f"olağan dışı: PTF {ptf_ort}, YEKDEM {yekdem_tl_mwh}")
    enerji = (ptf_ort + yekdem_tl_mwh / 1000) * SKTT_KATSAYI
    return {"ay": ym, "ptf": round(ptf_ort, 4), "yekdem": round(yekdem_tl_mwh / 1000, 4),
            "gun": len(ptf_gun), "sktt_tl": fiyat(enerji, dagitim_tl)}


def sarj_karari(ev_gun: float, togg_gun: float, tarife: dict, limit_kwh: float, sktt_tl: float,
                dc_tl: float, dc_tam_tl: float, yil: int) -> dict:
    """Gelecek yıl Togg evde mi şarj edilmeli (limit aşılır, her şey son kaynak) yoksa limit içinde kalıp
    DC'de mi? Uygulamadaki Togg > Şarj kararı kartıyla aynı hesap (js/model.js karar)."""
    import calendar
    from tariff import Tarife, ay_maliyeti
    t = Tarife(yil=yil, normal_tl=float(tarife.get("normal_tl") or 3.24), kademe2_tl=float(tarife.get("kademe2_tl") or 0),
               kademe_kwh_gun=float(tarife.get("kademe_kwh_gun") or 0), kademe_kwh_ay=float(tarife.get("kademe_kwh_ay") or 0))
    gunler = [calendar.monthrange(yil, m)[1] for m in range(1, 13)]
    gun_yil = sum(gunler)
    T, H = togg_gun * gun_yil, ev_gun * gun_yil
    top = T + H
    hak = max(0.0, min(T, limit_kwh * 0.95 - H))                 # limit içinde Togg'un evde şarj hakkı (%5 pay)
    ev_hak = sum(ay_maliyeti(t, (ev_gun + hak / gun_yil) * g, False, i + 1) for i, g in enumerate(gunler))
    evde = top * sktt_tl
    dc_ind = ev_hak + (T - hak) * dc_tl
    return {"evde": evde <= dc_ind, "evde_tl": round(evde), "dc_tl": round(dc_ind),
            "dc_tam_tl": round(ev_hak + (T - hak) * dc_tam_tl), "esik_sktt": round(dc_ind / top, 3),
            "fark_tl": round(abs(dc_ind - evde)), "togg_kwh": round(T), "ev_kwh": round(H)}


PO_ISTANBUL = "https://www.petrolofisi.com.tr/akaryakit-fiyatlari/istanbul-akaryakit-fiyatlari"


def oku_po_lpg(sayfa: str, bolge: str = "ISTANBUL (AVRUPA)") -> float:
    """Petrol Ofisi il fiyat tablosundan otogaz (PO/gaz) litre fiyatı, KDV dahil ₺/L.
    Tablo başlığındaki ürün sırasına göre okunur; satırda her ürün için önce KDV dahil, sonra hariç fiyat var."""
    import html as _h
    metin = lambda x: _h.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x))).strip()
    tablo = sayfa[sayfa.find("<table"):]
    basliklar = [metin(h) for h in re.findall(r"<th[^>]*>(.*?)</th>", tablo, re.S)]
    urunler = [b for b in basliklar if b and b.lower() != "şehir"]
    sira = next((i for i, b in enumerate(urunler) if "otogaz" in b.lower()), None)
    if sira is None:
        raise ValueError("PO tablosunda otogaz sütunu yok")
    for satir in re.findall(r"<tr[^>]*>(.*?)</tr>", tablo, re.S):
        if bolge in metin(satir).upper():
            sayilar = [float(x) for x in re.findall(r"\b\d{1,3}\.\d{2}\b", metin(satir))]
            if len(sayilar) < 2 * (sira + 1):
                raise ValueError(f"PO satırı eksik: {sayilar}")
            fiyat = sayilar[2 * sira]
            if not 15 < fiyat < 200:
                raise ValueError(f"LPG fiyatı olağan dışı: {fiyat}")
            return fiyat
    raise ValueError(f"PO tablosunda {bolge} yok")


def tl(x: float) -> str:
    return f"{x:.2f}".replace(".", ",")


class Kontrol:
    def __init__(self, kuru: bool = False):
        from collector import CFG_FILE, load_json
        from fb import FB
        from notify import Notifier
        self.cfg = load_json(CFG_FILE, {})
        self.fb = FB(self.cfg["firebase_url"], self.cfg.get("base_path", ""), self.cfg.get("firebase_secret", ""))
        self.ntfy = Notifier(self.cfg.get("ntfy_topic", ""), self.cfg.get("app_url", ""))
        self.kuru = kuru
        self.durum = self.fb.get("settings/tarife_oto") or {}

    def yaz(self, yol: str, veri: dict):
        if self.kuru:
            print("  [kuru] yazılmadı:", yol, veri)
        else:
            self.fb.patch(yol, veri)

    def bildir(self, baslik: str, mesaj: str, **kw):
        print(f"  BİLDİRİM: {baslik} — {mesaj}")
        if not self.kuru:
            self.ntfy.send(baslik, mesaj, open_tab="ayarlar", **kw)

    def uyar(self, neden: str):
        """Okunamadı ya da çelişki: hiçbir şey değiştirme, haftada en fazla bir kez haber ver."""
        print("  UYARI:", neden)
        if time.time() - float(self.durum.get("son_uyari", 0)) > UYARI_ARALIGI:
            self.bildir("Tarife değişmiş olabilir, Kontrol et..!!",
                        f"Otomatik tarife kontrolü yapılamadı: {neden[:160]}", tags="warning", priority=3)
            self.durum["son_uyari"] = int(time.time())

    def karar_kontrol(self, bugun: date):
        S = self.fb.get("settings") or {}
        cihazlar = self.fb.get("devices") or {}
        ev_id = next((k for k, d in cihazlar.items() if d.get("type") == "ana_sayac" and d.get("enabled")), None)
        togglar = [k for k, d in cihazlar.items() if d.get("type") == "ev_sarj" and d.get("enabled")]
        gecmis = (S.get("ev_history") or {}).get("days") or {}
        gunler = {(bugun - timedelta(days=i + 1)).isoformat() for i in range(60)}
        togg = sum(float(v) for k, v in gecmis.items() if k in gunler)
        for d in togglar:
            togg += sum(float(v) for k, v in (self.fb.get(f"days/{d}") or {}).items() if k in gunler)
        togg_gun = togg / 60
        # ev toplamı: son iki tam ayın (fatura ya da sayaç, büyüğü) günlük ortalaması
        import calendar
        top_kwh, top_gun = 0.0, 0
        for geri in (1, 2):
            yy, mm = bugun.year, bugun.month - geri
            if mm <= 0:
                yy, mm = yy - 1, mm + 12
            fatura = float(((S.get("bills") or {}).get(str(yy)) or {}).get(f"{mm:02d}") or 0)
            sayac = float(self.fb.get(f"months/{ev_id}/{yy}-{mm:02d}") or 0) if ev_id else 0.0
            k = max(fatura, sayac)
            if k > 0:
                top_kwh += k
                top_gun += calendar.monthrange(yy, mm)[1]
        if not top_gun or togg_gun < 0.5:
            print("  Şarj kararı için yeterli veri yok")
            return
        ev_gun = max(0.0, top_kwh / top_gun - togg_gun)
        bu = (S.get("tariff") or {}).get(str(bugun.year)) or {}
        sonraki = (S.get("tariff") or {}).get(str(bugun.year + 1)) or {}
        car = S.get("car") or {}
        from tariff import yasal_limit
        k = sarj_karari(ev_gun, togg_gun, bu, float(sonraki.get("limit_kwh") or yasal_limit(bugun.year + 1)),
                        float(bu.get("sktt_tl") or 6.5), float(car.get("public_tl") or 12),
                        float(car.get("public_tl_tam") or 14.9), bugun.year + 1)
        onceki = (self.durum.get("karar") or {}).get("evde")
        print(f"Şarj kararı {bugun.year + 1}: {'EVDE' if k['evde'] else 'DC'} (evde {k['evde_tl']} ₺, "
              f"DC {k['dc_tl']} ₺, eşik son kaynak {k['esik_sktt']} ₺)")
        if onceki is not None and onceki != k["evde"]:
            if k["evde"]:
                self.bildir("Togg'u yeniden evde şarj et",
                            f"Evde şarj artık DC'den ucuz: yılda ≈ {k['fark_tl']:,} ₺ fark".replace(",", "."),
                            tags="house", priority=4)
            else:
                self.bildir("Artık DC şarj daha ucuz",
                            f"Son kaynak fiyatı yükseldi; limit içinde kalıp DC'de şarj etmek yılda ≈ "
                            f"{k['fark_tl']:,} ₺ daha ucuz".replace(",", "."), tags="zap", priority=4)
        self.durum["karar"] = {**k, "kontrol": bugun.isoformat()}

    def calis(self):
        bugun = date.today()
        y = str(bugun.year)
        tarife = (self.fb.get(f"settings/tariff/{y}") or {})
        # 1) Normal ve üç zamanlı tarife: doğrudan EPDK
        dagitim_tl = None
        try:
            oturum = requests.Session()
            karar = epdk_son_karar(oturum)
            if karar["gecerli"] > bugun:
                print(f"EPDK kararı {karar['karar']} {karar['gecerli']} tarihinde geçerli olacak; bekleniyor")
                karar = None
            if karar:
                xlsx = oturum.get(EPDK + "/Detay/DownloadDocument", params={"id": karar["dosya"]},
                                  headers={**UA, "Referer": EPDK_SAYFA}, timeout=60).content
                v = oku_epdk_excel(xlsx)
                dagitim_tl = v["d"] / 100
                yeni = {"normal_tl": fiyat(v["e1"] / 100, dagitim_tl), "kademe2_tl": fiyat(v["e2"] / 100, dagitim_tl),
                        "uc_gunduz": fiyat(v["gunduz"] / 100, dagitim_tl), "uc_puant": fiyat(v["puant"] / 100, dagitim_tl),
                        "uc_gece": fiyat(v["gece"] / 100, dagitim_tl)}
                eski = {k: float(tarife.get(k) or 0) for k in yeni}
                print(f"EPDK kararı {karar['karar']} ({karar['gecerli']}): {eski} → {yeni}")
                if eski["normal_tl"] and not (0.6 < yeni["normal_tl"] / eski["normal_tl"] < 1.8):
                    raise ValueError(f"değişim olağan dışı büyük: {eski['normal_tl']} → {yeni['normal_tl']}")
                degisen = {k: x for k, x in yeni.items() if abs(x - eski[k]) > 0.002}
                if degisen:
                    self.yaz(f"settings/tariff/{y}", degisen)
                if "normal_tl" in degisen or "kademe2_tl" in degisen:
                    e1, y1 = eski["normal_tl"], yeni["normal_tl"]
                    zam = y1 > e1
                    self.bildir("Elektrik Tarifesine Zam Geldi..!!" if zam else "Elektrik Tarifesi Düştü..!!",
                                f"Yeni tarife: {tl(e1)} → {tl(y1)} ₺/kWh, uygulandı\n"
                                f"Kademe üstü: {tl(eski['kademe2_tl'])} → {tl(yeni['kademe2_tl'])} ₺/kWh\n"
                                f"EPDK kararı {karar['karar']}, {karar['gecerli'].strftime('%d.%m.%Y')}'ten itibaren",
                                tags="chart_with_upwards_trend" if zam else "chart_with_downwards_trend", priority=4)
                self.durum["tarife"] = {**v, "karar": karar["karar"], "gecerli": karar["gecerli"].isoformat(),
                                        "kontrol": bugun.isoformat()}
        except Exception as e:
            self.uyar(f"EPDK tarife tablosu: {e}")
        # 2) SKTT: geçen ay için, ayda bir
        gy, ga = (bugun.year - 1, 12) if bugun.month == 1 else (bugun.year, bugun.month - 1)
        gecen_ym = f"{gy}-{ga:02d}"
        if self.durum.get("sktt_ay") != gecen_ym:
            try:
                import calendar
                gun_sayisi = calendar.monthrange(gy, ga)[1]
                if dagitim_tl is None:
                    dagitim_tl = (self.durum.get("tarife") or {}).get("d", 242.49) / 100
                piyasa = requests.get(PIYASA, timeout=25).json()
                gunler = ayna_ptf(piyasa, gecen_ym)
                # YEKDEM: Resmî Gazete'deki EPDK öngörüsü; yoksa aynadan (karar numarasıyla) ekle
                yk = (self.fb.get(f"settings/yekdem/{gecen_ym}") or {})
                if not yk:
                    adaylar = [x for x in piyasa.get("yekdemUnitCosts", [])
                               if int(x.get("year", 0)) == gy and int(x.get("month", 0)) == ga]
                    if not adaylar:
                        raise ValueError(f"{gecen_ym} için YEKDEM öngörüsü bulunamadı")
                    yk = {"tl_mwh": float(adaylar[-1]["unitCostPerMwh"]), "kaynak": adaylar[-1].get("source", "")}
                    self.yaz(f"settings/yekdem/{gecen_ym}", yk)
                    self.bildir("YEKDEM öngörüsü eklendi",
                                f"{gecen_ym}: {yk['tl_mwh']:.2f} TL/MWh — {yk['kaynak'] or 'kaynak belirtilmemiş'}",
                                tags="memo", priority=2)
                s = sktt_hesapla(gunler, gun_sayisi, float(yk["tl_mwh"]), dagitim_tl, gecen_ym)
                s["yekdem_kaynak"] = yk.get("kaynak", "")
                eski = float(tarife.get("sktt_tl") or 0)
                print(f"SKTT {gecen_ym}: PTF {s['ptf']} ({s['gun']} gün)"
                      f" + YEKDEM {s['yekdem']} → {s['sktt_tl']} (eski {eski})")
                if abs(s["sktt_tl"] - eski) > 0.005:
                    self.yaz(f"settings/tariff/{y}", {"sktt_tl": s["sktt_tl"]})
                    self.bildir("Son kaynak fiyatı güncellendi",
                                f"{gecen_ym} piyasa fiyatlarıyla SKTT: {tl(eski)} → {tl(s['sktt_tl'])} ₺/kWh",
                                tags="zap", priority=2)
                self.durum["sktt_ay"] = gecen_ym
                self.durum["sktt"] = s
            except Exception as e:
                self.uyar(f"SKTT: {e}")
        # 3) LPG fiyatı (km başı kıyas kartı için): Petrol Ofisi İstanbul Avrupa otogaz
        try:
            lpg = oku_po_lpg(requests.get(PO_ISTANBUL, headers=UA, timeout=30).text)
            eski = float((self.fb.get("settings/car/lpg_tl") or 0))
            print(f"LPG (PO İstanbul Avrupa): {lpg} ₺/L (eski {eski})")
            if abs(lpg - eski) > 0.005:
                self.yaz("settings/car", {"lpg_tl": lpg})
                if eski:
                    self.bildir("LPG fiyatı " + ("arttı" if lpg > eski else "düştü"),
                                f"Otogaz {tl(eski)} → {tl(lpg)} ₺/L (İstanbul Avrupa); km başı kıyas güncellendi.",
                                tags="fuelpump", priority=1)
            self.yaz("settings/car/lpg_guncel", {"tarih": bugun.isoformat(), "kaynak": "Petrol Ofisi · İstanbul Avrupa"})
        except Exception as e:
            print("  LPG fiyatı okunamadı:", e)
        # 4) Şarj kararı (evde mi, DC mi?) — sonuç değişirse bildir
        try:
            self.karar_kontrol(bugun)
        except Exception as e:
            print("  Şarj kararı hesaplanamadı:", e)
        self.durum["son_calisma"] = datetime.now().isoformat(timespec="seconds")
        self.yaz("settings/tarife_oto", self.durum)


if __name__ == "__main__":
    Kontrol(kuru="--kuru" in sys.argv).calis()
