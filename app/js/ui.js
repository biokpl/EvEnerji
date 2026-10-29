// Ortak arayüz yardımcıları: ikonlar, biçimlendirme, alt pencere, bildirim
const P = {
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/><circle cx="12" cy="14" r="1.6"/>',
  car: '<path d="M5 17h14M3 13l2-5.2A2 2 0 0 1 6.9 6.5h10.2A2 2 0 0 1 19 7.8L21 13v4a1 1 0 0 1-1 1h-1.5M3 13v4a1 1 0 0 0 1 1h1.5M3 13h18"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  plug: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
  reel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  bolt: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/>',
  battery: '<rect x="2.5" y="7" width="17" height="10" rx="2.5"/><path d="M22 10.5v3"/><path d="M11.5 8.8 8.8 12.3h3l-.9 3"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2A3 3 0 0 0 12 8c-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2a3 3 0 0 1-2.8-1.2M12 6.5v11"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  fridge: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M5 10h14M9 6v2M9 13v3"/>',
  wash: '<rect x="4" y="2.5" width="16" height="19" rx="2"/><circle cx="12" cy="13" r="4.5"/><path d="M8 6h.01M11 6h.01"/>',
  heater: '<path d="M8 4c-1.5 2 1.5 3 0 5M12 4c-1.5 2 1.5 3 0 5M16 4c-1.5 2 1.5 3 0 5"/><rect x="3" y="12" width="18" height="8" rx="2"/>',
  ac: '<rect x="2.5" y="5" width="19" height="8" rx="2"/><path d="M6 10h12M8 16c0 1.5-1 2-1 3M12 16v3M16 16c0 1.5 1 2 1 3"/>',
  lamp: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>',
  pc: '<rect x="2.5" y="4" width="19" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  water: '<path d="M12 2.5s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  downArrow: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  wifi: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.6a10 10 0 0 1 14 0M8.5 16.4a5 5 0 0 1 7 0M12 20h.01"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
  calc: '<rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
};

export const DEVICE_ICONS = ['plug', 'car', 'tv', 'fridge', 'wash', 'heater', 'ac', 'lamp', 'pc', 'water', 'bolt', 'home'];

export const icon = (name, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${P[name] || P.plug}</svg>`;

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = icon(el.dataset.icon); });
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Türkçe sayı biçimleri
const nf = (d) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const NF = [nf(0), nf(1), nf(2)];
export const num = (x, d = 0) => (x == null || Number.isNaN(x) ? '–' : NF[d].format(x));
export const kwh = (x, d) => `${num(x, d ?? (Math.abs(x) < 10 ? 2 : Math.abs(x) < 100 ? 1 : 0))} kWh`;
export const tl = (x, d) => `${num(x, d ?? (Math.abs(x) < 100 ? 2 : 0))} TL`;
export const watt = (w) => (w == null ? '–' : w >= 1000 ? `${num(w / 1000, 2)} kW` : `${num(w)} W`);
export const pct = (x, d = 0) => `%${num(x, d)}`;
export const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
// Ay adlarına doğru Türkçe ek: Ekim'de / Ekim'den, Kasım'da / Kasım'dan, Mart'ta / Mart'tan
const _AY_EK = [['ta', 'tan'], ['ta', 'tan'], ['ta', 'tan'], ['da', 'dan'], ['ta', 'tan'], ['da', 'dan'],
  ['da', 'dan'], ['ta', 'tan'], ['de', 'den'], ['de', 'den'], ['da', 'dan'], ['ta', 'tan']];
export const ayDa = (i) => `${AYLAR[i]}'${_AY_EK[i][0]}`;
export const ayDan = (i) => `${AYLAR[i]}'${_AY_EK[i][1]}`;
export const AY_K =['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export const GUN_K = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const hm = (ts) => new Date(ts * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
export function dur(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h} sa ${m} dk` : `${m} dk`;
}
export function ago(ts) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return 'az önce';
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  return `${Math.floor(s / 86400)} gün önce`;
}

// ---------- Alt pencere
let sheetEls = null;
export function openSheet(html, onMount) {
  closeSheet(true);
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  const sh = document.createElement('div');
  sh.className = 'sheet';
  sh.setAttribute('role', 'dialog');
  sh.innerHTML = `<div class="grab"></div>${html}`;
  document.body.append(bg, sh);
  sheetEls = { bg, sh };
  bg.addEventListener('click', () => closeSheet());
  let y0 = null;
  sh.addEventListener('touchstart', (e) => { if (sh.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  sh.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy > 0) sh.style.transform = `translate(-50%, ${dy}px)`;
  }, { passive: true });
  sh.addEventListener('touchend', (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0; y0 = null;
    sh.style.transform = '';
    if (dy > 110) closeSheet();
  });
  requestAnimationFrame(() => { bg.classList.add('open'); sh.classList.add('open'); });
  hydrateIcons(sh);
  onMount && onMount(sh);
  return sh;
}
export function closeSheet(instant = false) {
  if (!sheetEls) return;
  const { bg, sh } = sheetEls;
  sheetEls = null;
  if (instant) { bg.remove(); sh.remove(); return; }
  bg.classList.remove('open'); sh.classList.remove('open');
  setTimeout(() => { bg.remove(); sh.remove(); }, 320);
}
export const sheetOpen = () => !!sheetEls;

let toastT;
export function toast(msg, ms = 2400) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), ms);
}

export function downloadFile(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function alertBox(kind, ic, title, text) {
  return `<div class="alert ${kind}"><div class="a-ic">${icon(ic)}</div><div><b>${title}</b><p>${text}</p></div></div>`;
}
