// Cihazlar: tüm prizler ve sayaçlar; aç/kapa, düzenle, yeni priz ekle
import { pendingSwitch } from '../model.js';
import { DEVICE_ICONS, closeSheet, esc, icon, kwh, num, openSheet, toast, watt, ago } from '../ui.js';

const TYPES = { ev_sarj: 'Araç şarjı', priz: 'Priz', ana_sayac: 'Ana sayaç', kablo_sarici: 'Kablo sarıcı' };
const COLORS = ['#22d3d6', '#3b82f6', '#9b8cff', '#f472b6', '#fb923c', '#34d399', '#facc15', '#94a3b8'];
const busy = new Set();

function devCard(M, d) {
  const L = d.live || {};
  const stale = !L.ts || Date.now() / 1000 - L.ts > 120;
  const offline = d.type !== 'kablo_sarici' && (stale || L.ok === false);
  const on = d.type === 'ana_sayac' ? true : L.on !== false && !offline;
  const canSwitch = d.provider === 'tuya' && d.type !== 'ana_sayac';
  let sub;
  if (d.type === 'kablo_sarici') {
    const w = M.winder;
    sub = w?.online ? `Durum: <b>${esc(w.state)}</b>` : 'Henüz bağlı değil';
  } else if (offline) {
    sub = `Çevrimdışı${L.ts ? ' · ' + ago(L.ts) : ''}`;
  } else {
    sub = `<b>${watt(L.w)}</b>${L.v ? ` · ${num(L.v)} V` : ''}${L.a != null ? ` · ${num(L.a, 2)} A` : ''} · bugün ${kwh(L.today || 0)}`;
  }
  const right = canSwitch
    ? `<button class="switch ${on ? 'on' : ''} ${busy.has(d.id) ? 'busy' : ''}" data-sw="${esc(d.id)}" aria-label="${esc(d.name)} ${on ? 'kapat' : 'aç'}" ${offline ? 'disabled' : ''}></button>`
    : d.type === 'ana_sayac' ? `<span class="lock">${icon('lock')}Yalnız ölçüm</span>` : '';
  return `
  <div class="dev ${on && !offline ? 'on' : ''} ${offline ? 'offline' : ''}" style="--dc:${esc(d.color || '#3b82f6')}">
    <div class="d-ic" data-edit="${esc(d.id)}" role="button" aria-label="${esc(d.name)} düzenle">${icon(d.icon || 'plug')}</div>
    <div data-edit="${esc(d.id)}" role="button" style="min-width:0;cursor:pointer">
      <div class="d-name">${esc(d.name)}${d.enabled ? '' : ' <span class="muted">(kapalı)</span>'}</div>
      <div class="d-sub">${esc(TYPES[d.type] || d.type)}${d.room ? ' · ' + esc(d.room) : ''}</div>
      <div class="d-sub">${sub}</div>
    </div>
    ${right}
  </div>`;
}

function editSheet(M, id, app, fresh = null) {
  const d = fresh || M.devices.find((x) => x.id === id);
  let ic = d.icon || 'plug', col = d.color || COLORS[1];
  openSheet(`
    <h3>${fresh ? 'Yeni prizi ekle' : esc(d.name)}</h3>
    <div class="sh-sub">${fresh ? esc(fresh.product || 'Tuya priz') : `Kimlik: ${esc(d.id)} · ${esc(d.provider || '')}`}</div>
    <div class="field"><label for="nm">Ad</label><input class="input" id="nm" value="${esc(d.name)}" style="width:190px"></div>
    <div class="field"><label for="rm">Oda / yer</label><input class="input" id="rm" value="${esc(d.room || '')}" placeholder="ör. Mutfak" style="width:190px"></div>
    <div class="field"><label for="tp">Tür</label>
      <select class="input" id="tp">${Object.entries(TYPES).filter(([k]) => k !== 'kablo_sarici' || d.type === 'kablo_sarici').map(([k, v]) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="field"><div><label for="ma">Akım sınırı (A)</label><small>Uzun süre bunun %85'i aşılırsa uyarı gelir.</small></div><input class="input num" id="ma" inputmode="decimal" value="${d.max_amp ?? 16}"></div>
    <div style="margin:14px 0 8px;font-weight:800;font-size:14px">İkon</div>
    <div class="icon-pick" id="ip">${DEVICE_ICONS.map((n) => `<button data-i="${n}" class="${n === ic ? 'on' : ''}" aria-label="${n}">${icon(n)}</button>`).join('')}</div>
    <div style="margin:14px 0 8px;font-weight:800;font-size:14px">Renk</div>
    <div class="icon-pick" id="cp">${COLORS.map((c) => `<button data-c="${c}" class="${c === col ? 'on' : ''}" aria-label="renk ${c}"><i style="width:20px;height:20px;border-radius:50%;background:${c};display:block"></i></button>`).join('')}</div>
    <div class="field" style="margin-top:6px"><div><label>Etkin</label><small>Kapalıysa ölçülmez ve listede soluk görünür.</small></div><button class="switch ${d.enabled !== false ? 'on' : ''}" id="en"></button></div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn ghost" id="cancel">Vazgeç</button>
      <button class="btn primary" id="save">${icon('check')}${fresh ? 'Ekle' : 'Kaydet'}</button>
    </div>`, (sh) => {
    sh.querySelector('#ip').onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; ic = b.dataset.i; sh.querySelectorAll('#ip button').forEach((x) => x.classList.toggle('on', x === b)); };
    sh.querySelector('#cp').onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; col = b.dataset.c; sh.querySelectorAll('#cp button').forEach((x) => x.classList.toggle('on', x === b)); };
    const en = sh.querySelector('#en');
    en.onclick = () => en.classList.toggle('on');
    sh.querySelector('#cancel').onclick = () => closeSheet();
    sh.querySelector('#save').onclick = async () => {
      const meta = {
        name: sh.querySelector('#nm').value.trim() || d.name, room: sh.querySelector('#rm').value.trim(),
        type: sh.querySelector('#tp').value, icon: ic, color: col, provider: d.provider || 'tuya',
        max_amp: Number(String(sh.querySelector('#ma').value).replace(',', '.')) || 16,
        enabled: en.classList.contains('on'), order: d.order ?? M.devices.length,
      };
      try {
        await app.store.put(`devices/${id}`, meta);
        if (fresh) await app.store.put(`discovered/${id}`, null);
        closeSheet(); toast(fresh ? 'Priz eklendi; 1 dk içinde ölçüm başlar' : 'Kaydedildi');
      } catch { toast('Kaydedilemedi'); }
    };
  });
}

function addHelp() {
  openSheet(`
    <h3>Yeni akıllı priz ekle</h3>
    <div class="sh-sub">Ölçümlü (W gösteren) Günsan veya başka bir Tuya/Smart Life uyumlu priz olmalı.</div>
    <ol class="steps">
      <li>Prizi takıp <b>Smart Life</b> uygulamasıyla eşle (2,4 GHz Wi-Fi).</li>
      <li>Pi, Tuya bulutunu 6 saatte bir tarar; hemen istersen Pi'de <b>python discover.py</b> çalıştır.</li>
      <li>Priz bu sayfada <b>"Yeni priz bulundu"</b> kartı olarak çıkar; <b>Ekle</b>'ye dokun, ad/oda/ikon seç.</li>
      <li>Bir dakika içinde canlı güç ve günlük kWh gelmeye başlar.</li>
    </ol>
    <p class="chart-note">Başka marka (ör. eWeLink) priz için Pi'deki <b>devices_local.json</b>'a kayıt eklenir; uygulama tarafında değişiklik gerekmez.</p>
    <button class="btn ghost" id="ok" style="margin-top:12px">Tamam</button>`, (sh) => { sh.querySelector('#ok').onclick = () => closeSheet(); });
}

export function renderCihazlar(el, M, app) {
  const list = M.devices;
  el.innerHTML = `
    ${M.discovered.length ? `<div class="card found"><h2>${icon('wifi', 'style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;color:var(--accent)"')}Yeni priz bulundu</h2>
      <p class="hint">Smart Life hesabında henüz eklenmemiş prizler.</p>
      <div class="stack">${M.discovered.map(([id, d]) => `<div class="row-between"><div><b>${esc(d.name)}</b><div class="muted" style="font-size:12px">${esc(d.product || '')}</div></div>
        <button class="btn primary sm" data-add="${esc(id)}">${icon('plus')}Ekle</button></div>`).join('')}</div></div>` : ''}
    <div class="devs">${list.map((d) => devCard(M, d)).join('')}</div>
    <div style="height:10px"></div>
    <button class="add-dev" id="add">${icon('plus')}Priz ekle</button>
    <p class="chart-note" style="text-align:center;margin-top:12px">Ana şalter güvenlik için uzaktan kapatılamaz. Araç şarj prizi, kablo sarılıyken açılmaz.</p>`;

  el.querySelector('#add').onclick = addHelp;
  el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const [id, d] = M.discovered.find(([x]) => x === b.dataset.add);
    editSheet(M, id, app, { id, name: d.name, provider: d.provider || 'tuya', type: 'priz', icon: 'plug', color: COLORS[1], enabled: true, product: d.product });
  }));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editSheet(M, b.dataset.edit, app)));
  el.querySelectorAll('[data-sw]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.sw;
    const turnOn = !b.classList.contains('on');
    // Düğme anında döner; Pi yeni durumu bildirince gerçek veriyle birleşir
    pendingSwitch.set(id, { on: turnOn, since: Date.now(), until: Date.now() + 20e3 });
    busy.add(id);
    b.classList.add('busy'); b.classList.toggle('on', turnOn);
    b.closest('.dev')?.classList.toggle('on', turnOn);
    app.store.emit('live');
    let ok = false;
    try {
      const r = await app.store.command(id, turnOn ? 'on' : 'off');
      ok = !!r.ok;
      if (!ok) toast(r.msg || 'Başarısız');
      if (r.needKey) app.go('ayarlar');
    } catch { toast('Komut gönderilemedi'); }
    busy.delete(id);
    if (!ok) pendingSwitch.delete(id);   // başarısızsa eski duruma dön
    document.querySelectorAll(`[data-sw="${CSS.escape(id)}"]`).forEach((x) => x.classList.remove('busy'));
    if (!ok) app.refresh({ silent: true, force: true });
    else app.store.emit('live');
  }));
}
