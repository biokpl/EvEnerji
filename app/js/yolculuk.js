// Yolculuk planlayıcı: iki yer arası yol (OSRM ile gerçek karayolu km'si), hava tahmini + öğrenilen tüketim ile
// kaç yüzdeye şarj etmeli, yolda DC gerekir mi, masraf ve LPG'li araçla fark.
// Yerler: 81 il merkezi + sık gidilen tatil yerleri [ad, enlem, boylam]
export const IL = [
  ['Adana', 37.00, 35.32], ['Adıyaman', 37.76, 38.28], ['Afyonkarahisar', 38.76, 30.54], ['Ağrı', 39.72, 43.05],
  ['Aksaray', 38.37, 34.03], ['Amasya', 40.65, 35.83], ['Ankara', 39.93, 32.86], ['Antalya', 36.90, 30.71],
  ['Ardahan', 41.11, 42.70], ['Artvin', 41.18, 41.82], ['Aydın', 37.85, 27.84], ['Balıkesir', 39.65, 27.88],
  ['Bartın', 41.63, 32.34], ['Batman', 37.88, 41.13], ['Bayburt', 40.26, 40.23], ['Bilecik', 40.14, 29.98],
  ['Bingöl', 38.88, 40.50], ['Bitlis', 38.40, 42.11], ['Bolu', 40.74, 31.61], ['Burdur', 37.72, 30.29],
  ['Bursa', 40.19, 29.06], ['Çanakkale', 40.15, 26.41], ['Çankırı', 40.60, 33.62], ['Çorum', 40.55, 34.95],
  ['Denizli', 37.78, 29.09], ['Diyarbakır', 37.91, 40.24], ['Düzce', 40.84, 31.16], ['Edirne', 41.68, 26.56],
  ['Elazığ', 38.68, 39.22], ['Erzincan', 39.75, 39.49], ['Erzurum', 39.90, 41.27], ['Eskişehir', 39.78, 30.52],
  ['Gaziantep', 37.07, 37.38], ['Giresun', 40.91, 38.39], ['Gümüşhane', 40.46, 39.48], ['Hakkari', 37.58, 43.74],
  ['Hatay', 36.20, 36.16], ['Iğdır', 39.92, 44.04], ['Isparta', 37.76, 30.55], ['İstanbul', 41.01, 28.97],
  ['İzmir', 38.42, 27.14], ['Kahramanmaraş', 37.58, 36.94], ['Karabük', 41.20, 32.62], ['Karaman', 37.18, 33.22],
  ['Kars', 40.60, 43.10], ['Kastamonu', 41.38, 33.78], ['Kayseri', 38.73, 35.49], ['Kırıkkale', 39.85, 33.51],
  ['Kırklareli', 41.73, 27.22], ['Kırşehir', 39.15, 34.17], ['Kilis', 36.72, 37.12], ['Kocaeli', 40.77, 29.92],
  ['Konya', 37.87, 32.48], ['Kütahya', 39.42, 29.98], ['Malatya', 38.35, 38.31], ['Manisa', 38.61, 27.43],
  ['Mardin', 37.31, 40.74], ['Mersin', 36.80, 34.63], ['Muğla', 37.22, 28.36], ['Muş', 38.74, 41.49],
  ['Nevşehir', 38.62, 34.71], ['Niğde', 37.97, 34.68], ['Ordu', 40.98, 37.88], ['Osmaniye', 37.07, 36.25],
  ['Rize', 41.02, 40.52], ['Sakarya', 40.78, 30.40], ['Samsun', 41.29, 36.33], ['Siirt', 37.93, 41.94],
  ['Sinop', 42.03, 35.15], ['Sivas', 39.75, 37.02], ['Şanlıurfa', 37.16, 38.79], ['Şırnak', 37.52, 42.46],
  ['Tekirdağ', 40.98, 27.51], ['Tokat', 40.31, 36.55], ['Trabzon', 41.00, 39.72], ['Tunceli', 39.11, 39.55],
  ['Uşak', 38.68, 29.41], ['Van', 38.50, 43.38], ['Yalova', 40.65, 29.27], ['Yozgat', 39.82, 34.81],
  ['Zonguldak', 41.45, 31.79],
];
export const TATIL = [
  ['Ağva', 41.14, 29.85], ['Alanya', 36.54, 31.99], ['Ayvalık', 39.32, 26.69], ['Bodrum', 37.03, 27.43],
  ['Çeşme', 38.32, 26.30], ['Fethiye', 36.62, 29.12], ['Kapadokya (Göreme)', 38.64, 34.83], ['Kaş', 36.20, 29.64],
  ['Kuşadası', 37.86, 27.26], ['Marmaris', 36.85, 28.27], ['Şile', 41.18, 29.61], ['Uludağ', 40.10, 29.13],
];
const YER = Object.fromEntries([...IL, ...TATIL].map(([ad, la, lo]) => [ad, [la, lo]]));
export const yerKoord = (ad) => YER[ad];

// İki yer arası karayolu km'si: OSRM (açık yol tarifi servisi); ulaşılamazsa kuş uçuşu × 1,3
const mesafeBellek = new Map();
function kusUcusu([la1, lo1], [la2, lo2]) {
  const r = Math.PI / 180, a = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
export async function yolMesafesi(nereden, nereye) {
  const a = YER[nereden], b = YER[nereye];
  if (!a || !b || nereden === nereye) return null;
  const k = [nereden, nereye].sort().join('|');
  if (mesafeBellek.has(k)) return mesafeBellek.get(k);
  let km = null, kaynak = 'yol';
  try {
    const c = new AbortController(); const zt = setTimeout(() => c.abort(), 6000);
    const j = await (await fetch(`https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=false`, { signal: c.signal })).json();
    clearTimeout(zt);
    if (j.code === 'Ok') km = j.routes[0].distance / 1000;
  } catch { /* yedeğe düş */ }
  if (km == null) { km = kusUcusu(a, b) * 1.3; kaynak = 'tahmini'; }
  const sonuc = { km: Math.round(km), kaynak };
  if (kaynak === 'yol') mesafeBellek.set(k, sonuc);
  return sonuc;
}

export const OTOYOL_KATSAYI = 1.12;    // varsayılan 110 km/sa: öğrenilen karma tüketimden ≈ %12 fazla
// Hız seçimi: hava direnci hızın karesiyle artar. [hız, elektrikli katsayı, LPG katsayı]
// Elektrikli: öğrenilen karma tüketim temel. LPG: kullanıcının ortalaması (41 L / 410 km, Ayarlar) 110 km/sa kabul;
// motor yük arttıkça biraz verimlendiği için oransal artış elektrikliden az.
export const HIZLAR = [[90, 1.0, 1.0], [110, 1.12, 1.08], [120, 1.22, 1.15], [130, 1.34, 1.23], [140, 1.47, 1.32]];
export const YEDEK = 20;               // durağa ve varışa en az %20 ile (otoyolda ≈ 75 km yedek; istasyon dolu/arızalıysa sonrakine yeter)
const DC_KW = 150;                     // DC şarj gücü (kullanıcı: 150 kW ile hesapla; bağlanınca şarj hemen başlıyor)
const DC_HEDEF = 85;                   // yolda DC'de en çok %85 (üstünde şarj yavaşlıyor)

// Varış yeri ve İstanbul için o günün ortalama sıcaklığı (Open-Meteo, en çok 16 gün ileri)
const havaBellek = new Map();                                     // aynı gün/şehir için tekrar ağa gitme
export async function yolHavasi(lat, lon, gun, kLat = 41.01, kLon = 28.97) {
  const anahtar = `${kLat},${kLon},${lat},${lon},${gun}`;
  if (havaBellek.has(anahtar)) return havaBellek.get(anahtar);
  const T = await yolHavasiAg(lat, lon, gun, kLat, kLon);
  if (T != null) havaBellek.set(anahtar, T);
  return T;
}
async function yolHavasiAg(lat, lon, gun, kLat, kLon) {
  const url = (la, lo) => `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&daily=temperature_2m_mean&timezone=Europe%2FIstanbul&start_date=${gun}&end_date=${gun}`;
  try {
    const [a, b] = await Promise.all([fetch(url(kLat, kLon)), fetch(url(lat, lon))].map((p) => p.then((r) => r.json())));
    const t = [a, b].map((j) => j?.daily?.temperature_2m_mean?.[0]).filter(Number.isFinite);
    return t.length ? t.reduce((x, y) => x + y, 0) / t.length : null;
  } catch { return null; }
}

// km: tek yön; gidisDonus: dönüşte varışta şarj yok sayılır; katsayi: hız seçimi
export function planla({ km, gidisDonus, T, M, katsayi = OTOYOL_KATSAYI, lpgKatsayi = 1.08, dcFiyat = null, baslaSoc = null }) {
  const LPG_110 = 1.08;                                                         // tablodaki 110 km/sa katsayısı
  const car = M.car, cap = Number(car.battery_kwh) || 89.6, eff = M.carEff || 0.87;
  const O = M.ogrenme;
  const temel = O?.model ? O.model.tahmin(T) : M.aracTuketim;
  const c = temel * katsayi;                                                    // kWh/100 km
  const topKm = km * (gidisDonus ? 2 : 1);
  const kwh = (topKm * c) / 100;
  const kullan = (kwh / cap) * 100;                                             // yolculuğun yüzdesi
  const yuzdeKm = (yuzde) => ((yuzde / 100) * cap / c) * 100;                   // bu kadar yüzdeyle gidilen km
  const hedefBasla = Math.min(100, Math.ceil((kullan + YEDEK) / 5) * 5);     // çıkışta olması gereken
  // Çıkışa kadar hedefe yetişemiyorsa plan gerçekte ulaşılacak yüzdeyle başlar (eksik DC durağıyla kapanır)
  const basla = baslaSoc != null ? Math.max(0, Math.min(hedefBasla, baslaSoc)) : hedefBasla;
  // Durak durak: %YEDEK'e inince dur, kalan yola yetecek kadar (en çok %DC_HEDEF) şarj et
  const duraklar = [];
  let soc = basla, gidilen = 0;
  {                                                                             // başlangıç yetmiyorsa durak durak
    for (let i = 0; i < 12; i++) {
      const menzil = Math.max(0, yuzdeKm(soc - YEDEK));
      if (gidilen + menzil >= topKm) break;
      if (gidilen + yuzdeKm(soc - 12) >= topKm) break;                       // birkaç km için durma: varışta %12+ kalır
      gidilen += menzil;
      const kalan = ((topKm - gidilen) * c / 100 / cap) * 100;                 // kalan yolun yüzdesi
      const hedef = Math.min(DC_HEDEF, Math.ceil((kalan + YEDEK) / 5) * 5);
      const bas = Math.min(soc, YEDEK), bat = ((hedef - bas) / 100) * cap;
      duraklar.push({ km: gidilen, bas, son: hedef, kwh: bat / 0.95, dk: Math.max(1, Math.round((bat / DC_KW) * 60)) });
      soc = hedef;
    }
  }
  const dcKwh = duraklar.reduce((t, d) => t + d.kwh, 0);
  const dcBat = dcKwh * 0.95;
  const evBirim = M.toggAyBirim(M.mi), evKwhCek = (kwh - dcBat) / eff;          // evden çekilen (şarj kaybı dahil)
  const evTl = evKwhCek * evBirim;
  const dcTl = dcKwh * (dcFiyat || Number(car.public_tl) || 12);
  const lpgL100 = (Number(car.lpg_l100) || 10) * (lpgKatsayi / LPG_110);           // ortalama 110 km/sa kabul
  const lpgTl = (topKm * lpgL100 / 100) * (Number(car.lpg_tl) || 50.7);
  const sonSoc = soc - (((topKm - gidilen) * c / 100) / cap) * 100;             // yolculuk sonunda
  const tekYonSoc = gidisDonus ? null : sonSoc;
  const varis = gidisDonus ? (duraklar.length ? null : basla - (((km * c) / 100) / cap) * 100) : sonSoc;
  return { c, temel, topKm, kwh, basla, hedefBasla, varis, donus: gidisDonus ? sonSoc : null, dcDurak: duraklar.length, duraklar, dcKwh,
    menzil: yuzdeKm(100 - YEDEK), yedekKm: yuzdeKm(YEDEK), molaDk: duraklar.reduce((t, d) => t + d.dk, 0), tl: evTl + dcTl, evTl, evKwhCek, evBirim, dcTl, lpgTl, lpgL100, T, tekYonSoc };
}
