// Sayı alanları için uygulamanın kendi cam tuş takımı: kutunun hemen yanında açılır,
// yalnız 0–9, nokta (tam sayı alanlarında yok) ve sil. Telefon klavyesi açılmaz.
// Kapsam: class="input num" olan ve data-m (fatura) alanları; yazı alanlarına dokunmaz.
const SEC = 'input.num, input[data-m]';
let pop = null, cur = null, ilk = '', yeni = false;   // yeni: ilk tuş eski değerin yerine geçer

function hazirla(i) {
  if (i.dataset.kp) return;
  i.dataset.kp = i.getAttribute('inputmode') === 'numeric' ? 'int' : 'dec';
  i.setAttribute('inputmode', 'none');
  i.readOnly = true;
}

function olustur() {
  pop = document.createElement('div');
  pop.className = 'kpop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Sayı tuş takımı');
  const t = (k, lbl, cls = '') => `<button type="button" class="${cls}" data-k="${k}" aria-label="${lbl}">${k === 'del' ? '⌫' : k === 'ok' ? '✓' : k}</button>`;
  pop.innerHTML = [
    t('1', '1'), t('2', '2'), t('3', '3'), t('del', 'Sil', 'fn'),
    t('4', '4'), t('5', '5'), t('6', '6'), t('ok', 'Tamam', 'ok'),
    t('7', '7'), t('8', '8'), t('9', '9'),
    t('.', 'Nokta', 'dot'), t('0', '0'),
  ].join('');
  document.body.appendChild(pop);
  pop.addEventListener('pointerdown', (e) => e.preventDefault());
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (b && cur) bas(b.dataset.k);
  });
}

function bas(k) {
  let v = cur.value.replace(',', '.');
  if (k === 'ok') return kapat();
  if (k === 'del') v = v.slice(0, -1);
  else if (yeni) v = k === '.' ? (cur.dataset.kp === 'int' ? v : '0.') : k;
  else if (k === '.') { if (cur.dataset.kp === 'int' || v.includes('.')) return; v = (v || '0') + '.'; }
  else {
    if (v.includes('.') && v.split('.')[1].length >= 3) return;      // en çok 3 ondalık
    if (v.replace('.', '').length >= 9) return;
    v = v === '0' ? k : v + k;
  }
  yeni = false; cur.classList.remove('kp-sec');
  cur.value = v;
  cur.dispatchEvent(new Event('input', { bubbles: true }));
}

function yerlestir() {
  if (!cur || !pop) return;
  const r = cur.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return kapat();
  const w = pop.offsetWidth, h = pop.offsetHeight, m = 8;
  const alt = innerHeight - r.bottom, ust = r.top;
  const y = alt >= h + m + 70 || alt >= ust ? r.bottom + m : r.top - h - m;    // altta yer yoksa üstte
  const x = Math.min(innerWidth - w - 10, Math.max(10, r.right - w));
  pop.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function ac(i) {
  if (!pop) olustur();
  if (cur && cur !== i) kapat();
  cur = i; ilk = i.value; yeni = i.value !== '';
  i.classList.add('kp-on');
  i.classList.toggle('kp-sec', yeni);
  pop.classList.toggle('int', i.dataset.kp === 'int');
  pop.classList.add('on');
  yerlestir();
}

export function kapat() {
  if (!cur) return;
  const i = cur;
  cur = null;
  i.classList.remove('kp-on', 'kp-sec');
  pop?.classList.remove('on');
  if (i.value !== ilk) i.dispatchEvent(new Event('change', { bubbles: true }));
}

export function initKeypad() {
  document.querySelectorAll(SEC).forEach(hazirla);
  new MutationObserver(() => {
    document.querySelectorAll(SEC).forEach(hazirla);
    if (cur && !cur.isConnected) { cur = null; pop?.classList.remove('on'); }
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (e) => {
    const i = e.target.closest?.(SEC);
    if (i) { hazirla(i); ac(i); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (cur && !e.target.closest?.('.kpop') && !e.target.closest?.(SEC)) kapat();
  });
  addEventListener('scroll', yerlestir, { passive: true, capture: true });
  addEventListener('resize', yerlestir);
  addEventListener('hashchange', kapat);
}
