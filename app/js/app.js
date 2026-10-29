import { store } from './data.js';
import { build } from './model.js';
import { disposeAll } from './charts.js';
import { closeSheet, hydrateIcons, icon, sheetOpen, toast } from './ui.js';
import { renderPano, updatePano } from './views/pano.js';
import { renderTogg, updateTogg } from './views/togg.js';
import { renderEv } from './views/ev.js';
import { renderCihazlar } from './views/cihazlar.js';
import { renderSarici } from './views/sarici.js';
import { renderAyarlar } from './views/ayarlar.js';

// live: canlı veride ne yapılacağı — 'update' (yalnız sayılar), 'render' (yeniden çiz), yok = dokunma
const VIEWS = {
  pano: { title: 'Pano', render: renderPano, update: updatePano },
  togg: { title: 'Togg T10X', render: renderTogg, update: updateTogg },
  ev: { title: 'Ev', render: renderEv },
  cihazlar: { title: 'Cihazlar', render: renderCihazlar, live: 'render' },
  sarici: { title: 'Kablo Sarıcı', render: renderSarici, live: 'render' },
  ayarlar: { title: 'Ayarlar', render: renderAyarlar },
};

const viewEl = document.getElementById('view');

// Tek dokunuşla kontrol anahtarı: bildirimdeki ".../#anahtar=XXXX" bağlantısı.
// "#" sonrası sunucuya gitmez; anahtar telefona kaydedilip adresten hemen silinir.
let keySaved = false;
{
  const m = location.hash.match(/^#anahtar=([\w-]{16,})$/);
  if (m) {
    store.setKey(m[1]);
    keySaved = true;
    history.replaceState(null, '', location.pathname + '#cihazlar');
  }
}
let current = (location.hash.slice(1) in VIEWS) ? location.hash.slice(1) : 'pano';
let M = null;
let lastLiveRender = 0;

hydrateIcons(document.getElementById('nav'));

export const app = {
  store,
  go(tab) { location.hash = tab; },
  refresh,
  setTheme(t) {
    try { localStorage.setItem('evEnerji.theme', t); } catch {}
    applyTheme(); refresh();
  },
};

function applyTheme() {
  let t = 'dark';
  try { t = localStorage.getItem('evEnerji.theme') || 'dark'; } catch {}
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]').content = t === 'light' ? '#eef2f8' : '#060b14';
  document.getElementById('themeBtn').innerHTML = icon(t === 'light' ? 'moon' : 'sun');
}

function header() {
  const conn = document.getElementById('conn');
  const stale = store.mode === 'live' && store.raw?.status?.ts && Date.now() / 1000 - store.raw.status.ts > 300;
  conn.className = `conn ${store.mode === 'demo' ? 'demo' : !store.online || stale ? 'off' : 'on'}`;
  let sub = 'Ev Enerji';
  if (store.mode === 'demo') sub = 'Örnek veri';
  else if (!store.online) sub = 'Bağlantı yok';
  else if (stale) sub = 'Pi yanıt vermiyor';
  else if (M?.activeSession) sub = 'Togg şarj oluyor';
  else if (M) sub = M.enabled.length ? `Canlı · ${M.enabled.length} cihaz` : 'Fatura verisi · cihaz bekleniyor';
  document.getElementById('subtxt').textContent = sub;
  document.getElementById('banner').innerHTML = store.mode === 'demo'
    ? `<div class="banner">${icon('info')}<span>${store.reason} Kurulum bitince gerçek veriye kendiliğinden geçer.</span></div>` : '';
}

function refresh({ keepScroll = true } = {}) {
  if (!store.raw) return;
  const y = window.scrollY;
  M = build(store.raw);
  disposeAll();
  const v = VIEWS[current];
  document.getElementById('title').textContent = v.title;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === current));
  header();
  viewEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'view';
  viewEl.append(wrap);
  v.render(wrap, M, app);
  if (keepScroll) window.scrollTo(0, y);
}

function onLive() {
  if (!store.raw) return;
  M = build(store.raw);
  header();
  const v = VIEWS[current];
  const wrap = viewEl.querySelector('.view');
  if (!wrap) return;
  if (v.update) v.update(wrap, M);
  else if (v.live === 'render' && Date.now() - lastLiveRender > 10e3 && !sheetOpen() && !document.activeElement?.matches('input,select')) {
    lastLiveRender = Date.now();
    const y = window.scrollY;
    wrap.innerHTML = '';
    wrap.classList.add('no-anim');
    v.render(wrap, M, app);
    window.scrollTo(0, y);
  }
}

document.getElementById('nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) location.hash = b.dataset.tab;
});
window.addEventListener('hashchange', () => {
  closeSheet();
  const t = location.hash.slice(1);
  if (t in VIEWS && t !== current) { current = t; refresh({ keepScroll: false }); window.scrollTo(0, 0); }
});
document.getElementById('themeBtn').addEventListener('click', () => {
  app.setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
});

let pending = false;
store.subscribe((kind) => {
  if (kind === 'live') return onLive();
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; refresh(); });
});

applyTheme();
viewEl.innerHTML = `<div class="empty" style="padding-top:80px">${icon('bolt')}<br>Veriler yükleniyor…</div>`;
store.init();
if (keySaved) setTimeout(() => toast('Kontrol anahtarı kaydedildi ✓ Prizleri artık buradan açıp kapatabilirsin', 4500), 1200);

// Gün dönümü ve saatlik grafikler için 5 dk'da bir tam yenile (sayfa açıksa)
setInterval(() => { if (!sheetOpen()) refresh(); }, 5 * 60 * 1000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
