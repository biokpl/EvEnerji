// Cihazlar: tüm prizler ve sayaçlar; aç/kapa, düzenle, yeni priz ekle
import { pendingSwitch } from '../model.js';
import { store } from '../data.js';
import { axisStyle, colors, mount } from '../charts.js';
import { AYLAR, DEVICE_ICONS, GUN_K, closeSheet, esc, icon, kwh, num, openSheet, tl, toast, watt, ago } from '../ui.js';

// Uygulama açıkken gelen canlı güç ölçümleri (cihaz başına son ~2 saat, 3 sn aralıkla): detay ekranındaki canlı grafik
const trace = new Map();
store.subscribe((kind) => {
  if (kind !== 'live') return;
  for (const [id, L] of Object.entries(store.raw?.live || {})) {
    if (!L?.ts || L.w == null) continue;
    const arr = trace.get(id) || [], ts = L.ts * 1000;
    // zamana göre sıralı tut: geç gelen eski ölçüm araya girer, aynı an iki kez eklenmez
    let i = arr.length;
    while (i > 0 && arr[i - 1][0] > ts) i--;
    if (i > 0 && arr[i - 1][0] === ts) continue;
    arr.splice(i, 0, [ts, L.w]);
    if (arr.length > 2400) arr.shift();   // 3 sn aralıkla ~2 saat
    trace.set(id, arr);
  }
});

const TYPES = { ev_sarj: 'Araç şarjı', priz: 'Priz', ana_sayac: 'Ana sayaç', kablo_sarici: 'Kablo sarıcı' };
// 17 hazır renk + sonda "özel renk" düğmesi (6 sütunlu ızgarada 3 tam satır)
const COLORS = [
  '#22d3d6', '#38bdf8', '#3b82f6', '#6366f1', '#9b8cff', '#d946ef',
  '#f472b6', '#ef4444', '#fb923c', '#f59e0b', '#facc15', '#a3e635',
  '#34d399', '#14b8a6', '#a16207', '#e5e7eb', '#94a3b8',
];
const busy = new Set();
let sorting = false;   // "Sırala" modu: kartlarda yukarı/aşağı okları

// Kartın canlı veriyle değişen kısmı (ilk çizimde ve anlık güncellemede ortak)
function devState(M, d) {
  const L = d.live || {};
  const stale = !L.ts || Date.now() / 1000 - L.ts > 120;
  const offline = d.type !== 'kablo_sarici' && (stale || L.ok === false);
  const on = d.type === 'ana_sayac' ? true : L.on !== false && !offline;
  let sub;
  if (d.type === 'kablo_sarici') {
    const w = M.winder;
    sub = w?.online ? `Durum: <b>${esc(w.state)}</b>` : 'Henüz bağlı değil';
  } else if (offline) {
    sub = `Çevrimdışı${L.ts ? ' · ' + ago(L.ts) : ''}`;
  } else {
    sub = `<b>${watt(L.w)}</b>${L.v ? ` · ${num(L.v)} V` : ''}${L.a != null ? ` · ${num(L.a, 2)} A` : ''} · bugün ${kwh(L.today || 0)}`;
  }
  return { offline, on, sub };
}

// Kart dizilişini değiştiren her şey; değişirse kartlar baştan çizilir
const layoutKey = (M) => JSON.stringify([sorting, M.discovered.map(([id]) => id),
  M.devices.map((d) => [d.id, d.name, d.icon, d.color, d.enabled, d.room, d.type, d.provider])]);

function devCard(M, d) {
  const { offline, on, sub } = devState(M, d);
  const canSwitch = d.provider === 'tuya' && d.type !== 'ana_sayac';
  const right = sorting
    ? `<div class="sort-btns"><button data-mv="-1" data-id="${esc(d.id)}" aria-label="${esc(d.name)} yukarı">${icon('up')}</button><button data-mv="1" data-id="${esc(d.id)}" aria-label="${esc(d.name)} aşağı">${icon('downArrow')}</button></div>`
    : canSwitch
    ? `<button class="switch ${on ? 'on' : ''} ${busy.has(d.id) ? 'busy' : ''}" data-sw="${esc(d.id)}" aria-label="${esc(d.name)} ${on ? 'kapat' : 'aç'}" ${offline ? 'disabled' : ''}></button>`
    : d.type === 'ana_sayac' ? `<span class="lock">${icon('lock')}Yalnız ölçüm</span>` : '';
  return `
  <div class="dev ${on && !offline ? 'on' : ''} ${offline ? 'offline' : ''} ${sorting ? 'sorting' : ''}" data-dev="${esc(d.id)}" style="--dc:${esc(d.color || '#3b82f6')}">
    <div class="d-ic" data-edit="${esc(d.id)}" role="button" aria-label="${esc(d.name)} düzenle">${icon(d.icon || 'plug')}</div>
    <div data-edit="${esc(d.id)}" role="button" style="min-width:0;cursor:pointer">
      <div class="d-name">${esc(d.name)}${d.enabled ? '' : ' <span class="muted">(kapalı)</span>'}</div>
      <div class="d-sub">${esc(TYPES[d.type] || d.type)}${d.room ? ' · ' + esc(d.room) : ''}</div>
      <div class="d-sub" data-live>${sub}</div>
    </div>
    ${right}
  </div>`;
}

function editSheet(M, id, app, fresh = null) {
  const d = fresh || M.devices.find((x) => x.id === id);
  let ic = d.icon || 'plug', col = d.color || COLORS[2];
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
    <div class="icon-pick" id="cp">${COLORS.map((c) => `<button data-c="${c}" class="${c === col ? 'on' : ''}" aria-label="renk ${c}"><i style="width:20px;height:20px;border-radius:50%;background:${c};display:block"></i></button>`).join('')}
      <label class="custom-col ${COLORS.includes(col) ? '' : 'on'}" aria-label="Özel renk seç"><i style="${COLORS.includes(col) ? '' : `background:${esc(col)}`}"></i><input type="color" id="cc" value="${esc(/^#[0-9a-f]{6}$/i.test(col) ? col : '#3b82f6')}"></label></div>
    <div class="field" style="margin-top:6px"><div><label>Etkin</label><small>Kapalıysa ölçülmez ve listede soluk görünür.</small></div><button class="switch ${d.enabled !== false ? 'on' : ''}" id="en"></button></div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn ghost" id="cancel">Vazgeç</button>
      <button class="btn primary" id="save">${icon('check')}${fresh ? 'Ekle' : 'Kaydet'}</button>
    </div>`, (sh) => {
    sh.querySelector('#ip').onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; ic = b.dataset.i; sh.querySelectorAll('#ip button').forEach((x) => x.classList.toggle('on', x === b)); };
    const cust = sh.querySelector('.custom-col');
    sh.querySelector('#cp').onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; col = b.dataset.c; cust.classList.remove('on'); sh.querySelectorAll('#cp button').forEach((x) => x.classList.toggle('on', x === b)); };
    sh.querySelector('#cc').oninput = (e) => {
      col = e.target.value;
      cust.querySelector('i').style.background = col; cust.classList.add('on');
      sh.querySelectorAll('#cp button').forEach((x) => x.classList.remove('on'));
    };
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

// Cihaz detayı: durum + büyük canlı güç, yük çubuğu, 4 istatistik, tek grafik (Canlı / Bugün / 30 gün)
let dtTab = 'bugun';

// Cihaz rengi temaya göre okunur kalsın: açık temada çok açık, koyu temada çok koyu renkler ayarlanır
function markColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#3b82f6';
  const n = parseInt(m[1], 16), rgb = [n >> 16, (n >> 8) & 255, n & 255];
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const light = document.documentElement.dataset.theme === 'light';
  const hx = (a) => '#' + a.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('');
  if (light && lum > 0.62) return hx(rgb.map((c) => c * (0.62 / lum)));
  if (!light && lum < 0.28) return hx(rgb.map((c) => c + (255 - c) * 0.45));
  return hx(rgb);
}

function detailSheet(M, id, app) {
  const d = M.devices.find((x) => x.id === id);
  if (!d) return;
  const col = markColor(d.color || '#3b82f6');
  const ym = `${M.y}-${String(M.mi + 1).padStart(2, '0')}`;
  const month = Number(M.raw.months?.[id]?.[ym] || 0);
  const d30 = M.lastN(id, 30);
  const sum30 = d30.reduce((a, [, v]) => a + v, 0);
  const active = d30.filter(([, v]) => v > 0.001);
  const avg = active.length ? sum30 / active.length : 0;
  const peak = d30.reduce((b, x) => (x[1] > b[1] ? x : b), ['', 0]);
  const hours = M.raw.hours?.[id]?.[M.today] || Array(24).fill(0);
  const nowH = M.now.getHours();
  const live = () => store.raw?.live?.[id] || {};
  const fmtDay = (k) => { const dt = new Date(k); return `${dt.getDate()} ${AYLAR[dt.getMonth()].slice(0, 3)}`; };

  const status = () => {
    const L = live();
    const stale = !L.ts || Date.now() / 1000 - L.ts > 120;
    if (stale || L.ok === false) return { c: 'off', t: 'Çevrimdışı' };
    if (L.on === false) return { c: 'idle', t: 'Kapalı' };
    return (L.w || 0) > 3 ? { c: 'run', t: 'Çalışıyor' } : { c: 'on', t: 'Açık · boşta' };
  };
  const heroHtml = () => {
    const L = live(), st = status();
    const maxW = (d.max_amp || 16) * (L.v || 230);
    const load = st.c === 'off' ? 0 : Math.min(100, ((L.w || 0) / maxW) * 100);
    return `
      <div class="dt-hero-row">
        <div class="dt-power">${st.c === 'off' ? '–' : watt(L.w)}</div>
        <span class="dt-pill ${st.c}"><i></i>${st.t}</span>
      </div>
      <div class="dt-chips">${L.v ? `<span>${num(L.v)} V</span>` : ''}${L.a != null ? `<span>${num(L.a, 2)} A</span>` : ''}${L.ts ? `<span>${ago(L.ts)}</span>` : ''}</div>
      <div class="dt-load"><i style="width:${load.toFixed(1)}%;background:${col}"></i></div>
      <div class="dt-load-cap"><span>Yük %${num(load, load < 10 ? 1 : 0)}</span><span>sınır ${num(d.max_amp || 16)} A ≈ ${watt(maxW)}</span></div>`;
  };
  const stat = (label, val, unit, sub) => `<div class="dt-stat"><span>${label}</span><b>${val}<small>${unit}</small></b><em>${sub}</em></div>`;

  const sh = openSheet(`
    <div class="dt-head">
      <div class="dt-ic" style="--dc:${esc(col)}">${icon(d.icon || 'plug')}</div>
      <div class="dt-name"><h3>${esc(d.name)}</h3><div>${esc(TYPES[d.type] || d.type)}${d.room ? ' · ' + esc(d.room) : ''}</div></div>
      <button class="icon-btn" id="edit" aria-label="Düzenle">${icon('edit')}</button>
    </div>
    <div class="dt-hero" id="dh">${heroHtml()}</div>
    <div class="dt-stats">
      ${stat('Bugün', num(live().today ?? 0, 2), 'kWh', tl((live().today || 0) * M.priceNow))}
      ${stat(AYLAR[M.mi], num(month, month < 10 ? 2 : 1), 'kWh', tl(month * M.priceNow))}
      ${stat('Günlük ort.', num(avg, avg < 10 ? 2 : 1), 'kWh', active.length ? `${active.length} günde` : 'veri yok')}
      ${stat('En yüksek gün', num(peak[1], peak[1] < 10 ? 2 : 1), 'kWh', peak[1] > 0 ? fmtDay(peak[0]) : '–')}
    </div>
    <div class="dt-chart-card">
      <div class="dt-chart-head"><b id="dct">Bugün</b>
        <div class="seg" id="dseg">${[['canli', 'Canlı'], ['bugun', 'Bugün'], ['gun30', '30 gün']].map(([k, t]) => `<button data-t="${k}" class="${dtTab === k ? 'on' : ''}">${t}</button>`).join('')}</div></div>
      <div class="dt-note" id="dcn"></div>
      <div class="dt-plot"><div id="dc" class="dt-chart"></div><div class="dt-empty" id="dce" hidden></div></div>
    </div>
    <p class="chart-note" style="text-align:center;margin-top:10px">₺ değerleri şu anki birim fiyatla (${num(M.priceNow, 2)} ₺/kWh) hesaplanır.</p>`, (sh) => {
    sh.querySelector('#edit').onclick = () => editSheet(M, id, app);
  });

  const c = colors(), ax = axisStyle(c);
  const grid = { left: 44, right: 10, top: 14, bottom: 26 };
  const zero = (f) => (v) => (v === 0 ? '0' : f(v));   // eksende 0,00 yerine 0
  const yAx = (fmt) => ({ type: 'value', min: 0, ...ax, axisLine: { show: false }, splitNumber: 3,
    axisLabel: { ...ax.axisLabel, formatter: zero(fmt) } });
  const grad = (a, b) => ({ type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: col + a }, { offset: 1, color: col + b }] });
  const dim = col + 'a8';   // geçmiş çubuklar biraz soluk, güncel olan tam renk
  let ch = null;

  // Canlı grafiğin saat ekseni: veri süresine göre sabit bir pencere (2 dk … 2 sa) ve o pencereye
  // özgü sabit etiket aralığı. Böylece etiketler her ölçümde yeniden dizilmez, eşit aralıkla kayar.
  const WINS = [[2, 30], [5, 60], [10, 120], [15, 180], [30, 300], [60, 600], [120, 1200]];  // [dk, adım sn]
  const liveX = (t) => {
    const last = t.length ? t[t.length - 1][0] : Date.now();
    const span = t.length ? last - t[0][0] : 0;
    const [mins, step] = WINS.find(([m]) => m * 60e3 >= span) || WINS[WINS.length - 1];
    const min = last - mins * 60e3, ms = step * 1000, ticks = [];
    for (let v = Math.ceil(min / ms) * ms; v <= last; v += ms) ticks.push(v);   // tam saat değerleri
    const pad = mins * 60e3 * 0.07;   // kenara çok yakın etiket yarım kesilmesin
    const labels = ticks.filter((v) => v - min > pad && last - v > pad);
    return { type: 'time', ...ax, min, max: last, splitLine: { show: false },
      axisTick: { ...(ax.axisTick || {}), customValues: ticks },
      axisLabel: { ...ax.axisLabel, customValues: labels, hideOverlap: true,
        formatter: step < 60 ? '{HH}:{mm}:{ss}' : '{HH}:{mm}' } };
  };

  const views = {
    canli: () => {
      const t = trace.get(id) || [];
      return {
        title: 'Canlı güç', note: 'Uygulama açıkken gelen ölçümler.',
        empty: t.length < 2 ? 'Ölçümler toplanıyor… Ekran açık kaldıkça çizgi oluşacak.' : '',
        opt: {
          grid, tooltip: { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: c.faint } }, valueFormatter: (v) => watt(v) },
          xAxis: liveX(t),
          yAxis: { ...yAx((v) => (v >= 1000 ? `${num(v / 1000, 1)} kW` : `${v} W`)), max: (v) => Math.max(10, Math.ceil(v.max * 1.25)) },
          series: [{ type: 'line', data: t, showSymbol: false, smooth: 0.3, lineStyle: { color: col, width: 2 },
            areaStyle: { color: grad('55', '05') }, emphasis: { disabled: true } }],
        },
      };
    },
    bugun: () => {
      const sum = hours.reduce((a, b) => a + b, 0);
      const peakH = hours.reduce((b, v, i) => (v > hours[b] ? i : b), 0);
      return {
        title: 'Bugün, saat saat', note: sum > 0.0005 ? `Toplam ${kwh(sum)} · en yoğun saat ${peakH}:00–${peakH + 1}:00` : '',
        empty: sum > 0.0005 ? '' : 'Bugün henüz tüketim yok.',
        opt: {
          grid, tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: c.hi } },
            formatter: (p) => `<b>${p[0].dataIndex}:00–${p[0].dataIndex + 1}:00</b><br>${num(p[0].value || 0, 3)} kWh · ${tl((p[0].value || 0) * M.priceNow)}` },
          xAxis: { type: 'category', data: [...Array(24).keys()].map((h) => `${h}`), ...ax, axisLabel: { ...ax.axisLabel, interval: 3 } },
          yAxis: yAx((v) => num(v, v < 1 ? 2 : 1)),
          series: [{ type: 'bar', barWidth: '62%', data: hours.map((v, h) => ({ value: h > nowH ? null : +v.toFixed(4),
            itemStyle: { color: h === nowH ? col : dim, borderRadius: [4, 4, 0, 0] } })) }],
        },
      };
    },
    gun30: () => ({
      title: 'Son 30 gün', note: sum30 > 0.001 ? `Toplam ${kwh(sum30)} · ${tl(sum30 * M.priceNow)} · kesikli çizgi: ortalama` : '',
      empty: sum30 > 0.001 ? '' : 'Son 30 günde kayıt yok.',
      opt: {
        grid, tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: c.hi } },
          formatter: (p) => { const dt = new Date(d30[p[0].dataIndex][0]); return `<b>${dt.getDate()} ${AYLAR[dt.getMonth()]} ${GUN_K[dt.getDay()]}</b><br>${num(p[0].value, 2)} kWh · ${tl(p[0].value * M.priceNow)}`; } },
        xAxis: { type: 'category', data: d30.map(([k]) => fmtDay(k)), ...ax, axisLabel: { ...ax.axisLabel, interval: 6 } },
        yAxis: yAx((v) => num(v, v < 1 ? 2 : 1)),
        series: [{ type: 'bar', barWidth: '64%', data: d30.map(([, v], i) => ({ value: +v.toFixed(3),
          itemStyle: { color: i === d30.length - 1 ? col : dim, borderRadius: [4, 4, 0, 0] } })),
          markLine: avg > 0 ? { symbol: 'none', silent: true, lineStyle: { color: c.muted, type: 'dashed', width: 1 },
            label: { show: false }, data: [{ yAxis: +avg.toFixed(3) }] } : undefined }],
      },
    }),
  };

  const draw = () => {
    const v = views[dtTab]();
    sh.querySelector('#dct').textContent = v.title;
    sh.querySelector('#dcn').textContent = v.note || '';
    const empty = sh.querySelector('#dce');
    empty.hidden = !v.empty; empty.textContent = v.empty || '';
    if (ch) { ch.dispose(); ch = null; }
    if (!v.empty) ch = mount(sh.querySelector('#dc'), v.opt);
  };
  sh.querySelector('#dseg').onclick = (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    dtTab = b.dataset.t;
    sh.querySelectorAll('#dseg button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  };
  // sayfa açılış animasyonu bitince çiz (boyut doğru ölçülsün); açık kaldıkça canlı güncelle
  setTimeout(() => {
    draw();
    const off = store.subscribe((kind) => {
      if (!sh.isConnected) return off();
      if (kind !== 'live') return;
      sh.querySelector('#dh').innerHTML = heroHtml();
      if (dtTab === 'canli') {
        const t = trace.get(id) || [];
        if (ch && t.length >= 2) ch.setOption({ xAxis: liveX(t), series: [{ data: t }] });
        else if (!ch && t.length >= 2) draw();
      }
    });
  }, 340);
}

// Canlı veri gelince kartları baştan çizmeden yalnız değişen değerleri günceller.
// Kart dizilişi değiştiyse (ad, renk, sıra, yeni priz…) false döner: uygulama baştan çizer.
export function updateCihazlar(el, M) {
  if (el.dataset.layout !== layoutKey(M)) return false;
  for (const d of M.devices) {
    const card = el.querySelector(`[data-dev="${CSS.escape(d.id)}"]`);
    if (!card) return false;
    const { offline, on, sub } = devState(M, d);
    card.classList.toggle('on', on && !offline);
    card.classList.toggle('offline', offline);
    const s = card.querySelector('[data-live]');
    if (s && s.innerHTML !== sub) s.innerHTML = sub;
    const sw = card.querySelector('[data-sw]');
    if (sw && !busy.has(d.id)) {
      sw.classList.toggle('on', on);
      sw.disabled = offline;
      sw.setAttribute('aria-label', `${d.name} ${on ? 'kapat' : 'aç'}`);
    }
  }
  return true;
}

export function renderCihazlar(el, M, app) {
  const list = M.devices;
  el.dataset.layout = layoutKey(M);
  el.innerHTML = `
    ${M.discovered.length ? `<div class="card found"><h2>${icon('wifi', 'style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;color:var(--accent)"')}Yeni priz bulundu</h2>
      <p class="hint">Smart Life hesabında henüz eklenmemiş prizler.</p>
      <div class="stack">${M.discovered.map(([id, d]) => `<div class="row-between"><div><b>${esc(d.name)}</b><div class="muted" style="font-size:12px">${esc(d.product || '')}</div></div>
        <button class="btn primary sm" data-add="${esc(id)}">${icon('plus')}Ekle</button></div>`).join('')}</div></div>` : ''}
    ${list.length > 1 ? `<div class="devs-head"><span>${sorting ? 'Okları kullanarak sırala' : `${list.length} cihaz`}</span>
      <button class="btn ${sorting ? 'primary' : 'ghost'} sm" id="sort">${icon(sorting ? 'check' : 'edit')}${sorting ? 'Bitti' : 'Sırala'}</button></div>` : ''}
    <div class="devs">${list.map((d) => devCard(M, d)).join('')}</div>
    <div style="height:10px"></div>
    <button class="add-dev" id="add">${icon('plus')}Priz ekle</button>
    <p class="chart-note" style="text-align:center;margin-top:12px">Ana şalter güvenlik için uzaktan kapatılamaz. Araç şarj prizi, kablo sarılıyken açılmaz.</p>`;

  el.querySelector('#add').onclick = addHelp;
  el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const [id, d] = M.discovered.find(([x]) => x === b.dataset.add);
    editSheet(M, id, app, { id, name: d.name, provider: d.provider || 'tuya', type: 'priz', icon: 'plug', color: COLORS[2], enabled: true, product: d.product });
  }));
  el.querySelector('#sort')?.addEventListener('click', () => { sorting = !sorting; app.refresh({ silent: true, force: true }); });
  el.querySelectorAll('[data-mv]').forEach((b) => b.addEventListener('click', async () => {
    const ids = list.map((d) => d.id);
    const i = ids.indexOf(b.dataset.id), j = i + Number(b.dataset.mv);
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    // tüm sıraları 0..n-1 olarak yeniden yaz (eşit sıra numaraları da düzelir)
    try { await app.store.patch('devices', Object.fromEntries(ids.map((id, k) => [`${id}/order`, k]))); }
    catch { toast('Sıra kaydedilemedi'); }
  }));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    if (sorting) return;
    const d = M.devices.find((x) => x.id === b.dataset.edit);
    if (d?.type === 'kablo_sarici') editSheet(M, d.id, app); else detailSheet(M, b.dataset.edit, app);
  }));
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
