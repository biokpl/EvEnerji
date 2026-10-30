// Örnek veri: gerçek cihazlar bağlanana kadar uygulamanın nasıl görüneceğini gösterir.
// Tohumlu rastgele sayı üreteci: her açılışta aynı geçmiş.
import { iso } from './ui.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Ev profili (saatlik ağırlık): gece düşük, sabah ve akşam tepe
const PROFILE = [3, 2.6, 2.4, 2.3, 2.3, 2.6, 3.6, 5.2, 5.4, 4.2, 3.9, 4.1, 4.6, 4.3, 3.9, 3.9, 4.4, 5.6, 7.2, 8.0, 7.8, 7.0, 5.6, 4.0];
const PSUM = PROFILE.reduce((a, b) => a + b, 0);

export function buildDemo(now = new Date()) {
  const r = rng(20261029);
  const y = now.getFullYear();
  const start = new Date(y - 1, 11, 1);
  const days = { ev_salter: {}, togg: {}, camasir: {} };
  const hours = { ev_salter: {}, togg: {}, camasir: {} };
  const sessions = { togg: {} };
  const add = (dev, ts, kwhVal) => {
    const d = new Date(ts);
    const k = iso(d);
    days[dev][k] = (days[dev][k] || 0) + kwhVal;
    (hours[dev][k] ||= Array(24).fill(0))[d.getHours()] += kwhVal;
  };
  let odo = 7900, kmSince = 60, active = null;
  const nowMs = now.getTime();
  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    const doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    // ev tabanı (kışın yüksek)
    const base = 5.9 + 2.0 * Math.cos((2 * Math.PI * (doy - 20)) / 365) + (r() - 0.5) * 1.4;
    for (let h = 0; h < 24; h++) {
      const ts = dayStart + h * 3600e3 + 1800e3;
      if (ts > nowMs) break;
      add('ev_salter', ts, (base * PROFILE[h]) / PSUM);
    }
    // çamaşır makinesi (haftada ~2)
    if (r() < 0.29) {
      const ts = dayStart + (10 + Math.floor(r() * 8)) * 3600e3;
      if (ts < nowMs) { const k = 0.7 + r() * 0.6; add('camasir', ts, k); add('ev_salter', ts, k); }
    }
    // sürüş ve şarj
    const we = [0, 6].includes(d.getDay());
    const km = we ? 10 + r() * 50 : 8 + r() * 24;
    odo += km; kmSince += km;
    const isToday = iso(d) === iso(now);
    if ((kmSince > 95 && r() < 0.55) || kmSince > 190 || (isToday && now.getHours() >= 21)) {
      const st = dayStart + (isToday ? 21 * 60 + 40 : 20 * 60 + 30 + Math.floor(r() * 180)) * 60e3;
      if (st > nowMs) continue;
      const need = kmSince * (0.178 + r() * 0.03);
      const pw = 2150 + r() * 80;
      const fullMin = (need / (pw / 1000)) * 60;
      const endMs = st + fullMin * 60e3;
      const done = Math.min(endMs, nowMs);
      let kw = 0;
      for (let t = st; t < done; t += 60e3) {
        const step = Math.min(60e3, done - t);
        const k = (pw / 1000) * (step / 3600e3);
        add('togg', t, k); add('ev_salter', t, k); kw += k;
      }
      const id = new Date(st).toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
      const s = { id, start: Math.floor(st / 1000), kwh: kw, peak_w: Math.round(pw + 15), active: endMs > nowMs };
      if (!s.active) {
        Object.assign(s, { end: Math.floor(endMs / 1000), minutes: Math.round(fullMin), avg_w: Math.round(pw) });
        if (r() < 0.7) s.odo = Math.round(odo);
        kmSince = 0;
      } else {
        s.target_kwh = need;
        active = s;
      }
      sessions.togg[id] = s;
    }
  }
  const months = {};
  for (const [dev, dm] of Object.entries(days)) {
    months[dev] = {};
    for (const [k, v] of Object.entries(dm)) { const ym = k.slice(0, 7); months[dev][ym] = (months[dev][ym] || 0) + v; }
  }
  // saatlik veri: son 30 gün
  const cut = iso(new Date(now.getTime() - 30 * 864e5));
  for (const dev of Object.keys(hours)) for (const k of Object.keys(hours[dev])) if (k < cut) delete hours[dev][k];

  const ts = Math.floor(nowMs / 1000);
  const evW = active ? 2195 : 0;
  return {
    devices: {
      ev_salter: { name: 'Ev Şalteri', type: 'ana_sayac', provider: 'ewelink', icon: 'home', color: '#9b8cff', room: 'Sigorta kutusu', enabled: true, order: 0 },
      togg: { name: 'Togg T10X', type: 'ev_sarj', provider: 'tuya', icon: 'car', color: '#22d3d6', room: 'Balkon', enabled: true, order: 1, max_amp: 16 },
      camasir: { name: 'Çamaşır Makinesi', type: 'priz', provider: 'tuya', icon: 'wash', color: '#3b82f6', room: 'Banyo', enabled: true, order: 2 },
      sarici: { name: 'Kablo Sarıcı', type: 'kablo_sarici', provider: 'esp32', icon: 'reel', color: '#22d3d6', room: 'Balkon', enabled: true, order: 3 },
    },
    live: {
      ev_salter: { ok: true, on: true, w: 520 + evW, v: 228.4, a: (520 + evW) / 228.4, ts, today: days.ev_salter[iso(now)] || 0 },
      togg: { ok: true, on: true, w: evW, v: 228.1, a: evW / 228.1, ts, today: days.togg[iso(now)] || 0,
        session: active ? { id: active.id, start: active.start, kwh: active.kwh } : undefined },
      camasir: { ok: true, on: true, w: 1.2, v: 228.6, a: 0.01, ts, today: days.camasir[iso(now)] || 0 },
    },
    days, hours, months, sessions,
    settings: {
      tariff: { [y]: { limit_kwh: 4000, normal_tl: 3.24, sktt_tl: 6.49, onceki_yil_kwh: 3610 }, [y + 1]: { limit_kwh: 3000 } },
      alerts: { esikler: [70, 85, 95] },
      car: { battery_kwh: 88.5, efficiency: 0.9 },
    },
    status: { ts, devices: 3, host: 'demo', ntfy: 'EvEnerji-demo' },
    discovered: { gunsan_priz_2: { name: 'Günsan Priz 2', product: 'Günsan Akıllı Priz 16A', category: 'cz', provider: 'tuya' } },
    winder: { state: { online: true, state: active ? 'acik' : 'sarili', turns: active ? 0 : 13, lock: !active, ts } },
    _active: active,
  };
}

// Canlı akış taklidi: birkaç saniyede bir güç değerlerini oynatır
export function tickDemo(raw) {
  const ts = Math.floor(Date.now() / 1000);
  const a = raw._active;
  const L = raw.live;
  const evW = a && L.togg.on !== false ? 2180 + Math.random() * 35 : 0;
  if (a && evW) {
    const k = (evW / 1000) * (4 / 3600);
    a.kwh += k; L.togg.today += k; L.ev_salter.today += k;
    L.togg.session = { id: a.id, start: a.start, kwh: a.kwh };
  }
  const homeW = 380 + Math.random() * 260 + (Math.random() < 0.08 ? 1800 : 0);
  Object.assign(L.togg, { w: evW, a: evW / 228, ts });
  Object.assign(L.ev_salter, { w: homeW + evW + (L.camasir.on ? L.camasir.w : 0), a: (homeW + evW) / 228, v: 227 + Math.random() * 3, ts });
  L.ev_salter.today += (homeW / 1000) * (4 / 3600);
  L.camasir.ts = ts;
}
