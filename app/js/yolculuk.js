// Yolculuk planlayıcı: varış yerinin hava tahmini + öğrenilen tüketim ile kaç yüzdeye şarj etmeli, yolda DC
// gerekir mi, masraf ve LPG'li araçla fark. Mesafeler İstanbul Avrupa yakasından karayoluyla yaklaşıktır.
export const SEHIRLER = [
  ['Antalya', 700, 36.90, 30.71], ['Adana', 940, 37.00, 35.32],
  ['Şile', 75, 41.18, 29.61], ['Ağva', 100, 41.14, 29.85], ['İzmit', 100, 40.77, 29.92], ['Yalova', 105, 40.65, 29.27],
  ['Tekirdağ', 135, 40.98, 27.51], ['Sakarya', 150, 40.78, 30.40], ['Bursa', 155, 40.19, 29.06],
  ['Kırklareli', 210, 41.73, 27.22], ['Edirne', 235, 41.68, 26.56], ['Bolu', 260, 40.74, 31.61],
  ['Balıkesir', 260, 39.65, 27.88], ['Çanakkale', 320, 40.15, 26.41], ['Eskişehir', 320, 39.78, 30.52],
  ['Ankara', 450, 39.93, 32.86], ['İzmir', 470, 38.42, 27.14], ['Bodrum', 690, 37.03, 27.43],
];
export const OTOYOL_KATSAYI = 1.12;    // varsayılan 110 km/sa: öğrenilen karma tüketimden ≈ %12 fazla
// Hız seçimi: hava direnci hızın karesiyle artar. [hız, elektrikli katsayı, LPG katsayı]
// Elektrikli: öğrenilen karma tüketim temel. LPG: kullanıcının ortalaması (41 L / 410 km, Ayarlar) 110 km/sa kabul;
// motor yük arttıkça biraz verimlendiği için oransal artış elektrikliden az.
export const HIZLAR = [[90, 1.0, 1.0], [110, 1.12, 1.08], [120, 1.22, 1.15], [130, 1.34, 1.23], [140, 1.47, 1.32]];
export const YEDEK = 20;               // durağa ve varışa en az %20 ile (otoyolda ≈ 75 km yedek; istasyon dolu/arızalıysa sonrakine yeter)
const DC_KW = 150;                     // DC şarj gücü (kullanıcı: 150 kW ile hesapla; bağlanınca şarj hemen başlıyor)
const DC_HEDEF = 80;                   // yolda DC'de %80'e kadar (üstü yavaş)

// Varış yeri ve İstanbul için o günün ortalama sıcaklığı (Open-Meteo, en çok 16 gün ileri)
const havaBellek = new Map();                                     // aynı gün/şehir için tekrar ağa gitme
export async function yolHavasi(lat, lon, gun) {
  const anahtar = `${lat},${lon},${gun}`;
  if (havaBellek.has(anahtar)) return havaBellek.get(anahtar);
  const T = await yolHavasiAg(lat, lon, gun);
  if (T != null) havaBellek.set(anahtar, T);
  return T;
}
async function yolHavasiAg(lat, lon, gun) {
  const url = (la, lo) => `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&daily=temperature_2m_mean&timezone=Europe%2FIstanbul&start_date=${gun}&end_date=${gun}`;
  try {
    const [a, b] = await Promise.all([fetch(url(41.01, 28.97)), fetch(url(lat, lon))].map((p) => p.then((r) => r.json())));
    const t = [a, b].map((j) => j?.daily?.temperature_2m_mean?.[0]).filter(Number.isFinite);
    return t.length ? t.reduce((x, y) => x + y, 0) / t.length : null;
  } catch { return null; }
}

// km: tek yön; gidisDonus: dönüşte varışta şarj yok sayılır; katsayi: hız seçimi
export function planla({ km, gidisDonus, T, M, katsayi = OTOYOL_KATSAYI, lpgKatsayi = 1.08 }) {
  const LPG_110 = 1.08;                                                         // tablodaki 110 km/sa katsayısı
  const car = M.car, cap = Number(car.battery_kwh) || 88.5, eff = M.carEff || 0.87;
  const O = M.ogrenme;
  const temel = O?.model ? O.model.tahmin(T) : M.aracTuketim;
  const c = temel * katsayi;                                                    // kWh/100 km
  const topKm = km * (gidisDonus ? 2 : 1);
  const kwh = (topKm * c) / 100;
  const kullan = (kwh / cap) * 100;                                             // yolculuğun yüzdesi
  const yuzdeKm = (yuzde) => ((yuzde / 100) * cap / c) * 100;                   // bu kadar yüzdeyle gidilen km
  const basla = Math.min(100, Math.ceil((kullan + YEDEK) / 5) * 5);
  // Durak durak: %YEDEK'e inince dur, kalan yola yetecek kadar (en çok %DC_HEDEF) şarj et
  const duraklar = [];
  let soc = basla, gidilen = 0;
  if (kullan + 5 > 100) {                                                       // %100'le de yetmiyor
    for (let i = 0; i < 12; i++) {
      const menzil = yuzdeKm(soc - YEDEK);
      if (gidilen + menzil >= topKm) break;
      if (gidilen + yuzdeKm(soc - 12) >= topKm) break;                       // birkaç km için durma: varışta %12+ kalır
      gidilen += menzil;
      const kalan = ((topKm - gidilen) * c / 100 / cap) * 100;                 // kalan yolun yüzdesi
      const hedef = Math.min(DC_HEDEF, Math.ceil((kalan + YEDEK) / 5) * 5);
      const bat = ((hedef - YEDEK) / 100) * cap;
      duraklar.push({ km: gidilen, bas: YEDEK, son: hedef, kwh: bat / 0.95, dk: Math.max(1, Math.round((bat / DC_KW) * 60)) });
      soc = hedef;
    }
  }
  const dcKwh = duraklar.reduce((t, d) => t + d.kwh, 0);
  const dcBat = dcKwh * 0.95;
  const evBirim = M.toggAyBirim(M.mi), evKwhCek = (kwh - dcBat) / eff;          // evden çekilen (şarj kaybı dahil)
  const evTl = evKwhCek * evBirim;
  const dcTl = dcKwh * (Number(car.public_tl) || 12);
  const lpgL100 = (Number(car.lpg_l100) || 10) * (lpgKatsayi / LPG_110);           // ortalama 110 km/sa kabul
  const lpgTl = (topKm * lpgL100 / 100) * (Number(car.lpg_tl) || 50.7);
  const sonSoc = soc - (((topKm - gidilen) * c / 100) / cap) * 100;             // yolculuk sonunda
  const tekYonSoc = gidisDonus ? null : sonSoc;
  const varis = gidisDonus ? (duraklar.length ? null : basla - (((km * c) / 100) / cap) * 100) : sonSoc;
  return { c, temel, topKm, kwh, basla, varis, donus: gidisDonus ? sonSoc : null, dcDurak: duraklar.length, duraklar, dcKwh,
    menzil: yuzdeKm(100 - YEDEK), yedekKm: yuzdeKm(YEDEK), molaDk: duraklar.reduce((t, d) => t + d.dk, 0), tl: evTl + dcTl, evTl, evKwhCek, evBirim, dcTl, lpgTl, lpgL100, T, tekYonSoc };
}
