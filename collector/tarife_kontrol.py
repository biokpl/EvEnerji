"""Elektrik tarifesi ve son kaynak (SKTT) fiyatını internetten kendiliğinden günceller.

Her sabah çalışır (systemd: tarife-kontrol.timer); yalnız bir şey değişince bildirim gönderir.

Normal tarife (mesken, tek zamanlı, kademeli):
  verinokta.com tablosundan vergisiz birim bedeller (kr/kWh): düşük/yüksek kademe enerji + dağıtım.
  Çapraz kontrol: hakedis.org'daki bu ayın mesken dağıtım bedeli aynı olmalı. Çelişki ya da
  okunamama → hiçbir şey değiştirilmez, "Tarife değişmiş olabilir, Kontrol et..!!" bildirimi.

SKTT (aylık):
  EPİAŞ verisinin herkese açık aynasından (jsDelivr) geçen ayın ortalama PTF'si + o ayın YEKDEM'i.
  enerji = (PTF + YEKDEM) × 1,05 (EPDK katsayısı)

Faturaya esas fiyat (kullanıcının faturasıyla doğrulandı: 3,238 / 4,857 ₺):
  fiyat = (enerji + dağıtım + enerji × %5 BTV) × 1,10 (KDV)

  python tarife_kontrol.py            # kontrol et, gerekirse güncelle ve bildir
  python tarife_kontrol.py --kuru     # yalnız göster, hiçbir şey yazma/gönderme
"""
from __future__ import annotations

import html
import json
import re
import statistics
import sys
import time
from datetime import date, datetime
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

VERINOKTA = "https://verinokta.com/fiyatlar/elektrik-tarifeleri/"
HAKEDIS = "https://www.hakedis.org/endeksler/epdk-elektrik-farturasi-vergi-ve-tarifeler"
PIYASA = "https://cdn.jsdelivr.net/gh/06maslan27/fatura-dedektifi-veri@main/data/piyasa/ptf-yekdem.json"
UA = {"User-Agent": "Mozilla/5.0 (EvEnerji tarife kontrol)"}

BTV, KDV, SKTT_KATSAYI = 0.05, 0.10, 1.05
AYLAR = ["OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN",
         "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"]
UYARI_ARALIGI = 7 * 86400     # "kontrol et" bildirimi en fazla haftada bir


def fiyat(enerji_tl: float, dagitim_tl: float) -> float:
    """Vergisiz enerji + dağıtım (₺/kWh) → faturaya esas birim fiyat (₺/kWh)."""
    return round((enerji_tl + dagitim_tl + enerji_tl * BTV) * (1 + KDV), 3)


def _sayi(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


def _hucreler(satir: str) -> list[str]:
    return [" ".join(html.unescape(re.sub(r"<[^>]+>", " ", c)).split())
            for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", satir, re.S)]


def oku_verinokta(sayfa: str) -> dict:
    """Mesken satırı: düşük enerji, yüksek enerji, dağıtım (kr/kWh)."""
    for satir in re.findall(r"<tr.*?</tr>", sayfa, re.S):
        h = _hucreler(satir)
        if len(h) >= 4 and h[0] == "Mesken":
            e1, e2, d = (_sayi(x) for x in h[1:4])
            if not (0 < e1 < e2 < 2000 and 50 < d < 2000):
                raise ValueError(f"verinokta değerleri olağan dışı: {h}")
            return {"e1": e1, "e2": e2, "d": d}
    raise ValueError("verinokta: Mesken satırı bulunamadı")


def oku_hakedis_dagitim(sayfa: str, gun: date) -> float:
    """Bu ayın mesken (AG, tek terim) dağıtım bedeli, kr/kWh."""
    ay = AYLAR[gun.month - 1]
    for tablo in re.findall(r"<table.*?</table>", sayfa, re.S):
        satirlar = re.findall(r"<tr.*?</tr>", tablo, re.S)
        if not satirlar:
            continue
        basliklar = _hucreler(satirlar[0])
        aylar = [b.upper() for b in basliklar if b]
        if ay not in aylar:
            continue
        sira = aylar.index(ay)          # her ay iki sütun: dağıtım, reaktif
        for satir in satirlar[2:]:
            h = _hucreler(satir)
            if len(h) > 2 and h[0] == "Mesken" and h[1] == "Tek":
                return _sayi(h[2 + 2 * sira])     # ilk "Mesken Tek" = alçak gerilim
    raise ValueError(f"hakedis: {ay} için mesken dağıtım bedeli bulunamadı")


def sktt_hesapla(piyasa: dict, yil: int, ay: int, dagitim_tl: float) -> dict:
    """Verilen ayın ortalama PTF'si ve YEKDEM'inden SKTT (vergiler dahil, ₺/kWh)."""
    ym = f"{yil}-{ay:02d}"
    ptf = [float(p["price"]) for s in piyasa.get("priceSeries", []) for p in s.get("points", [])
           if str(p.get("date", "")).startswith(ym)]
    yk = [float(x["unitCostPerMwh"]) for x in piyasa.get("yekdemUnitCosts", [])
          if int(x.get("year", 0)) == yil and int(x.get("month", 0)) == ay]
    if len(ptf) < 20 or not yk:
        raise ValueError(f"{ym} için piyasa verisi eksik (PTF {len(ptf)} gün, YEKDEM {len(yk)})")
    ptf_ort = statistics.mean(ptf)
    if not (0.3 < ptf_ort < 20):
        raise ValueError(f"PTF olağan dışı: {ptf_ort}")
    enerji = (ptf_ort + yk[-1] / 1000) * SKTT_KATSAYI    # aynı ay revize edildiyse sonraki geçerli
    return {"ay": ym, "ptf": round(ptf_ort, 4), "yekdem": round(yk[-1] / 1000, 4),
            "sktt_tl": fiyat(enerji, dagitim_tl)}


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

    def calis(self):
        bugun = date.today()
        y = str(bugun.year)
        tarife = (self.fb.get(f"settings/tariff/{y}") or {})
        # 1) Normal tarife
        dagitim_tl = None
        try:
            v = oku_verinokta(requests.get(VERINOKTA, headers=UA, timeout=25).text)
            d_hk = oku_hakedis_dagitim(requests.get(HAKEDIS, headers=UA, timeout=25).text, bugun)
            if abs(d_hk - v["d"]) > 0.01:
                raise ValueError(f"kaynaklar çelişiyor: dağıtım {v['d']} ≠ {d_hk} kr/kWh")
            dagitim_tl = v["d"] / 100
            yeni1, yeni2 = fiyat(v["e1"] / 100, dagitim_tl), fiyat(v["e2"] / 100, dagitim_tl)
            eski1, eski2 = float(tarife.get("normal_tl") or 0), float(tarife.get("kademe2_tl") or 0)
            print(f"Normal tarife: {eski1} / {eski2} → {yeni1} / {yeni2}")
            if eski1 and not (0.6 < yeni1 / eski1 < 1.8):
                raise ValueError(f"değişim olağan dışı büyük: {eski1} → {yeni1}")
            if abs(yeni1 - eski1) > 0.002 or abs(yeni2 - eski2) > 0.002:
                self.yaz(f"settings/tariff/{y}", {"normal_tl": yeni1, "kademe2_tl": yeni2})
                zam = yeni1 > eski1
                self.bildir("Elektrik Tarifesine Zam Geldi..!!" if zam else "Elektrik Tarifesi Düştü..!!",
                            f"Yeni tarife: {tl(eski1)} → {tl(yeni1)} ₺/kWh, uygulandı\n"
                            f"Kademe üstü: {tl(eski2)} → {tl(yeni2)} ₺/kWh",
                            tags="chart_with_upwards_trend" if zam else "chart_with_downwards_trend", priority=4)
            self.durum["tarife"] = {"e1": v["e1"], "e2": v["e2"], "d": v["d"], "kontrol": bugun.isoformat()}
        except Exception as e:
            self.uyar(f"normal tarife: {e}")
        # 2) SKTT: geçen ayın piyasa verisiyle, ayda bir
        gecen = (bugun.year - (bugun.month == 1), 12 if bugun.month == 1 else bugun.month - 1)
        gecen_ym = f"{gecen[0]}-{gecen[1]:02d}"
        if self.durum.get("sktt_ay") != gecen_ym:
            try:
                if dagitim_tl is None:
                    dagitim_tl = (self.durum.get("tarife") or {}).get("d", 242.49) / 100
                piyasa = requests.get(PIYASA, timeout=25).json()
                uretim = datetime.fromisoformat(piyasa["generatedAt"].replace("Z", "+00:00")).timestamp()
                if time.time() - uretim > 10 * 86400:
                    raise ValueError("piyasa verisi 10 günden eski")
                s = sktt_hesapla(piyasa, gecen[0], gecen[1], dagitim_tl)
                eski = float(tarife.get("sktt_tl") or 0)
                print(f"SKTT {s['ay']}: PTF {s['ptf']} + YEKDEM {s['yekdem']} → {s['sktt_tl']} (eski {eski})")
                if abs(s["sktt_tl"] - eski) > 0.005:
                    self.yaz(f"settings/tariff/{y}", {"sktt_tl": s["sktt_tl"]})
                    self.bildir("Son kaynak fiyatı güncellendi",
                                f"{gecen_ym} piyasa fiyatlarıyla SKTT: {tl(eski)} → {tl(s['sktt_tl'])} ₺/kWh",
                                tags="zap", priority=2)
                self.durum["sktt_ay"] = gecen_ym
                self.durum["sktt"] = s
            except Exception as e:
                self.uyar(f"SKTT: {e}")
        self.durum["son_calisma"] = datetime.now().isoformat(timespec="seconds")
        self.yaz("settings/tarife_oto", self.durum)


if __name__ == "__main__":
    Kontrol(kuru="--kuru" in sys.argv).calis()
