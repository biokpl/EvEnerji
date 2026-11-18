// Yolculuk planlayıcı: varış yerinin hava tahmini + öğrenilen tüketim ile kaç yüzdeye şarj etmeli, yolda DC
// gerekir mi, masraf ve LPG'li araçla fark. Mesafeler İstanbul Avrupa yakasından karayoluyla yaklaşıktır.
export const SEHIRLER = [
  ['Şile', 75, 41.18, 29.61], ['Ağva', 100, 41.14, 29.85], ['İzmit', 100, 40.77, 29.92], ['Yalova', 105, 40.65, 29.27],
  ['Tekirdağ', 135, 40.98, 27.51], ['Sakarya', 150, 40.78, 30.40], ['Bursa', 155, 40.19, 29.06],
  ['Kırklareli', 210, 41.73, 27.22], ['Edirne', 235, 41.68, 26.56], ['Bolu', 260, 40.74, 31.61],
  ['Balıkesir', 260, 39.65, 27.88], ['Çanakkale', 320, 40.15, 26.41], ['Eskişehir', 320, 39.78, 30.52],
  ['Ankara', 450, 39.93, 32.86], ['İzmir', 470, 38.42, 27.14], ['Bodrum', 690, 37.03, 27.43], ['Antalya', 700, 36.90, 30.71],
];
export const OTOYOL_KATSAYI = 1.2;     // 110–120 km/sa'te tüketim şehir/karma sürüşe göre ≈ %20 fazla
const YEDEK = 15;                      // varışta en az %15 kalsın
const DC_HEDEF = 80;                   // yolda DC'de %80'e kadar (üstü yavaş)

// Varış yeri ve İstanbul için o günün ortalama sıcaklığı (Open-Meteo, en çok 16 gün ileri)
export async function yolHavasi(lat, lon, gun) {
  const url = (la, lo) => `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&daily=temperature_2m_mean&timezone=Europe%2FIstanbul&start_date=${gun}&end_date=${gun}`;
  try {
    const [a, b] = await Promise.all([fetch(url(41.01, 28.97)), fetch(url(lat, lon))].map((p) => p.then((r) => r.json())));
    const t = [a, b].map((j) => j?.daily?.temperature_2m_mean?.[0]).filter(Number.isFinite);
    return t.length ? t.reduce((x, y) => x + y, 0) / t.length : null;
  } catch { return null; }
}

// km: tek yön; gidisDonus: dönüşte varışta şarj yok sayılır
export function planla({ km, gidisDonus, T, M }) {
  const car = M.car, cap = Number(car.battery_kwh) || 88.5, eff = M.carEff || 0.87;
  const O = M.ogrenme;
  const c = (O?.model ? O.model.tahmin(T) : M.aracTuketim) * OTOYOL_KATSAYI;   // kWh/100 km
  const topKm = km * (gidisDonus ? 2 : 1);
  const kwh = (topKm * c) / 100;
  const kullan = (kwh / cap) * 100;                                             // yolculuğun yüzdesi
  const gerekYuzde = kullan + YEDEK;
  const basla = Math.min(100, Math.ceil(gerekYuzde / 5) * 5);                   // 5'in katına yuvarla
  // %100'le çıkınca en az %5 kalıyorsa DC gerekmez (yedek biraz azalır); yoksa eksik DC'de tamamlanır
  const eksik = kullan + 5 <= 100 ? 0 : Math.max(0, gerekYuzde - 100);
  const dcKwh = (eksik / 100) * cap / 0.95;                                     // DC kaybı ≈ %5
  const dcDurak = eksik > 0 ? Math.ceil(eksik / (DC_HEDEF - YEDEK)) : 0;
  const evKwh = ((Math.min(100, gerekYuzde) / 100) * cap) / eff;                // evden çekilecek (kabaca)
  const evTl = ((kwh - (eksik / 100) * cap) / eff) * M.toggAyBirim(M.mi);
  const dcTl = dcKwh * (Number(car.public_tl) || 12);
  const lpgTl = (topKm * (Number(car.lpg_l100) || 10) / 100) * (Number(car.lpg_tl) || 50.7);
  const tekYon = (((km * c) / 100) / cap) * 100;
  const varis = eksik ? Math.max(YEDEK, basla - tekYon) : basla - tekYon;
  const donus = gidisDonus ? (eksik ? YEDEK : basla - kullan) : null;
  return { c, topKm, kwh, basla, varis, donus, dcDurak, dcKwh, evKwh, tl: evTl + dcTl, evTl, dcTl, lpgTl, T };
}
