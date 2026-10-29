// Ham veriden ekranların kullandığı özetleri çıkarır.
import { birimFiyat, gunlukButce, kalanGun, tarife, yilDurumu, yilSonuTahmini } from './tariff.js';
import { iso } from './ui.js';

const z12 = () => Array(12).fill(0);
const sum = (a) => a.reduce((x, y) => x + y, 0);

export function monthsOf(raw, id, y) {
  const m = raw.months?.[id] || {};
  return Array.from({ length: 12 }, (_, i) => Number(m[`${y}-${String(i + 1).padStart(2, '0')}`] || 0));
}

export function build(raw) {
  const now = new Date();
  const y = now.getFullYear();
  const mi = now.getMonth();
  const today = iso(now);
  const S = raw.settings || {};

  const devices = Object.entries(raw.devices || {})
    .map(([id, m]) => ({ id, ...m, live: raw.live?.[id] }))
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.name).localeCompare(b.name, 'tr'));
  const enabled = devices.filter((d) => d.enabled);
  const home = enabled.find((d) => d.type === 'ana_sayac');
  const evs = enabled.filter((d) => d.type === 'ev_sarj');
  const plugs = enabled.filter((d) => d.type === 'priz' || d.type === 'ev_sarj');
  const winderDev = enabled.find((d) => d.type === 'kablo_sarici');

  // Yıllık aylık tüketim: ana sayaç + elle girilen faturalar (büyük olan)
  const bills = S.bills?.[y] || {};
  const meterMonths = home ? monthsOf(raw, home.id, y) : z12();
  const homeMonths = meterMonths.map((v, i) => Math.max(v, Number(bills[String(i + 1).padStart(2, '0')] || 0)));
  const evMonths = z12();
  evs.forEach((d) => monthsOf(raw, d.id, y).forEach((v, i) => { evMonths[i] += v; }));

  const t = tarife(y, S.tariff?.[y]);
  const tNext = tarife(y + 1, { ...S.tariff?.[y], onceki_yil_kwh: null, ...S.tariff?.[y + 1] });
  const durum = yilDurumu(t, homeMonths);
  const ytd = durum.kum;

  // Son 30 gün
  const days = (id) => raw.days?.[id] || {};
  const lastN = (id, n) => {
    const out = [];
    for (let i = n - 1; i >= 0; i--) { const k = iso(new Date(now.getTime() - i * 864e5)); out.push([k, Number(days(id)[k] || 0)]); }
    return out;
  };
  const homeDays30 = home ? lastN(home.id, 30) : [];
  const covered = homeDays30.filter(([, v]) => v > 0).length;
  const son30 = covered >= 20 ? sum(homeDays30.map(([, v]) => v)) * (30 / covered) : 0;
  const proj = yilSonuTahmini(ytd, son30, now);
  const butce = gunlukButce(t.limit_kwh, ytd, now);
  const evYtd = sum(evMonths);
  const evShare = ytd > 0 ? Math.min(1, evYtd / ytd) : 0;
  const evProj = proj * evShare;
  const evTlByMonth = evMonths.map((k, i) => k * birimFiyat(t, durum, i + 1));
  const evTl = sum(evTlByMonth);

  // Tahmini aşım tarihi
  let exceedDate = null;
  if (ytd > t.limit_kwh) exceedDate = 'gecti';
  else if (proj > t.limit_kwh) {
    const daily = (proj - ytd) / Math.max(1, kalanGun(now) - 1);
    const d = Math.ceil((t.limit_kwh - ytd) / daily);
    exceedDate = new Date(now.getTime() + d * 864e5);
  }
  // Tahmini yıl sonu aylık dağılım -> aşım ayı ve SKTT başlangıcı
  const projMonths = [...homeMonths];
  {
    const daily = (proj - ytd) / Math.max(1, kalanGun(now) - 1);
    for (let i = mi; i < 12; i++) {
      const dim = new Date(y, i + 1, 0).getDate();
      const left = i === mi ? dim - now.getDate() : dim;
      projMonths[i] += daily * left;
    }
  }
  const projDurum = yilDurumu(t, projMonths);

  let level = 'good', levelText = 'Güvende';
  if (ytd > t.limit_kwh) { level = 'bad'; levelText = 'Limit aşıldı'; }
  else if (proj > t.limit_kwh) { level = 'bad'; levelText = 'Aşım riski'; }
  else if (proj > t.limit_kwh * 0.9) { level = 'mid'; levelText = 'Sınıra yakın'; }

  // Gelecek yıl: limit L olursa bu yılın tüketimi L'yi aşıyorsa 1 Ocak'tan itibaren SKTT
  const nextUse = proj; // gelecek yıl da benzer tüketim varsayımı
  const scenarios = [3000, 3500, 4000].map((L) => {
    const sktt = proj > L;
    const normalCost = nextUse * tNext.normal_tl;
    const cost = sktt ? nextUse * tNext.sktt_tl : normalCost;
    return { L, sktt, cost, extra: cost - normalCost, selected: L === tNext.limit_kwh };
  });
  const noEvProj = proj - evProj;

  // Oturumlar
  const sessions = [];
  for (const d of evs) {
    for (const [sid, s] of Object.entries(raw.sessions?.[d.id] || {})) sessions.push({ dev: d.id, sid, ...s });
  }
  sessions.sort((a, b) => b.start - a.start);
  // kWh/100 km: art arda iki km girişi arasındaki sürüşe, sonraki şarjın enerjisi karşılık gelir
  const withOdo = sessions.filter((s) => s.odo).sort((a, b) => a.start - b.start);
  for (let i = 1; i < withOdo.length; i++) {
    const km = withOdo[i].odo - withOdo[i - 1].odo;
    const between = sessions.filter((s) => s.start > withOdo[i - 1].start && s.start <= withOdo[i].start);
    const k = sum(between.map((s) => s.kwh || 0));
    if (km > 5 && km < 3000) withOdo[i].per100 = (k / km) * 100;
  }
  const eff = withOdo.filter((s) => s.per100);
  const per100 = eff.length ? sum(eff.map((s) => s.per100)) / eff.length : null;

  const activeSession = evs.map((d) => d.live?.session && (d.live?.w || 0) > 50 ? { dev: d, ...d.live.session } : null).find(Boolean) || null;

  return {
    raw, now, y, mi, today, S, t, tNext, durum, projDurum, devices, enabled, home, evs, plugs, winderDev,
    homeMonths, evMonths, evTlByMonth, ytd, son30, proj, butce, evYtd, evShare, evProj, evTl, noEvProj,
    exceedDate, level, levelText, scenarios, sessions, per100, activeSession,
    priceNow: birimFiyat(t, durum, mi + 1),
    monthTl: durum.aylikTl[mi], monthKwh: homeMonths[mi],
    homeW: home?.live?.w ?? null,
    evW: evs.reduce((a, d) => a + (d.live?.w || 0), 0),
    todayHome: home ? Math.max(Number(days(home.id)[today] || 0), Number(home.live?.today || 0)) : 0,
    todayEv: evs.reduce((a, d) => a + Math.max(Number(days(d.id)[today] || 0), Number(d.live?.today || 0)), 0),
    lastN, days,
    car: { battery_kwh: 88.5, efficiency: 0.9, public_tl: 9, ...(S.car || {}) },
    winder: raw.winder?.state || null,
    discovered: Object.entries(raw.discovered || {}).filter(([id]) => !raw.devices?.[id]),
  };
}
