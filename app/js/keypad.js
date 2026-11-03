// Cam açılır pencereler: telefonun kendi pencereleri yerine, dokunulan kutunun yanında açılan
// iOS sıvı camı görünümlü küçük baloncuklar.
//  - Sayı alanları (input.num, fatura data-m): rakam tuş takımı (0–9, nokta, sil)
//  - Tarih alanları (type="date"): ay takvimi
//  - Seçim listeleri (select): seçenek listesi
//  - Renk seçici (type="color"): renk paleti
// Asıl alanlar yerinde kalır (değer ve change/input olayları aynen çalışır); tarih ve seçim
// için yanlarına aynı görünümlü bir düğme konur, asıl alan gizlenir.
const SAYI = 'input.num, input[data-m]';
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const RENKLER = ['#22d3d6', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#ef4444', '#f97316',
  '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#0ea5e9', '#64748b', '#94a3b8', '#e2e8f0'];

let pop = null;          // açık baloncuk
let cur = null;          // bağlı olduğu alan (görünen kutu)
let kapanis = null;      // kapanırken çalışacak iş
let tk = null;           // tuş takımı durumu

// ---------- ortak baloncuk ----------
function baloncuk(cls) {
  const p = document.createElement('div');
  p.className = `cam ${cls}`;
  p.setAttribute('role', 'dialog');
  document.body.appendChild(p);
  p.addEventListener('pointerdown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
  return p;
}

function yerlestir() {
  if (!cur || !pop) return;
  const r = cur.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return kapat();
  const w = pop.offsetWidth, h = pop.offsetHeight, m = 8;
  const alt = innerHeight - r.bottom, ust = r.top;
  const y = alt >= h + m + 70 || alt >= ust ? r.bottom + m : Math.max(8, r.top - h - m);   // altta yer yoksa üstte
  const x = Math.min(innerWidth - w - 10, Math.max(10, r.right - w));
  pop.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function ac(p, kutu, kapaninca) {
  kapat();
  pop = p; cur = kutu; kapanis = kapaninca || null;
  kutu.classList.add('kp-on');
  p.classList.add('on');
  yerlestir();
}

export function kapat() {
  if (!cur) return;
  const k = cur, is = kapanis;
  cur = null; kapanis = null;
  k.classList.remove('kp-on', 'kp-sec');
  pop?.classList.remove('on');
  is?.();
}

const olay = (el, ad) => el.dispatchEvent(new Event(ad, { bubbles: true }));

// ---------- sayı tuş takımı ----------
let tkPop = null;
function tusTakimi() {
  if (tkPop) return tkPop;
  tkPop = baloncuk('kpop');
  tkPop.setAttribute('aria-label', 'Sayı tuş takımı');
  const t = (k, lbl, cls = '') => `<button type="button" class="${cls}" data-k="${k}" aria-label="${lbl}">${k === 'del' ? '⌫' : k === 'ok' ? '✓' : k}</button>`;
  tkPop.innerHTML = [t('1', '1'), t('2', '2'), t('3', '3'), t('del', 'Sil', 'fn'),
    t('4', '4'), t('5', '5'), t('6', '6'), t('ok', 'Tamam', 'ok'),
    t('7', '7'), t('8', '8'), t('9', '9'), t('.', 'Nokta', 'dot'), t('0', '0')].join('');
  tkPop.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b && tk) bas(b.dataset.k); });
  return tkPop;
}

function bas(k) {
  const i = tk.i;
  let v = i.value.replace(',', '.');
  if (k === 'ok') return kapat();
  if (k === 'del') v = v.slice(0, -1);
  else if (tk.yeni) v = k === '.' ? (i.dataset.kp === 'int' ? v : '0.') : k;     // ilk tuş eski değerin yerine geçer
  else if (k === '.') { if (i.dataset.kp === 'int' || v.includes('.')) return; v = (v || '0') + '.'; }
  else {
    if (v.includes('.') && v.split('.')[1].length >= 3) return;      // en çok 3 ondalık
    if (v.replace('.', '').length >= 9) return;
    v = v === '0' ? k : v + k;
  }
  tk.yeni = false; i.classList.remove('kp-sec');
  i.value = v;
  olay(i, 'input');
}

function sayiAc(i) {
  const p = tusTakimi();
  const ilk = i.value;
  p.classList.toggle('int', i.dataset.kp === 'int');
  ac(p, i, () => { tk = null; if (i.value !== ilk) olay(i, 'change'); });
  tk = { i, yeni: i.value !== '' };
  i.classList.toggle('kp-sec', tk.yeni);
}

// ---------- takvim ----------
let tvPop = null, tv = null;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tarihYazi = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}` : '');

function takvimCiz() {
  const { y, m, sec } = tv;
  const ilk = new Date(y, m, 1), bos = (ilk.getDay() + 6) % 7, gun = new Date(y, m + 1, 0).getDate();
  const bugun = iso(new Date());
  let h = `<div class="tv-bas"><button type="button" data-a="-1" aria-label="Önceki ay">‹</button><b>${AYLAR[m]} ${y}</b><button type="button" data-a="1" aria-label="Sonraki ay">›</button></div><div class="tv-gun">`;
  h += ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'].map((g) => `<span>${g}</span>`).join('');
  for (let i = 0; i < bos; i++) h += '<span></span>';
  for (let g = 1; g <= gun; g++) {
    const v = iso(new Date(y, m, g));
    h += `<button type="button" data-d="${v}" class="${v === sec ? 'on' : ''} ${v === bugun ? 'bugun' : ''}">${g}</button>`;
  }
  tvPop.innerHTML = h + '</div>';
}

function takvimAc(asil, kutu) {
  if (!tvPop) {
    tvPop = baloncuk('tvpop');
    tvPop.setAttribute('aria-label', 'Takvim');
    tvPop.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]'), d = e.target.closest('[data-d]');
      if (a) { const t = new Date(tv.y, tv.m + Number(a.dataset.a), 1); tv.y = t.getFullYear(); tv.m = t.getMonth(); takvimCiz(); yerlestir(); }
      if (d) {
        tv.asil.value = d.dataset.d;
        tv.kutu.textContent = tarihYazi(d.dataset.d);
        olay(tv.asil, 'input'); olay(tv.asil, 'change');
        kapat();
      }
    });
  }
  const v = asil.value, t = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(+v.slice(0, 4), +v.slice(5, 7) - 1, 1) : new Date();
  tv = { asil, kutu, sec: v, y: t.getFullYear(), m: t.getMonth() };
  takvimCiz();
  ac(tvPop, kutu);
}

// ---------- seçim listesi ----------
let slPop = null;
function secimAc(sel, kutu) {
  if (!slPop) {
    slPop = baloncuk('slpop');
    slPop.setAttribute('aria-label', 'Seçenekler');
    slPop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b || !slPop.sel) return;
      const s = slPop.sel;
      if (s.value !== b.dataset.v) { s.value = b.dataset.v; olay(s, 'input'); olay(s, 'change'); }
      slPop.kutu.textContent = s.options[s.selectedIndex]?.text || '';
      kapat();
    });
  }
  slPop.sel = sel; slPop.kutu = kutu;
  slPop.innerHTML = [...sel.options].map((o) => `<button type="button" data-v="${o.value.replace(/"/g, '&quot;')}" class="${o.selected ? 'on' : ''}">${o.text.replace(/</g, '&lt;')}</button>`).join('');
  ac(slPop, kutu);
}

// ---------- renk paleti ----------
let rkPop = null;
function renkAc(inp, kutu) {
  if (!rkPop) {
    rkPop = baloncuk('rkpop');
    rkPop.setAttribute('aria-label', 'Renk seç');
    rkPop.innerHTML = RENKLER.map((c) => `<button type="button" data-c="${c}" aria-label="renk ${c}" style="--c:${c}"></button>`).join('');
    rkPop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (!b || !rkPop.inp) return;
      rkPop.inp.value = b.dataset.c;
      olay(rkPop.inp, 'input'); olay(rkPop.inp, 'change');
      kapat();
    });
  }
  rkPop.inp = inp;
  rkPop.querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c.toLowerCase() === inp.value.toLowerCase()));
  ac(rkPop, kutu);
}

// ---------- alanları hazırla ----------
function vekil(asil, yazi) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `${asil.className} cam-alan`;
  if (asil.getAttribute('style')) b.setAttribute('style', asil.getAttribute('style'));
  if (asil.id) b.setAttribute('aria-labelledby', asil.id);
  b.setAttribute('aria-label', asil.getAttribute('aria-label') || '');
  b.textContent = yazi;
  asil.classList.add('cam-gizli');
  asil.after(b);
  return b;
}

function hazirla() {
  document.querySelectorAll(SAYI).forEach((i) => {
    if (i.dataset.kp) return;
    i.dataset.kp = i.getAttribute('inputmode') === 'numeric' ? 'int' : 'dec';
    i.setAttribute('inputmode', 'none');
    i.readOnly = true;
  });
  document.querySelectorAll('input[type="date"]:not([data-cam])').forEach((d) => {
    d.dataset.cam = '1';
    const b = vekil(d, tarihYazi(d.value) || 'Seç');
    b.addEventListener('click', () => takvimAc(d, b));
  });
  document.querySelectorAll('select:not([data-cam])').forEach((s) => {
    s.dataset.cam = '1';
    const b = vekil(s, s.options[s.selectedIndex]?.text || '');
    b.classList.add('cam-sec');
    b.addEventListener('click', () => secimAc(s, b));
  });
  document.querySelectorAll('input[type="color"]:not([data-cam])').forEach((c) => {
    c.dataset.cam = '1';
    const kutu = c.closest('label') || c;
    c.classList.add('cam-gizli');
    kutu.addEventListener('click', (e) => { e.preventDefault(); renkAc(c, kutu); });
  });
}

export function initKeypad() {
  hazirla();
  new MutationObserver(() => {
    hazirla();
    if (cur && !cur.isConnected) { cur = null; tk = null; pop?.classList.remove('on'); }
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (e) => {
    const i = e.target.closest?.(SAYI);
    if (i) sayiAc(i);
  });
  document.addEventListener('pointerdown', (e) => {
    if (cur && !e.target.closest?.('.cam') && !cur.contains(e.target) && !e.target.closest?.(SAYI)) kapat();
  });
  addEventListener('scroll', yerlestir, { passive: true, capture: true });
  addEventListener('resize', yerlestir);
  addEventListener('hashchange', kapat);
}
