// Togg bakım ve evrak takvimi: bakım (km + süre, öğrenilen günlük km ile tarihe çevrilir), muayene, kasko,
// trafik sigortası, MTV (Ocak / Temmuz sonu). Ayarlar: settings/car/takvim
export const BAKIM_KM = 40000, BAKIM_AY = 24;   // Togg T10X: 2 yılda bir ya da 40.000 km'de bir (hangisi önce)

const gun = 86400e3;
const tarih = (s) => (s ? new Date(`${s}T12:00:00`) : null);
export const isoGun = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ayEkle = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const fmtKm = (n) => new Intl.NumberFormat('tr-TR').format(Math.round(n));

// Her kalem: {id, ad, ikon, tarih, bas (dönem başı; ilerleme halkası için), kalan, not, tahmini, eylem}
// eylem: {etiket, onay, yama(T) → settings/car/takvim'e yazılacak alanlar}
export function takvim(M, simdi = new Date()) {
  const T = M.S.car?.takvim || {};
  const kmM = M.ogrenme?.kmM;
  const kmGun = kmM ? (kmM.yol * 10 + kmM.ek * 7) / 7 : null;               // haftalık ortalama km/gün
  const odo = M.aracSimdi?.odo ?? M.sessions.find((s) => s.odo)?.odo ?? null;
  const out = [];
  // Bakım: son bakım (yoksa tescil) tarihi + aralık ya da son bakım km'si + aralık, hangisi önce gelirse
  const aralikKm = Number(T.bakim_aralik_km) || BAKIM_KM, aralikAy = Number(T.bakim_aralik_ay) || BAKIM_AY;
  const sonKm = Number(T.bakim_km) || 0;
  const hedefKm = sonKm + aralikKm * Math.max(1, Math.ceil(((odo || 0) - sonKm + 1) / aralikKm));
  let bakim = null, neden = null;
  if (odo != null && kmGun > 0) { bakim = new Date(simdi.getTime() + ((hedefKm - odo) / kmGun) * gun); neden = 'km'; }
  const sonT = tarih(T.bakim_tarih);
  if (sonT) { const z = ayEkle(sonT, aralikAy); if (!bakim || z < bakim) { bakim = z; neden = 'süre'; } }
  if (bakim) {
    const kmOran = odo != null ? Math.min(1, Math.max(0, (odo - sonKm) / aralikKm)) : 0;
    const sureOran = sonT ? Math.min(1, Math.max(0, (simdi - sonT) / (ayEkle(sonT, aralikAy) - sonT))) : 0;
    out.push({ id: 'bakim', ad: 'Periyodik bakım', ikon: 'bakim', tarih: bakim, tahmini: neden === 'km',
      bas: sonT || new Date(simdi.getTime() - kmOran * (bakim - simdi) / Math.max(0.01, 1 - kmOran)),
      oran: Math.max(kmOran, sureOran),
      not: neden === 'km' ? `${fmtKm(hedefKm)} km'de · ${fmtKm(Math.max(0, hedefKm - odo))} km kaldı` : `${aralikAy / 12} yıl dolunca · ${odo != null ? `${fmtKm(Math.max(0, hedefKm - odo))} km kaldı` : ''}`,
      donem: `Her ${aralikAy / 12} yıl ya da ${fmtKm(aralikKm)} km`,
      eylem: { etiket: 'Bakım yapıldı', onay: 'Bugün bakım yapıldı olarak kaydedilsin mi?',
        yama: () => ({ bakim_tarih: isoGun(simdi), bakim_km: odo != null ? Math.round(odo) : null }) } });
  }
  const tescil = tarih(T.tescil);
  const muayene = tarih(T.muayene);
  if (muayene) {
    const ilk = tescil && (muayene - tescil) / gun < 3.2 * 365;                 // yeni araçta ilk muayene 3 yıl
    out.push({ id: 'muayene', ad: 'Araç muayenesi', ikon: 'muayene', tarih: muayene, bas: ilk ? tescil : ayEkle(muayene, -24),
      not: ilk ? 'İlk muayene · tescilden 3 yıl' : '2 yılda bir', donem: ilk ? 'İlk muayene 3 yıl, sonra 2 yılda bir' : '2 yılda bir',
      eylem: { etiket: 'Muayeneden geçti', onay: 'Sonraki muayene 2 yıl sonraya alınsın mı?', yama: (t) => ({ muayene: isoGun(ayEkle(tarih(t.muayene), 24)) }) } });
  }
  for (const [id, ad, ikon] of [['kasko', 'Kasko', 'kasko'], ['trafik', 'Trafik sigortası', 'trafik']]) {
    const d = tarih(T[id]);
    if (d) out.push({ id, ad, ikon, tarih: d, bas: ayEkle(d, -12), not: 'Poliçe bitişi', donem: 'Yıllık poliçe',
      eylem: { etiket: 'Poliçeyi yeniledim', onay: 'Bitiş tarihi 1 yıl ileri alınsın mı?', yama: (t) => ({ [id]: isoGun(ayEkle(tarih(t[id]), 12)) }) } });
  }
  // MTV: Ocak ve Temmuz ayı sonu (elektrikli araçta da ödenir); ödendi işaretlenen taksit atlanır
  const y = simdi.getFullYear();
  const taksitler = [new Date(y, 0, 31, 12), new Date(y, 6, 31, 12), new Date(y + 1, 0, 31, 12), new Date(y + 1, 6, 31, 12)];
  const ayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const mtv = taksitler.find((d) => d >= new Date(simdi.getTime() - gun) && ayKey(d) !== T.mtv_odendi);
  const mtvBas = new Date(mtv.getFullYear(), mtv.getMonth() - 5, 1, 12);
  const odemeAyi = simdi >= new Date(mtv.getFullYear(), mtv.getMonth(), 1, 12);
  out.push({ id: 'mtv', ad: 'Motorlu taşıtlar vergisi', kisa: 'MTV', ikon: 'mtv', tarih: mtv, bas: mtvBas,
    not: `${mtv.getMonth() ? 'Temmuz' : 'Ocak'} taksiti${odemeAyi ? ' · ödeme ayı' : ''}`, donem: 'Yılda 2 taksit · Ocak ve Temmuz',
    eylem: { etiket: 'Ödedim', onay: `${mtv.getMonth() ? 'Temmuz' : 'Ocak'} ${mtv.getFullYear()} taksiti ödendi mi?`, yama: () => ({ mtv_odendi: ayKey(mtv) }) } });
  for (const x of out) {
    x.kalan = Math.ceil((x.tarih - simdi) / gun);
    if (x.oran == null) x.oran = Math.min(1, Math.max(0, (simdi - x.bas) / (x.tarih - x.bas)));
  }
  return out.sort((a, b) => a.tarih - b.tarih);
}

// Pi hatırlatma gönderebilsin diye tahmini bakım tarihi (değişince yazılır)
export function takvimTahmin(liste) {
  const b = liste.find((x) => x.id === 'bakim');
  return b ? { bakim: isoGun(b.tarih) } : {};
}

// Gerçekçi çizgi ikonlar (Lucide tarzı, 24×24)
export const TK_IKON = {
  bakim: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  muayene: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  kasko: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  trafik: '<path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.65 5H8.4a2 2 0 0 0-1.9 1.26L5 10 3 8"/><path d="M7 14h.01"/><path d="M17 14h.01"/><rect width="18" height="8" x="3" y="10" rx="2"/><path d="M5 18v2"/><path d="M19 18v2"/>',
  mtv: '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M12 2 20 7H4z"/>',
};
export const tkIkon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TK_IKON[k] || ''}</svg>`;
