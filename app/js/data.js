// Veri katmanı: Firebase Realtime Database (REST + canlı akış) veya örnek veri.
import { buildDemo, tickDemo } from './demo.js';
import { iso } from './ui.js';

const DEFAULT_FB = "https://ev-enerji-default-rtdb.europe-west1.firebasedatabase.app";
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { return null; } };

const subs = new Set();
let es = null, esWinder = null, demoTimer = null, refreshTimer = null;

export const store = {
  raw: null,
  mode: 'loading',        // 'live' | 'demo' | 'loading'
  reason: '',
  online: false,
  lastLive: 0,
  get fb() { return LS('evEnerji.fb') || DEFAULT_FB; },
  get forcedDemo() { return LS('evEnerji.demo') === '1'; },
  setForcedDemo(on) { LS('evEnerji.demo', on ? '1' : null); location.reload(); },
  get key() { return LS('evEnerji.key') || ''; },
  setKey(k) { LS('evEnerji.key', k || null); },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  emit(kind = 'all') { subs.forEach((fn) => fn(kind)); },

  async init() {
    if (this.forcedDemo) return this.startDemo('Demo modu açık (Ayarlar).');
    try {
      const raw = await loadAll(this.fb);
      const enabled = Object.values(raw.devices || {}).filter((d) => d.enabled);
      const hasData = Object.keys(raw.settings?.bills || {}).length || raw.settings?.ev_history;
      if (!enabled.length && !hasData) return this.startDemo('Henüz cihaz bağlanmadı; örnek verilerle gösteriliyor.');
      this.raw = raw;
      this.mode = 'live';
      this.online = true;
      this.startStreams();
      refreshTimer = setInterval(() => this.reload(), 120e3);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.reload(); });
      this.emit('all');
    } catch (e) {
      console.warn(e);
      this.startDemo('Sunucuya ulaşılamadı; örnek verilerle gösteriliyor.');
    }
  },

  startDemo(reason) {
    this.mode = 'demo';
    this.reason = reason;
    this.online = true;
    this.raw = buildDemo();
    clearInterval(demoTimer);
    demoTimer = setInterval(() => { tickDemo(this.raw); this.lastLive = Date.now(); this.emit('live'); }, 4000);
    this.emit('all');
  },

  async reload() {
    if (this.mode !== 'live') return;
    try {
      const raw = await loadAll(this.fb);
      raw.live = { ...raw.live, ...this.raw.live };
      this.raw = raw;
      this.online = true;
      this.emit('reload');
    } catch { this.online = false; this.emit('live'); }
  },

  startStreams() {
    es?.close(); esWinder?.close();
    es = stream(`${this.fb}/live.json`, (path, data) => {
      this.raw.live = applyPatch(this.raw.live || {}, path, data);
      this.lastLive = Date.now(); this.online = true;
      this.emit('live');
    }, () => { this.online = false; this.emit('live'); });
    esWinder = stream(`${this.fb}/winder/state.json`, (path, data) => {
      this.raw.winder = { ...(this.raw.winder || {}), state: applyPatch(this.raw.winder?.state || {}, path, data) };
      this.emit('live');
    });
  },

  // ---------- yazma
  async put(path, value) {
    if (this.mode === 'demo') { setPath(this.raw, path, value); this.emit('all'); return; }
    await req('PUT', `${this.fb}/${path}.json`, value);
    setPath(this.raw, path, value);
    this.emit('all');
  },

  // Birden çok alt yolu tek istekte yazar (ör. cihaz sırası). Ekran hemen güncellenir,
  // sunucu reddederse veri yeniden yüklenip eski hâline döner.
  async patch(path, obj) {
    Object.entries(obj).forEach(([k, v]) => setPath(this.raw, `${path}/${k}`, v));
    this.emit('reload');
    if (this.mode === 'demo') return;
    try { await req('PATCH', `${this.fb}/${path}.json`, obj); }
    catch (e) { this.reload(); throw e; }
  },

  async command(device, action) {
    if (this.mode === 'demo') return demoCommand(this, device, action);
    if (!this.key) return { ok: false, msg: 'Kontrol anahtarı girilmemiş (Ayarlar).', needKey: true };
    const ts = Date.now();
    const nonce = crypto.getRandomValues(new Uint32Array(2)).join('');
    const sig = await hmacHex(this.key, `${device}|${action}|${ts}|${nonce}`);
    const { name } = await req('POST', `${this.fb}/commands.json`, { device, action, ts, nonce, sig });
    for (let i = 0; i < 30; i++) {
      await sleep(700);
      const r = await req('GET', `${this.fb}/command_results/${name}.json`);
      if (r) { req('DELETE', `${this.fb}/command_results/${name}.json`).catch(() => {}); return r; }
    }
    return { ok: false, msg: 'Pi yanıt vermedi. Servis çalışıyor mu?' };
  },
};

// ---------- Firebase yardımcıları
async function req(method, url, body) {
  const r = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  if (!r.ok) throw new Error(`${method} ${r.status}`);
  return r.json();
}
const q = (start) => `?orderBy=${encodeURIComponent('"$key"')}&startAt=${encodeURIComponent(`"${start}"`)}`;

async function loadAll(fb) {
  const get = (p, query = '') => req('GET', `${fb}/${p}.json${query}`).catch(() => null);
  const [devices, live, months, sessions, settings, status, discovered, winder] = await Promise.all(
    ['devices', 'live', 'months', 'sessions', 'settings', 'status', 'discovered', 'winder'].map((p) => get(p)));
  if (devices === null && status === null) {
    // ikisi de boşsa yine de sunucu yanıt verdi mi kontrol et
    await req('GET', `${fb}/status.json`);
  }
  const now = new Date();
  const dStart = `${now.getFullYear() - 1}-01-01`;
  const hStart = iso(new Date(now.getTime() - 30 * 864e5));
  const ids = Object.keys(devices || {});
  const [days, hours] = await Promise.all([
    Promise.all(ids.map((id) => get(`days/${id}`, q(dStart)))),
    Promise.all(ids.map((id) => get(`hours/${id}`, q(hStart)))),
  ]);
  const pack = (arr) => Object.fromEntries(ids.map((id, i) => [id, arr[i] || {}]));
  return { devices: devices || {}, live: live || {}, months: months || {}, sessions: sessions || {}, settings: settings || {},
    status: status || {}, discovered: discovered || {}, winder: winder || {}, days: pack(days), hours: pack(hours) };
}

function stream(url, onData, onError) {
  const s = new EventSource(url);
  const h = (e) => { try { const { path, data } = JSON.parse(e.data); onData(path, data); } catch {} };
  s.addEventListener('put', h);
  s.addEventListener('patch', (e) => {
    try {
      const { path, data } = JSON.parse(e.data);
      for (const [k, v] of Object.entries(data || {})) onData(`${path.replace(/\/$/, '')}/${k}`, v);
    } catch {}
  });
  s.onerror = () => onError && onError();
  return s;
}

function applyPatch(obj, path, data) {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return data || {};
  const root = { ...obj };
  let o = root;
  parts.slice(0, -1).forEach((p) => { o[p] = { ...(o[p] || {}) }; o = o[p]; });
  if (data === null) delete o[parts.at(-1)]; else o[parts.at(-1)] = data;
  return root;
}

function setPath(obj, path, value) {
  const parts = path.split('/').filter(Boolean);
  let o = obj;
  parts.slice(0, -1).forEach((p) => { o = o[p] ||= {}; });
  if (value === null) delete o[parts.at(-1)]; else o[parts.at(-1)] = value;
}

async function hmacHex(key, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- demo komutları
async function demoCommand(st, device, action) {
  await sleep(600);
  const raw = st.raw;
  if (device === 'sarici') {
    const w = raw.winder.state;
    if ((action === 'sar' || action === 'ac') && (raw.live.togg?.w || 0) > 50) return { ok: false, msg: 'Şarj sürüyor; önce şarjı bitir.' };
    if (action === 'dur') { w.state = w.prev || 'acik'; st.emit('live'); return { ok: true, msg: 'Durduruldu' }; }
    if (action === 'kalibre') return { ok: true, msg: 'Kalibrasyon sarımı başlatıldı' };
    w.prev = action === 'sar' ? 'acik' : 'sarili';
    w.state = action === 'sar' ? 'sariyor' : 'aciliyor';
    w.lock = false;
    st.emit('live');
    setTimeout(() => { w.state = action === 'sar' ? 'sarili' : 'acik'; w.lock = action === 'sar'; w.turns = action === 'sar' ? 13 : 0; st.emit('live'); }, 6000);
    return { ok: true, msg: action === 'sar' ? 'Sarma başladı' : 'Açma başladı' };
  }
  const L = raw.live[device];
  if (!L) return { ok: false, msg: 'Cihaz çevrimdışı' };
  const m = raw.devices[device];
  if (action === 'on' && m.type === 'ev_sarj' && ['sarili', 'sariyor', 'aciliyor'].includes(raw.winder?.state?.state))
    return { ok: false, msg: 'Kablo sarılı; önce kabloyu aç.' };
  L.on = action === 'on';
  if (!L.on) { L.w = 0; L.a = 0; }
  st.emit('live');
  return { ok: true, msg: L.on ? 'Açıldı' : 'Kapatıldı' };
}
