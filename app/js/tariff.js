// Tarife motoru — collector/tariff.py ile birebir aynı mantık.
// Mesken yıllık limiti (2026: 4.000 kWh). Yıl içinde aşılırsa, aşılan ayı izleyen
// 3. ayın 1'inden itibaren son kaynak (SKTT) fiyatı. Önceki yıl tüketimi bu yılın
// limitini aşmışsa bütün yıl SKTT.
export const GECIKME = 3;

export const VARSAYILAN = { limit_kwh: 4000, normal_tl: 3.24, sktt_tl: 6.49, kademe_kwh_ay: 0, kademe2_tl: 0, onceki_yil_kwh: null };

export function tarife(yil, d = {}) {
  const t = { yil, ...VARSAYILAN };
  for (const k of Object.keys(VARSAYILAN)) if (d && d[k] != null && d[k] !== '') t[k] = Number(d[k]);
  return t;
}

export function skttAyi(t, d, ay) {
  if (t.onceki_yil_kwh != null && t.onceki_yil_kwh > t.limit_kwh) return true;
  if (!d.skttBas) return false;
  const [y, m] = d.skttBas;
  return y === t.yil && ay >= m;
}

export function ayMaliyeti(t, kwh, sktt) {
  if (sktt) return kwh * t.sktt_tl;
  if (t.kademe_kwh_ay > 0 && t.kademe2_tl > 0 && kwh > t.kademe_kwh_ay)
    return t.kademe_kwh_ay * t.normal_tl + (kwh - t.kademe_kwh_ay) * t.kademe2_tl;
  return kwh * t.normal_tl;
}

export function yilDurumu(t, aylikKwh) {
  const aylik = Array.from({ length: 12 }, (_, i) => Number(aylikKwh[i] || 0));
  let kum = 0, asim = null;
  aylik.forEach((k, i) => { kum += k; if (asim == null && kum > t.limit_kwh) asim = i + 1; });
  let skttBas = null;
  if (asim != null) {
    const m = asim + GECIKME;
    skttBas = m <= 12 ? [t.yil, m] : [t.yil + 1, m - 12];
  }
  const d = { aylik, kum, asimAyi: asim, skttBas };
  d.aylikSktt = aylik.map((_, i) => skttAyi(t, d, i + 1));
  d.aylikTl = aylik.map((k, i) => ayMaliyeti(t, k, d.aylikSktt[i]));
  d.toplamTl = d.aylikTl.reduce((a, b) => a + b, 0);
  return d;
}

export function birimFiyat(t, d, ay) {
  if (skttAyi(t, d, ay)) return t.sktt_tl;
  if (t.kademe_kwh_ay > 0 && t.kademe2_tl > 0 && d.aylik[ay - 1] > t.kademe_kwh_ay) return t.kademe2_tl;
  return t.normal_tl;
}

const gunYil = (y) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365);
const yilinGunu = (d) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);

export function yilSonuTahmini(ytd, son30, bugun) {
  const gecen = yilinGunu(bugun);
  const kalan = gunYil(bugun.getFullYear()) - gecen;
  if (gecen <= 0) return ytd;
  const ortYil = ytd / gecen;
  const ort30 = son30 > 0 ? son30 / 30 : ortYil;
  return ytd + (0.6 * ort30 + 0.4 * ortYil) * kalan;
}

export function gunlukButce(limit, ytd, bugun) {
  const kalan = gunYil(bugun.getFullYear()) - yilinGunu(bugun) + 1;
  return Math.max(0, (limit - ytd) / Math.max(1, kalan));
}

export const kalanGun = (bugun) => gunYil(bugun.getFullYear()) - yilinGunu(bugun) + 1;
