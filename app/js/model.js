// Ham veriden ekranların kullandığı özetleri çıkarır.
import { UC_ZAMAN, ayMaliyeti, birimFiyat, kademeSiniri, dilim, gunlukButce, kalanGun, tarife, ucZamanKiyas, yilDurumu } from './tariff.js';
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
  // Son fatura okumasından ÖNCEKİ sayaç günleri o faturanın içinde (ör. şalter 2 Kas'ta başladı, fatura
  // 3 Kas'a kadar): iki kez sayılmasın diye ay toplamından düşülür.
  const sonOkuma = S.tariff?.[y]?.son_okuma || '';
  const meterMonths = (home ? monthsOf(raw, home.id, y) : z12()).map((v, i) => {
    if (!home || !sonOkuma) return v;
    const ym = `${y}-${String(i + 1).padStart(2, '0')}`;
    const ici = Object.entries(raw.days?.[home.id] || {}).filter(([k]) => k.startsWith(ym) && k < sonOkuma)
      .reduce((a, [, x]) => a + Number(x || 0), 0);
    return Math.max(0, v - ici);
  });
  const homeMonths = meterMonths.map((v, i) => Math.max(v, Number(bills[String(i + 1).padStart(2, '0')] || 0)));
  const evMonths = z12();
  evs.forEach((d) => monthsOf(raw, d.id, y).forEach((v, i) => { evMonths[i] += v; }));
  // Prizin Pi'ye bağlanmadan önceki geçmişi (GG Smart'tan aktarılan günlük kWh).
  // Pi ölçümü bu tarihten sonra başladığı için üst üste binmez: toplanır.
  const hist = S.ev_history?.days || {};
  const histMonth = (ym) => sum(Object.entries(hist).filter(([k]) => k.startsWith(ym)).map(([, v]) => Number(v) || 0));
  for (let i = 0; i < 12; i++) evMonths[i] += histMonth(`${y}-${String(i + 1).padStart(2, '0')}`);
  const histTotal = sum(Object.values(hist).map((v) => Number(v) || 0));
  // Eski uygulamadan yalnız günlük toplamlar geldi; şarj sayısı günlerden çıkarılır: şarj gece yarısını
  // aşınca ertesi güne sarkar, bu yüzden art arda günler tek şarjdır. Bir şarj bataryanın alabileceğinden
  // (~kapasite / verim) fazla çekemez; o kadarı aşılırsa birden çok şarj sayılır.
  const histSarjlar = (yil, tavan) => {
    const g = Object.keys(hist).filter((k) => k.startsWith(String(yil)) && Number(hist[k]) > 0.5).sort();
    let adet = 0, kos = 0, onceki = null;
    const bitir = () => { if (kos > 0) adet += Math.max(1, Math.ceil(kos / tavan - 0.02)); kos = 0; };
    for (const k of g) {
      if (onceki && (new Date(k) - new Date(onceki)) / 864e5 > 1.5) bitir();
      kos += Number(hist[k]); onceki = k;
    }
    bitir();
    return adet;
  };

  // Önceki yılın toplamı (yeni yılın tarifesini belirler): elle girilmediyse kendi verisinden
  // (her ay için ana sayaç ölçümü ile faturadan büyük olan).
  const prevBills = S.bills?.[y - 1] || {};
  const prevMeter = home ? monthsOf(raw, home.id, y - 1) : z12();
  const prevTotal = sum(prevMeter.map((v, i) => Math.max(v, Number(prevBills[String(i + 1).padStart(2, '0')] || 0))));
  const TY0 = S.tariff?.[y] || {};
  const oncekiOto = TY0.onceki_yil_kwh == null && prevTotal > 0;
  const TY = oncekiOto ? { ...TY0, onceki_yil_kwh: Math.round(prevTotal) } : TY0;
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
  // Boşluk: son fatura okumasından ana sayacın ölçmeye başladığı güne kadar (sayaç yoksa bugüne dek).
  // Bu günler tahminle doldurulur; faturası girilmiş aylar atlanır (iki kez sayılmasın).
  const tomorrow0 = new Date(today0.getTime() + DAY);
  const billEnd = TY.son_okuma && d0(TY.son_okuma) > start ? d0(TY.son_okuma) : start;
  const holeStart = billEnd;
  const holeEnd = meterDays.length ? d0(meterDays[0]) : tomorrow0;
  const covEnd = billEnd;   // geriye uyum: faturayla kapsanan son gün
  const measuredDays = Math.max(1, Math.round((billEnd - start) / DAY) + meterDays.length);
  const measured = sum(homeMonths);
  // Günlük hız: sayaçtan son 30 gün, yoksa son faturanın günlük ortalaması; dönem ortalamasıyla harmanlanır
  const avgAll = measured / measuredDays;
  const lastBillMi = [...homeMonths.keys()].filter((i) => Number(bills[String(i + 1).padStart(2, '0')] || 0) > 0).pop();
  const recent = son30 > 0 ? son30 / 30 : lastBillMi != null ? homeMonths[lastBillMi] / new Date(y, lastBillMi + 1, 0).getDate() : avgAll;
  const rate = measured > 0 ? 0.6 * recent + 0.4 * avgAll : 0;
  // Ay ay tahmin: boşluk (geçmiş) ve yarından yıl sonuna (gelecek)
  const daysIn = (i, a, b) => {   // i. ayın [a, b) aralığına düşen gün sayısı
    const from = Math.max(new Date(y, i, 1).getTime(), a.getTime());
    const to = Math.min(new Date(y, i + 1, 1).getTime(), b.getTime());
    return Math.max(0, Math.round((to - from) / DAY));
  };
  const estMonths = homeMonths.map((_, i) => (bills[String(i + 1).padStart(2, '0')] ? 0 : rate * daysIn(i, holeStart, holeEnd)));
  const estTotal = sum(estMonths);
  const ytdEst = estTotal > 0.5;
  const ytd = measured + estTotal;
  const remain = kalanGun(now) - 1;
  const proj = ytd + rate * remain;
  const butce = gunlukButce(t.limit_kwh, ytd, now);

  const yearEnd = new Date(y + 1, 0, 1);
  const projMonths = homeMonths.map((v, i) => v + estMonths[i] + rate * daysIn(i, tomorrow0, yearEnd));
  const durum = yilDurumu(t, homeMonths);
  // Bugüne kadar: ölçüm + fatura + tahmini boşluk (tablolarda ₺ için)
  const nowDurum = yilDurumu(t, homeMonths.map((v, i) => v + estMonths[i]));
  const projDurum = yilDurumu(t, projMonths);

  // Togg'un gerçek maliyeti = faturası Togg'la - Togg olmadan (kademe/SKTT farkı dahil)
  const evYtd = sum(evMonths);
  const evTlByMonth = evMonths.map((k, i) => {
    if (!k) return 0;
    const tot = Math.max(projMonths[i], k);
    const sk = projDurum.aylikSktt[i];
    return ayMaliyeti(t, tot, sk, i + 1) - ayMaliyeti(t, tot - k, sk, i + 1);
  });
  const evTl = sum(evTlByMonth);
  const evAvgTl = evYtd > 0 ? evTl / evYtd : 0;
  const evShare = proj > 0 ? Math.min(1, sum(evMonths.map((k, i) => Math.min(k, projMonths[i]))) / sum(projMonths.slice(0, mi + 1))) : 0;
  const evProj = proj * evShare;
  const noEvProj = proj - evProj;
  // Togg'un evi yüksek kademeye taşıdığı aylar
  const kademeAylari = homeMonths.map((h, i) => { const k = kademeSiniri(t, i + 1); return k > 0 && h > k && h - evMonths[i] <= k ? i : -1; }).filter((i) => i >= 0);

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
  // Eklenen menzil: km girişlerinden öğrenilen duvar kWh/100 km varsa o; yoksa aracın menzil
  // Ayarlar'daki araç tüketimi (Trumore ortalaması; 2026-11: 3108 km'de 19 kWh/100 km)
  const bataryaTuketim = Number(car.tuketim_kwh_100) || 19;
  // Prizden çekilen kWh/100 km: km girişlerinden öğrenilen; yoksa araç tüketimi ÷ şarj verimi (19 / 0,87 ≈ 21,8)
  const per100Duvar = per100 ?? bataryaTuketim / car.eff;
  const per100Tahmini = !per100;
  const kmOf = (duvarKwh) => (duvarKwh / per100Duvar) * 100;

  // ---- Şarj kararı: gelecek yıl Togg evde mi (limit aşılır, her şey son kaynak), DC'de mi (limit içinde kalınır)?
  // Togg: son 60 günün şarjı; ev toplamı: son iki tam ayın (fatura/sayaç) günlük ortalaması (yarım aylar ortalamayı bozmasın)
  const karar = (() => {
    const g60 = Array.from({ length: 60 }, (_, i) => iso(new Date(now.getTime() - (i + 1) * DAY)));
    const toggGun = sum(g60.map((k) => evs.reduce((a, d) => a + Number(days(d.id)[k] || 0), 0) + Number(hist[k] || 0))) / 60;
    const tamAylar = [mi - 1, mi - 2].filter((i) => i >= 0 && homeMonths[i] > 0);
    const toplamGun = tamAylar.length ? sum(tamAylar.map((i) => homeMonths[i])) / sum(tamAylar.map((i) => new Date(y, i + 1, 0).getDate())) : rate;
    if (!(toplamGun > 0) || !(toggGun > 0.5)) return null;
    const evGun = Math.max(0, toplamGun - toggGun);
    const Y = y + 1, L = tNext.limit_kwh;
    const gunler = Array.from({ length: 12 }, (_, i) => new Date(Y, i + 1, 0).getDate());
    const yil = sum(gunler);
    const T = toggGun * yil, H = evGun * yil, top = T + H;
    const fiyat = { ...tNext, normal_tl: t.normal_tl, kademe2_tl: t.kademe2_tl, kademe_kwh_gun: t.kademe_kwh_gun, kademe_kwh_ay: t.kademe_kwh_ay, yil: Y };
    const sktt = t.sktt_tl;                                     // en güncel son kaynak fiyatı (Pi her ay günceller)
    const dc = Number(car.public_tl) || 12, dcTam = Number(car.public_tl_tam) || 14.9;
    const evNormal = sum(gunler.map((g, i) => ayMaliyeti(fiyat, evGun * g, false, i + 1)));
    const hak = Math.max(0, Math.min(T, L * 0.95 - H));        // limit içinde kalırken Togg'un evde şarj hakkı (%5 pay)
    const evHak = sum(gunler.map((g, i) => ayMaliyeti(fiyat, (evGun + hak / yil) * g, false, i + 1)));
    const evde = top * sktt;                                    // her yıl son kaynak (bir önceki yıl limiti aştığı için)
    const dcIle = (p) => evHak + (T - hak) * p;
    const dcInd = dcIle(dc), dcTamTl = dcIle(dcTam);
    // İlk yıl: limit yıl içinde aşılır, aşılan ayı izleyen 3. aydan son kaynak
    const ayKwh = gunler.map((g) => (evGun + toggGun) * g);
    const ilk = yilDurumu({ ...fiyat, sktt_tl: sktt, onceki_yil_kwh: proj }, ayKwh);
    return {
      yil: Y, L, T, H, top, sktt, dc, dcTamFiyat: dcTam, hak,
      evde, dcInd, dcTam: dcTamTl, evNormal, evHakTl: evHak - evNormal,
      evdeKarli: evde <= dcInd, fark: Math.abs(dcInd - evde),
      toggBirim: (evde - evNormal) / T,                         // limit cezası dahil Togg'un evdeki 1 kWh'si
      esikSktt: dcInd / top,                                    // son kaynak bunu geçerse DC daha ucuz
      asimAyi: ilk.asimAyi, skttBas: ilk.skttBas && ilk.skttBas[0] === Y ? ilk.skttBas[1] : null,
      ilkYilTl: ilk.toplamTl, hepsiSktt: proj > L,
    };
  })();
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
    s.km = kmOf(s.kwh || 0);   // bu şarjla eklenen menzil
    s.kmTahmini = !per100;
  }

  // Üç zamanlı tarife karşılaştırması (son 30 gün saatlik ölçüm)
  const ucFiyat = { ...UC_ZAMAN, ...Object.fromEntries(Object.entries({ gunduz: TY.uc_gunduz, puant: TY.uc_puant, gece: TY.uc_gece }).filter(([, v]) => v > 0)) };
  const ucKaynak = home ? [home] : enabled.filter((d) => d.type === 'priz' || d.type === 'ev_sarj');
  const olculen = { gunduz: 0, puant: 0, gece: 0 }, toggSaat = { gunduz: 0, puant: 0, gece: 0 };
  const ucGunler = new Set();
  for (const d of ucKaynak) {
    for (const [dk, arr] of Object.entries(raw.hours?.[d.id] || {})) {
      if (!Array.isArray(arr) || dk > today) continue;
      ucGunler.add(dk);
      arr.forEach((v, h) => { const x = Number(v) || 0; olculen[dilim(h)] += x; if (d.type === 'ev_sarj') toggSaat[dilim(h)] += x; });
    }
  }
  const ucN = ucGunler.size;
  let ucz = null;
  if (ucN) {
    const gunler = [...ucGunler];
    const toplam = home ? olculen.gunduz + olculen.puant + olculen.gece : Math.max(rate * ucN, 0);
    const togg = sum(gunler.map((k) => evs.reduce((a, d) => a + Number(days(d.id)[k] || 0), 0) + Number(hist[k] || 0)));
    const toggOlc = toggSaat.gunduz + toggSaat.puant + toggSaat.gece;
    ucz = { ...ucZamanKiyas(t, ucFiyat, olculen, toplam, ucN, togg), n: ucN, fiyat: ucFiyat, varsayim: !home,
      toggGece: toggOlc > 0.5 ? toggSaat.gece / toggOlc : null, toggAy: togg * 30 / ucN };
  }

  const activeSession = evs.map((d) => d.live?.session && (d.live?.w || 0) > 50 ? { dev: d, ...d.live.session } : null).find(Boolean) || null;
  if (activeSession) {
    const a = activeSession, v = socIn[a.id] || {};
    const w = a.dev.live?.w || 0;
    a.socStart = Number.isFinite(v.basla) ? v.basla : null;
    a.added = socAdd(a.kwh || 0);
    a.km = kmOf(a.kwh || 0);
    a.kmTahmini = !per100;
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
    exceedDate, level, levelText, scenarios, nextYear, kademeAylari, sessions, per100, per100Duvar, per100Tahmini, histSarj: histSarjlar(y, cap / car.eff), karar, activeSession, covEnd, start, holeStart, holeEnd, estTotal, estMonths, nowDurum,
    priceNow: birimFiyat(t, projDurum, mi + 1),
    monthTl: projDurum.aylikTl[mi], monthKwh: projMonths[mi],
    homeW: home?.live?.w ?? null,
    evW: evs.reduce((a, d) => a + (d.live?.w || 0), 0),
    todayHome: home ? Math.max(Number(days(home.id)[today] || 0), Number(home.live?.today || 0)) : 0,
    todayEv: evs.reduce((a, d) => a + Math.max(Number(days(d.id)[today] || 0), Number(d.live?.today || 0)), 0),
    ucz, lastN, days, histMonth, histTotal, history: S.ev_history || null,
    evDay: (k) => evs.reduce((a, d) => a + Number(days(d.id)[k] || 0), 0) + Number(hist[k] || 0),
    car, oncekiOto, prevTotal,
    winder: raw.winder?.state || null,
    discovered: Object.entries(raw.discovered || {}).filter(([id]) => !raw.devices?.[id]),
  };
}
