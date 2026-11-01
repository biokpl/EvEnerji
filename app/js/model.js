// Ham veriden ekranların kullandığı özetleri çıkarır.
import { ayMaliyeti, birimFiyat, gunlukButce, kalanGun, tarife, yilDurumu } from './tariff.js';
import { iso } from './ui.js';

const z12 = () => Array(12).fill(0);
const sum = (a) => a.reduce((x, y) => x + y, 0);

// Basılan aç/kapa düğmesinin beklenen durumu: Pi yeni durumu bildirene kadar
// (en çok 20 sn) ekranda bu gösterilir, böylece düğme anında tepki verir.
export const pendingSwitch = new Map();
function withPending(id, live) {
  const p = pendingSwitch.get(id);
  if (!p) return live;
  if (Date.now() > p.until || (live && live.on === p.on && (live.ts || 0) * 1000 >= p.since)) {
    pendingSwitch.delete(id);
    return live;
  }
  return { ...(live || {}), on: p.on };
}

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
    .map(([id, m]) => ({ id, ...m, live: withPending(id, raw.live?.[id]) }))
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
  // Prizin Pi'ye bağlanmadan önceki geçmişi (GG Smart'tan aktarılan günlük kWh).
  // Pi ölçümü bu tarihten sonra başladığı için üst üste binmez: toplanır.
  const hist = S.ev_history?.days || {};
  const histMonth = (ym) => sum(Object.entries(hist).filter(([k]) => k.startsWith(ym)).map(([, v]) => Number(v) || 0));
  for (let i = 0; i < 12; i++) evMonths[i] += histMonth(`${y}-${String(i + 1).padStart(2, '0')}`);
  const histTotal = sum(Object.values(hist).map((v) => Number(v) || 0));

  const TY = S.tariff?.[y] || {};
  const t = tarife(y, TY);
  // gelecek yılın limiti bu yıldan devralınmaz: ayarda yoksa yasal limit (2027+: 3.000)
  const tNext = tarife(y + 1, { ...TY, limit_kwh: null, onceki_yil_kwh: null, ...S.tariff?.[y + 1] });

  // Son 30 gün (ana sayaç)
  const days = (id) => raw.days?.[id] || {};
  const lastN = (id, n) => {
    const out = [];
    for (let i = n - 1; i >= 0; i--) { const k = iso(new Date(now.getTime() - i * 864e5)); out.push([k, Number(days(id)[k] || 0)]); }
    return out;
  };
  const homeDays30 = home ? lastN(home.id, 30) : [];
  const covered = homeDays30.filter(([, v]) => v > 0).length;
  const son30 = covered >= 20 ? sum(homeDays30.map(([, v]) => v)) * (30 / covered) : 0;

  // Ölçüm kapsamı: abonelik başlangıcından (taşınma) son ölçülen güne kadar.
  // Sayaç yoksa son fatura okuma tarihine kadar; aradaki günler tahminle doldurulur.
  const DAY = 864e5;
  const d0 = (s) => { const d = new Date(s); d.setHours(0, 0, 0, 0); return d; };
  const today0 = d0(today);
  const start = TY.baslangic && d0(TY.baslangic) > new Date(y, 0, 1) ? d0(TY.baslangic) : new Date(y, 0, 1);
  const meterDays = home ? Object.keys(days(home.id)).filter((k) => k.startsWith(String(y)) && days(home.id)[k] > 0).sort() : [];
  let covEnd = today0;
  if (!meterDays.length && TY.son_okuma) covEnd = d0(TY.son_okuma);
  else if (meterDays.length) covEnd = new Date(today0.getTime() + DAY); // bugün dahil ölçülüyor
  const covDays = Math.max(1, Math.round((covEnd - start) / DAY));
  const measured = sum(homeMonths);
  // Günlük hız: sayaçtan son 30 gün, yoksa son faturanın günlük ortalaması; dönem ortalamasıyla harmanlanır
  const avgAll = measured / covDays;
  const lastBillMi = [...homeMonths.keys()].filter((i) => Number(bills[String(i + 1).padStart(2, '0')] || 0) > 0).pop();
  const recent = son30 > 0 ? son30 / 30 : lastBillMi != null ? homeMonths[lastBillMi] / new Date(y, lastBillMi + 1, 0).getDate() : avgAll;
  const rate = measured > 0 ? 0.6 * recent + 0.4 * avgAll : 0;
  const gapDays = Math.max(0, Math.round((today0 - covEnd) / DAY) + 1);
  const ytdEst = gapDays > 0 && !meterDays.length;
  const ytd = measured + (ytdEst ? rate * gapDays : 0);
  const remain = kalanGun(now) - 1;
  const proj = ytd + rate * remain;
  const butce = gunlukButce(t.limit_kwh, ytd, now);

  // Ay ay tahmini tam yıl (geçmiş: ölçüm, boşluk ve gelecek: hız x gün)
  const projMonths = [...homeMonths];
  for (let i = 0; i < 12; i++) {
    const mStart = new Date(y, i, 1), mEnd = new Date(y, i + 1, 1);
    const from = Math.max(mStart.getTime(), Math.max(covEnd.getTime(), start.getTime()));
    const n = Math.max(0, Math.round((mEnd.getTime() - from) / DAY));
    projMonths[i] += rate * n;
  }
  const durum = yilDurumu(t, homeMonths);
  const projDurum = yilDurumu(t, projMonths);

  // Togg'un gerçek maliyeti = faturası Togg'la - Togg olmadan (kademe/SKTT farkı dahil)
  const evYtd = sum(evMonths);
  const evTlByMonth = evMonths.map((k, i) => {
    if (!k) return 0;
    const tot = Math.max(projMonths[i], k);
    const sk = projDurum.aylikSktt[i];
    return ayMaliyeti(t, tot, sk) - ayMaliyeti(t, tot - k, sk);
  });
  const evTl = sum(evTlByMonth);
  const evAvgTl = evYtd > 0 ? evTl / evYtd : 0;
  const evShare = proj > 0 ? Math.min(1, sum(evMonths.map((k, i) => Math.min(k, projMonths[i]))) / sum(projMonths.slice(0, mi + 1))) : 0;
  const evProj = proj * evShare;
  const noEvProj = proj - evProj;
  // Togg'un evi yüksek kademeye taşıdığı aylar
  const kademeAylari = t.kademe_kwh_ay > 0 ? homeMonths.map((h, i) => (h > t.kademe_kwh_ay && h - evMonths[i] <= t.kademe_kwh_ay ? i : -1)).filter((i) => i >= 0) : [];

  // Tahmini aşım tarihi
  let exceedDate = null;
  if (ytd > t.limit_kwh) exceedDate = 'gecti';
  else if (proj > t.limit_kwh && rate > 0) exceedDate = new Date(now.getTime() + Math.ceil((t.limit_kwh - ytd) / rate) * DAY);

  let level = 'good', levelText = 'Güvende';
  if (ytd > t.limit_kwh) { level = 'bad'; levelText = 'Limit aşıldı'; }
  else if (proj > t.limit_kwh) { level = 'bad'; levelText = 'Aşım riski'; }
  else if (proj > t.limit_kwh * 0.9) { level = 'mid'; levelText = 'Sınıra yakın'; }

  // Gelecek yıl: bugünkü hızla tam yıl. Limit L ise (a) bu yılın tüketimi L'yi aşarsa 1 Ocak'tan,
  // (b) aşmazsa gelecek yıl içinde aşıldığı ayı izleyen 3. aydan itibaren son kaynak fiyatı.
  const nextMonths = Array.from({ length: 12 }, (_, i) => rate * new Date(y + 1, i + 1, 0).getDate());
  const nextYear = sum(nextMonths);
  const scenarios = [tNext.limit_kwh].map((L) => {
    const tl_ = { ...tNext, limit_kwh: L, onceki_yil_kwh: proj };
    const d = yilDurumu(tl_, nextMonths);
    const normal = yilDurumu({ ...tNext, limit_kwh: 1e12, onceki_yil_kwh: null }, nextMonths).toplamTl;
    const fromJan = proj > L;
    const fromMonth = !fromJan && d.skttBas && d.skttBas[0] === y + 1 ? d.skttBas[1] : null;
    const exceedNext = !fromJan && d.asimAyi ? d.asimAyi : null;
    return { L, sktt: fromJan || !!fromMonth, fromJan, fromMonth, exceedNext, followYear: !!exceedNext,
      cost: d.toplamTl, extra: d.toplamTl - normal, selected: L === tNext.limit_kwh };
  });

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

  // Şarj yüzdesi (SoC): araç veri vermediği için prizden ölçülen kWh ile tahmin.
  // Kullanıcı başlangıç (ve isterse bitiş) yüzdesini girer: settings/soc/{oturum} = {basla, bitis}
  const car = { battery_kwh: 88.5, efficiency: 0.9, public_tl: 9, hedef_yuzde: 100, ...(S.car || {}) };
  const cap = Number(car.battery_kwh) || 88.5;
  const socIn = S.soc || {};
  for (const s of sessions) {
    const v = socIn[s.sid] || {};
    s.socStart = Number.isFinite(v.basla) ? v.basla : null;
    s.socEnd = Number.isFinite(v.bitis) ? v.bitis : null;
  }
  // Gerçek şarj verimi: başlangıç ve bitişi girilmiş oturumlardan (duvar kWh → batarya kWh)
  const effSamples = sessions
    .filter((s) => s.socStart != null && s.socEnd != null && s.kwh > 1 && s.socEnd > s.socStart)
    .map((s) => ((s.socEnd - s.socStart) / 100) * cap / s.kwh)
    .filter((e) => e > 0.7 && e <= 1);
  const median = (a) => { const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  car.learnedEff = effSamples.length ? median(effSamples) : null;
  car.learnedN = effSamples.length;
  car.eff = car.learnedEff ?? car.efficiency;
  const socAdd = (kwhWall) => (kwhWall * car.eff) / cap * 100;
  const hedef = Number(car.hedef_yuzde) || 100;
  for (const s of sessions) {
    // Veri girilmediyse ve araç doldu ise: bitiş = hedef, başlangıç = hedef − bu şarjda eklenen.
    // Önceki şarj nerede yapılmış olursa olsun doğru (yalnız bu oturumun kWh'sine bakar).
    // Verim öğrenmede kullanılmaz (kendi tahminiyle kendini doğrulamasın).
    if (s.full && s.socStart == null && s.socEnd == null && (s.kwh || 0) > 0.5) {
      s.socEnd = hedef;
      s.socStart = Math.max(0, Math.round(hedef - socAdd(s.kwh)));
      s.socAuto = true;
    }
    if (s.socStart != null) s.socEst = Math.min(100, s.socStart + socAdd(s.kwh || 0));
    // Pi gücün kademeli düştüğünü gördüyse araç hedefine ulaşmıştır: bitiş = hedef
    if (s.full && s.socStart != null && s.socEnd == null) s.socEst = Math.max(s.socStart, Number(car.hedef_yuzde) || 100);
    if (per100) s.km = ((s.kwh || 0) / per100) * 100;   // bu şarjla eklenen menzil
  }

  const activeSession = evs.map((d) => d.live?.session && (d.live?.w || 0) > 50 ? { dev: d, ...d.live.session } : null).find(Boolean) || null;
  if (activeSession) {
    const a = activeSession, v = socIn[a.id] || {};
    const w = a.dev.live?.w || 0;
    a.socStart = Number.isFinite(v.basla) ? v.basla : null;
    a.added = socAdd(a.kwh || 0);
    a.km = per100 ? ((a.kwh || 0) / per100) * 100 : null;
    if (a.socStart != null) {
      a.socNow = Math.min(100, a.socStart + a.added);
      a.target = Math.max(a.socNow, Number(car.hedef_yuzde) || 100);
      const remainWall = ((a.target - a.socNow) / 100) * cap / car.eff;   // duvardan çekilecek kWh
      a.etaMin = w > 300 ? (remainWall / (w / 1000)) * 60 : null;
      a.remainKwh = remainWall;
    }
  }

  return {
    raw, now, y, mi, today, S, t, tNext, durum, projDurum, devices, enabled, home, evs, plugs, winderDev,
    homeMonths, projMonths, evMonths, evTlByMonth, ytd, ytdEst, rate, son30, proj, butce, evYtd, evShare, evProj, evTl, evAvgTl, noEvProj,
    exceedDate, level, levelText, scenarios, nextYear, kademeAylari, sessions, per100, activeSession, covEnd, start,
    priceNow: birimFiyat(t, projDurum, mi + 1),
    monthTl: projDurum.aylikTl[mi], monthKwh: projMonths[mi],
    homeW: home?.live?.w ?? null,
    evW: evs.reduce((a, d) => a + (d.live?.w || 0), 0),
    todayHome: home ? Math.max(Number(days(home.id)[today] || 0), Number(home.live?.today || 0)) : 0,
    todayEv: evs.reduce((a, d) => a + Math.max(Number(days(d.id)[today] || 0), Number(d.live?.today || 0)), 0),
    lastN, days, histMonth, histTotal, history: S.ev_history || null,
    evDay: (k) => evs.reduce((a, d) => a + Number(days(d.id)[k] || 0), 0) + Number(hist[k] || 0),
    car,
    winder: raw.winder?.state || null,
    discovered: Object.entries(raw.discovered || {}).filter(([id]) => !raw.devices?.[id]),
  };
}
