"""Tarife motoru: yıllık son kaynak (SKTT) limiti, aylık maliyet, yıl sonu tahmini.

Kurallar (EPDK, 2026):
- Mesken için yıllık limit 4.000 kWh (2027 için 3.000-3.500 konuşuluyor).
- Takvim yılı içinde kümülatif tüketim limiti aşarsa, aşılan ayı izleyen
  ÜÇÜNCÜ ayın 1'inden itibaren son kaynak fiyatı uygulanır.
- Yeni yılın limiti önceki yılın tüketimine bakılarak uygulanır: önceki yıl
  tüketimi bu yılın limitini aşmışsa bütün yıl son kaynak fiyatıdır.
Uygulamadaki js/tariff.js aynı mantığın birebir kopyasıdır.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date

GECIS_GECIKME_AY = 3  # aşılan ayı izleyen 3. ayın 1'i


@dataclass
class Tarife:
    yil: int
    limit_kwh: float = 4000.0
    normal_tl: float = 3.24          # vergiler dahil TL/kWh
    sktt_tl: float = 6.49            # son kaynak, vergiler dahil TL/kWh
    kademe_kwh_ay: float = 0.0       # 0 = kademe yok
    kademe2_tl: float = 0.0          # aylık kademe üstü fiyat
    onceki_yil_kwh: float | None = None

    @classmethod
    def from_dict(cls, yil: int, d: dict | None) -> "Tarife":
        d = d or {}
        t = cls(yil=yil)
        for k in ("limit_kwh", "normal_tl", "sktt_tl", "kademe_kwh_ay", "kademe2_tl"):
            if d.get(k) is not None:
                setattr(t, k, float(d[k]))
        if d.get("onceki_yil_kwh") is not None:
            t.onceki_yil_kwh = float(d["onceki_yil_kwh"])
        return t


@dataclass
class YilDurumu:
    aylik_kwh: list[float]                 # 12 eleman
    kumulatif: float
    asim_ayi: int | None                   # 1-12, limitin aşıldığı ay
    sktt_baslangic: tuple[int, int] | None # (yil, ay) son kaynak başlangıcı
    aylik_tl: list[float] = field(default_factory=list)
    toplam_tl: float = 0.0


def sktt_ayi_mi(t: Tarife, durum: YilDurumu, ay: int) -> bool:
    if t.onceki_yil_kwh is not None and t.onceki_yil_kwh > t.limit_kwh:
        return True
    if durum.sktt_baslangic is None:
        return False
    y, m = durum.sktt_baslangic
    return y == t.yil and ay >= m


def ay_maliyeti(t: Tarife, kwh: float, sktt: bool) -> float:
    if sktt:
        return kwh * t.sktt_tl
    if t.kademe_kwh_ay > 0 and t.kademe2_tl > 0 and kwh > t.kademe_kwh_ay:
        return t.kademe_kwh_ay * t.normal_tl + (kwh - t.kademe_kwh_ay) * t.kademe2_tl
    return kwh * t.normal_tl


def yil_durumu(t: Tarife, aylik_kwh: list[float]) -> YilDurumu:
    aylik = (list(aylik_kwh) + [0.0] * 12)[:12]
    kum, asim = 0.0, None
    for i, k in enumerate(aylik):
        kum += k
        if asim is None and kum > t.limit_kwh:
            asim = i + 1
    basla = None
    if asim is not None:
        m = asim + GECIS_GECIKME_AY
        basla = (t.yil, m) if m <= 12 else (t.yil + 1, m - 12)
    d = YilDurumu(aylik_kwh=aylik, kumulatif=kum, asim_ayi=asim, sktt_baslangic=basla)
    d.aylik_tl = [ay_maliyeti(t, aylik[i], sktt_ayi_mi(t, d, i + 1)) for i in range(12)]
    d.toplam_tl = sum(d.aylik_tl)
    return d


def birim_fiyat(t: Tarife, durum: YilDurumu, ay: int) -> float:
    """O aydaki son kWh'nin fiyatı (şarj oturumu maliyeti için)."""
    if sktt_ayi_mi(t, durum, ay):
        return t.sktt_tl
    if t.kademe_kwh_ay > 0 and t.kademe2_tl > 0 and durum.aylik_kwh[ay - 1] > t.kademe_kwh_ay:
        return t.kademe2_tl
    return t.normal_tl


def yil_sonu_tahmini(ytd_kwh: float, son30_kwh: float, bugun: date,
                     baslangic: date | None = None) -> float:
    """Yıl sonu tahmini: kalan günler son 30 günün ortalamasıyla dolar
    (dönem ortalamasıyla harmanlanır). Abonelik yıl içinde başladıysa
    (taşınma) ortalama o tarihten itibaren hesaplanır."""
    gun_yil = 366 if calendar.isleap(bugun.year) else 365
    gecen = bugun.timetuple().tm_yday
    kalan = gun_yil - gecen
    if baslangic and baslangic.year == bugun.year:
        gecen = max(1, gecen - baslangic.timetuple().tm_yday + 1)
    if gecen <= 0:
        return ytd_kwh
    ort_yil = ytd_kwh / gecen
    ort_30 = son30_kwh / 30.0 if son30_kwh > 0 else ort_yil
    gunluk = 0.6 * ort_30 + 0.4 * ort_yil
    return ytd_kwh + gunluk * kalan


def gunluk_butce(limit_kwh: float, ytd_kwh: float, bugun: date) -> float:
    gun_yil = 366 if calendar.isleap(bugun.year) else 365
    kalan = gun_yil - bugun.timetuple().tm_yday + 1
    return max(0.0, (limit_kwh - ytd_kwh) / max(1, kalan))


def gelecek_yil_senaryosu(bu_yil_tahmin_kwh: float, limitler=(3000, 3500, 4000)) -> dict:
    """Gelecek yıl limiti L olursa: bu yılın tüketimi L'yi aşıyorsa 1 Ocak'tan
    itibaren bütün yıl son kaynak fiyatı."""
    return {int(L): bu_yil_tahmin_kwh > L for L in limitler}
