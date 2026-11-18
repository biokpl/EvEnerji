// Togg bakım ve evrak takvimi: bakım (km + süre, öğrenilen günlük km ile tarihe çevrilir), muayene, kasko,
// trafik sigortası, MTV (Ocak / Temmuz sonu). Ayarlar: settings/car/takvim
export const BAKIM_KM = 40000, BAKIM_AY = 24;   // Togg T10X: 2 yılda bir ya da 40.000 km'de bir (hangisi önce)

const gun = 86400e3;
const tarih = (s) => (s ? new Date(`${s}T12:00:00`) : null);
const isoGun = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ayEkle = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };

export function takvim(M, simdi = new Date()) {
  const T = M.S.car?.takvim || {};
  const kmM = M.ogrenme?.kmM;
  const kmGun = kmM ? (kmM.yol * 10 + kmM.ek * 7) / 7 : null;               // haftalık ortalama km/gün
  const odo = M.aracSimdi?.odo ?? M.sessions.find((s) => s.odo)?.odo ?? null;
  const out = [];
  // Bakım: son bakım km'si + aralık (yoksa 0 km'den) ya da son bakım tarihi + aralık, hangisi önce gelirse
  const aralikKm = Number(T.bakim_aralik_km) || BAKIM_KM, aralikAy = Number(T.bakim_aralik_ay) || BAKIM_AY;
  const sonKm = Number(T.bakim_km) || 0;
  const hedefKm = sonKm + aralikKm * Math.max(1, Math.ceil(((odo || 0) - sonKm + 1) / aralikKm));
  let bakim = null, neden = null;
  if (odo != null && kmGun > 0) { bakim = new Date(simdi.getTime() + ((hedefKm - odo) / kmGun) * gun); neden = 'km'; }
  const sonT = tarih(T.bakim_tarih);
  if (sonT) { const z = ayEkle(sonT, aralikAy); if (!bakim || z < bakim) { bakim = z; neden = 'süre'; } }
  if (bakim) out.push({ id: 'bakim', ad: 'Bakım', ikon: 'settings', tarih: bakim, tahmini: neden === 'km',
    not: `${new Intl.NumberFormat('tr-TR').format(hedefKm)} km${odo != null ? ` · ${new Intl.NumberFormat('tr-TR').format(Math.max(0, hedefKm - odo))} km kaldı` : ''}` });
  for (const [id, ad, ikon] of [['muayene', 'Muayene', 'check'], ['kasko', 'Kasko', 'shield'], ['trafik', 'Trafik sigortası', 'shield']]) {
    const d = tarih(T[id]);
    if (d) out.push({ id, ad, ikon, tarih: d, not: '' });
  }
  // MTV: Ocak ve Temmuz ayı sonu (elektrikli araçta da ödenir)
  const y = simdi.getFullYear();
  const mtv = [new Date(y, 0, 31, 12), new Date(y, 6, 31, 12), new Date(y + 1, 0, 31, 12)].find((d) => d >= new Date(simdi.getTime() - gun));
  const mtvBas = new Date(mtv.getFullYear(), mtv.getMonth(), 1, 12);
  out.push({ id: 'mtv', ad: 'MTV', ikon: 'coin', tarih: mtv, not: `${mtv.getMonth() ? 'Temmuz' : 'Ocak'} taksiti${simdi >= mtvBas ? ' · ödeme ayı' : ''}` });
  for (const x of out) x.kalan = Math.ceil((x.tarih - simdi) / gun);
  return out.sort((a, b) => a.tarih - b.tarih);
}

// Pi hatırlatma gönderebilsin diye tahmini bakım tarihi (değişince yazılır)
export function takvimTahmin(liste) {
  const b = liste.find((x) => x.id === 'bakim');
  return b ? { bakim: isoGun(b.tarih) } : {};
}
