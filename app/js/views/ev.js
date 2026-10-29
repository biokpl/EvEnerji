// Ev ekranı: dönem grafikleri, kümülatif limit, saat ısı haritası, cihaz kırılımı
import { axisStyle, colors, mount, stackedBars } from '../charts.js';
import { AYLAR, AY_K, GUN_K, esc, icon, iso, kwh, num, pct, tl } from '../ui.js';

let period = 'gun30';

function seriesFor(M) {
  const evDay = M.evDay;
  if (period === 'bugun') {
    const hrs = (id) => M.home ? (M.raw.hours?.[id]?.[M.today] || Array(24).fill(0)) : Array(24).fill(0);
    const h = hrs(M.home.id);
    const e = Array(24).fill(0);
    M.evs.forEach((d) => (M.raw.hours?.[d.id]?.[M.today] || []).forEach((v, i) => { e[i] += v; }));
    const upto = M.now.getHours() + 1;
    return { cats: [...Array(upto).keys()].map((i) => `${i}`), ev: e.slice(0, upto), other: h.slice(0, upto).map((v, i) => Math.max(0, v - e[i])), unit: 'kWh/saat', label: (c) => `${c}:00` };
  }
  if (period === 'gun30') {
    const d = M.lastN(M.home.id, 30);
    const e = d.map(([k]) => evDay(k));
    return { cats: d.map(([k]) => `${+k.slice(8)}.${+k.slice(5, 7)}`), ev: e, other: d.map(([, v], i) => Math.max(0, v - e[i])), unit: 'kWh/gün',
      label: (c, i) => { const dt = new Date(d[i][0]); return `${dt.getDate()} ${AYLAR[dt.getMonth()]} ${GUN_K[dt.getDay()]}`; } };
  }
  const n = M.mi + 1;
  return { cats: AY_K.slice(0, n), ev: M.evMonths.slice(0, n), other: M.homeMonths.slice(0, n).map((v, i) => Math.max(0, v - M.evMonths[i])), unit: 'kWh/ay', label: (c, i) => AYLAR[i] };
}

function breakdown(M) {
  const ym = `${M.y}-${String(M.mi + 1).padStart(2, '0')}`;
  const firstEv = M.evs[0]?.id;
  const rows = M.plugs.map((d) => ({ d, k: Number(M.raw.months?.[d.id]?.[ym] || 0) + (d.id === firstEv ? M.histMonth(ym) : 0) }))
    .filter((r) => r.k > 0.01).sort((a, b) => b.k - a.k);
  const known = rows.reduce((a, r) => a + r.k, 0);
  // Ana sayaç ay ortasında başladıysa ölçülen prizler toplamı geçebilir
  const total = Math.max(M.homeMonths[M.mi], known);
  if (!total) return '<div class="empty">Bu ay için veri yok.</div>';
  const other = Math.max(0, total - known);
  const all = [...rows.map((r) => ({ name: r.d.name, k: r.k, color: r.d.type === 'ev_sarj' ? 'var(--ev)' : (r.d.color || 'var(--accent2)'), ic: r.d.icon })),
    { name: 'Diğer (ölçülmeyen)', k: other, color: 'var(--home)', ic: 'home' }];
  return `
    <div class="share-bar">${all.map((r) => `<i style="width:${(r.k / total) * 100}%;background:${r.color}"></i>`).join('')}</div>
    <table class="table"><thead><tr><th>Cihaz</th><th>kWh</th><th>Pay</th><th>TL</th></tr></thead><tbody>
    ${all.map((r) => `<tr><td><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${r.color};margin-right:7px"></span>${esc(r.name)}</td>
      <td>${num(r.k, 1)}</td><td>${pct((r.k / total) * 100)}</td><td>${num(r.k * M.priceNow)}</td></tr>`).join('')}
    </tbody></table>`;
}

export function renderEv(el, M, app) {
  if (!M.home) {
    el.innerHTML = `<div class="card"><div class="empty">${icon('home')}<br>Ana sayaç (ev şalteri) tanımlı değil.<br>Cihazlar sekmesinden şalterin türünü <b>Ana sayaç</b> yap.</div></div>`;
    return;
  }
  el.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="k-label">${icon('bolt')}Bugün</div><div class="k-val">${num(M.todayHome, 1)}<small>kWh</small></div><div class="k-sub">${tl(M.todayHome * M.priceNow)}</div></div>
      <div class="kpi"><div class="k-label">${icon('calc')}Günlük hız</div><div class="k-val">${num(M.rate, 1)}<small>kWh</small></div><div class="k-sub">bütçe ${kwh(M.butce, 1)}/gün</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Tüketim</h2>
        <div class="seg" id="seg">${[['bugun', 'Bugün'], ['gun30', '30 gün'], ['yil', 'Yıl']].map(([k, t]) => `<button data-p="${k}" class="${period === k ? 'on' : ''}">${t}</button>`).join('')}</div></div>
      <div class="legend"><span><i style="background:var(--home)"></i>Ev (diğer)</span><span><i style="background:var(--ev)"></i>Togg</span></div>
      <div class="chart" id="cp"></div>
    </div>
    <div class="card">
      <h2>Yıllık limit yolu</h2>
      <p class="hint">Kümülatif tüketim, yıl sonu tahmini ve ${num(M.t.limit_kwh)} kWh limiti.</p>
      <div class="legend"><span><i style="background:var(--accent)"></i>Gerçekleşen</span><span><i style="background:var(--faint)"></i>Tahmin</span><span><i style="background:var(--bad);height:2px"></i>Limit</span></div>
      <div class="chart short" id="cc"></div>
      <details class="tbl"><summary>Aylık tablo (TL)</summary>
        <table class="table"><thead><tr><th>Ay</th><th>kWh</th><th>Togg</th><th>TL</th></tr></thead><tbody>
        ${M.homeMonths.map((k, i) => (i <= M.mi ? `<tr class="${M.durum.aylikSktt[i] ? 'sktt' : ''}"><td>${AYLAR[i]}</td><td>${num(k)}</td><td>${num(M.evMonths[i])}</td><td>${num(M.durum.aylikTl[i])}</td></tr>` : '')).join('')}
        <tr><td><b>Toplam</b></td><td><b>${num(M.ytd)}</b></td><td><b>${num(M.evYtd)}</b></td><td><b>${num(M.durum.toplamTl)}</b></td></tr>
        </tbody></table></details>
    </div>
    <div class="card">
      <h2>Saat saat (son 14 gün)</h2>
      <p class="hint">Koyu hücre = o saatte yüksek tüketim. Togg dahil.</p>
      <div class="chart heat" id="ch"></div>
    </div>
    <div class="card">
      <h2>${AYLAR[M.mi]} kırılımı</h2>
      <p class="hint">Ölçülen prizler ve ana sayaçtan kalan pay.</p>
      ${breakdown(M)}
    </div>`;

  el.querySelector('#seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]');
    if (b) { period = b.dataset.p; app.refresh(); }
  });

  const c = colors();
  const ax = axisStyle(c);
  const s = seriesFor(M);
  mount(el.querySelector('#cp'), stackedBars(c, s.cats, s.ev.map((v) => +v.toFixed(3)), s.other.map((v) => +v.toFixed(3)), {
    tip: (p) => `<b>${s.label(p[0].axisValue, p[0].dataIndex)}</b><br>${p.map((x) => `${x.marker}${x.seriesName}: ${num(x.value, period === 'yil' ? 0 : 2)} kWh`).join('<br>')}<br>Toplam: <b>${num(p.reduce((a, x) => a + x.value, 0), period === 'yil' ? 0 : 2)} kWh</b>`,
  }));

  // Kümülatif
  const cum = []; let acc = 0;
  M.homeMonths.forEach((v, i) => { acc += v; cum.push(i <= M.mi ? +acc.toFixed(0) : null); });
  const pcum = []; let pa = 0;
  M.projDurum.aylik.forEach((v, i) => { pa += v; pcum.push(i >= M.mi ? +pa.toFixed(0) : null); });
  mount(el.querySelector('#cc'), {
    grid: { left: 44, right: 10, top: 14, bottom: 24 },
    tooltip: { trigger: 'axis', formatter: (p) => `<b>${AYLAR[p[0].dataIndex]} sonu</b><br>${p.filter((x) => x.value != null).map((x) => `${x.marker}${x.seriesName}: ${num(x.value)} kWh`).join('<br>')}` },
    xAxis: { type: 'category', data: AY_K, boundaryGap: false, ...ax },
    yAxis: { type: 'value', ...ax, axisLine: { show: false }, max: (v) => Math.ceil(Math.max(v.max, M.t.limit_kwh) * 1.08 / 500) * 500, splitNumber: 4 },
    series: [
      { name: 'Gerçekleşen', type: 'line', data: cum, symbol: 'circle', symbolSize: 8, lineStyle: { width: 2, color: c.accent }, itemStyle: { color: c.accent, borderColor: c.card, borderWidth: 2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: c.accent + '55' }, { offset: 1, color: c.accent + '00' }]) },
        markLine: { symbol: 'none', silent: true, lineStyle: { color: c.bad, width: 1.5, type: 'solid' }, label: { formatter: `Limit ${num(M.t.limit_kwh)}`, color: c.bad, fontWeight: 700, fontSize: 11, position: 'insideStartTop' }, data: [{ yAxis: M.t.limit_kwh }] } },
      { name: 'Tahmin', type: 'line', data: pcum, symbol: 'none', lineStyle: { width: 2, type: 'dashed', color: c.faint } },
    ],
  });

  // Isı haritası: 14 gün x 24 saat
  const d14 = [];
  for (let i = 13; i >= 0; i--) d14.push(iso(new Date(M.now.getTime() - i * 864e5)));
  const data = [];
  let max = 0;
  d14.forEach((k, yi) => {
    const h = M.raw.hours?.[M.home.id]?.[k];
    if (!h) return;
    h.forEach((v, hi) => { if (k === M.today && hi > M.now.getHours()) return; data.push([hi, yi, +v.toFixed(3)]); max = Math.max(max, v); });
  });
  mount(el.querySelector('#ch'), {
    grid: { left: 52, right: 6, top: 6, bottom: 24 },
    tooltip: { formatter: (p) => `<b>${d14[p.value[1]].split('-').reverse().slice(0, 2).join('.')} · ${p.value[0]}:00</b><br>${num(p.value[2], 2)} kWh` },
    xAxis: { type: 'category', data: [...Array(24).keys()], ...ax, axisLine: { show: false }, axisLabel: { ...ax.axisLabel, interval: 3 }, splitArea: { show: false } },
    yAxis: { type: 'category', data: d14.map((k) => { const dt = new Date(k); return `${GUN_K[dt.getDay()]} ${dt.getDate()}`; }), ...ax, axisLine: { show: false }, axisLabel: { ...ax.axisLabel, fontSize: 10 } },
    visualMap: { show: false, min: 0, max: max || 1, inRange: { color: [c.hi, c.home + '88', c.home] } },
    series: [{ type: 'heatmap', data, itemStyle: { borderColor: c.card, borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: c.text } } }],
  });
}
