// Togg ekranı: yıl özeti, verimlilik, aylık şarj, oturum listesi
import { axisStyle, colors, mount } from '../charts.js';
import { AYLAR, AY_K, GUN_K, closeSheet, dur, esc, hm, icon, kwh, num, openSheet, pct, tl, toast, watt } from '../ui.js';
import { chargeCard } from './pano.js';

let showAll = false;

function sessItem(M, s) {
  const d = new Date(s.start * 1000);
  const live = s.active || (M.activeSession && M.activeSession.id === s.id);
  const cost = s.tl ?? s.kwh * M.priceNow;
  return `
  <button class="sess-item ${live ? 'live' : ''}" data-sid="${esc(s.sid)}" data-dev="${esc(s.dev)}">
    <div class="sess-date"><b>${d.getDate()}</b><span>${AY_K[d.getMonth()]}</span></div>
    <div class="sess-main">
      <div class="t">${live ? 'Şarj sürüyor' : `${GUN_K[d.getDay()]} ${hm(s.start)}${s.end ? ' – ' + hm(s.end) : ''}`}</div>
      <div class="s">${live ? `Başlangıç ${hm(s.start)}` : dur(s.minutes ?? ((s.end - s.start) / 60))}${s.per100 ? ` · ${num(s.per100, 1)} kWh/100 km` : ''}${s.odo ? ` · ${num(s.odo)} km` : ''}</div>
    </div>
    <div class="sess-amt"><b>${num(s.kwh, 1)} kWh</b>${tl(cost)}</div>
  </button>`;
}

function openSession(M, s, app) {
  const cost = s.tl ?? s.kwh * M.priceNow;
  const sktt = s.tl_sktt ?? s.kwh * M.t.sktt_tl;
  const soc = (s.kwh * M.car.efficiency) / M.car.battery_kwh * 100;
  const d = new Date(s.start * 1000);
  openSheet(`
    <h3>${d.getDate()} ${AYLAR[d.getMonth()]} ${d.getFullYear()}</h3>
    <div class="sh-sub">${hm(s.start)}${s.end ? ` – ${hm(s.end)} · ${dur(s.minutes ?? (s.end - s.start) / 60)}` : ' · sürüyor'}</div>
    <div class="mini-stats">
      <div><b>${num(s.kwh, 2)}</b><span>kWh</span></div>
      <div><b>${num(cost, 2)}</b><span>₺</span></div>
      <div><b>+${pct(soc)}</b><span>≈ batarya</span></div>
    </div>
    <div class="mini-stats">
      <div><b>${watt(s.peak_w)}</b><span>tepe güç</span></div>
      <div><b>${s.avg_w ? watt(s.avg_w) : '–'}</b><span>ortalama</span></div>
      <div><b>${num(sktt, 0)}</b><span>SKTT'de ₺</span></div>
    </div>
    <div class="field">
      <div><label for="odo">Kilometre sayacı</label><small>Şarj başlarken aracın km'si. İki şarjda girersen kWh/100 km hesaplanır.</small></div>
      <input class="input num" id="odo" inputmode="numeric" placeholder="km" value="${s.odo ?? ''}">
    </div>
    <div class="field">
      <div><label for="note">Not</label></div>
      <input class="input" id="note" placeholder="ör. uzun yol öncesi" value="${esc(s.note ?? '')}" style="width:170px">
    </div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn ghost" id="cancel">Kapat</button>
      <button class="btn primary" id="save">${icon('check')}Kaydet</button>
    </div>`, (sh) => {
    sh.querySelector('#cancel').onclick = () => closeSheet();
    sh.querySelector('#save').onclick = async () => {
      const odo = parseInt(sh.querySelector('#odo').value.replace(/\D/g, ''), 10);
      const note = sh.querySelector('#note').value.trim();
      try {
        await app.store.put(`sessions/${s.dev}/${s.sid}/odo`, Number.isFinite(odo) ? odo : null);
        await app.store.put(`sessions/${s.dev}/${s.sid}/note`, note || null);
        closeSheet(); toast('Kaydedildi');
      } catch { toast('Kaydedilemedi'); }
    };
  });
}

export function renderTogg(el, M, app) {
  if (!M.evs.length && !M.histTotal) {
    el.innerHTML = `<div class="card"><div class="empty">${icon('car')}<br>Araç şarj prizi tanımlı değil.<br>Cihazlar sekmesinden prizin türünü <b>Araç şarjı</b> yap.</div></div>`;
    return;
  }
  const yearSess = M.sessions.filter((s) => new Date(s.start * 1000).getFullYear() === M.y);
  const n = yearSess.length;
  const avg = n ? yearSess.reduce((a, s) => a + (s.kwh || 0), 0) / n : 0;
  const histNote = M.histTotal > 0 ? `<div class="muted" style="font-size:11.5px;font-weight:600;margin-top:2px">${num(M.histTotal, 1)} kWh ${esc(M.history.source || 'önceki')} geçmişi dahil</div>` : '';
  const tlPer100 = M.per100 ? (M.per100 * M.priceNow) : null;
  const skttCost = M.evYtd * M.t.sktt_tl;
  const list = showAll ? M.sessions : M.sessions.slice(0, 8);
  el.innerHTML = `
    <div class="card hero">
      <div class="row-between" style="position:relative;z-index:1">
        <div><div class="muted" style="font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase">${M.y} şarjı</div>
          <div style="font-size:34px;font-weight:800;letter-spacing:-.03em" class="num">${num(M.evYtd)} <small class="muted" style="font-size:15px">kWh</small></div>
          <div class="muted" style="font-weight:700">${tl(M.evTl, 0)}${n ? ` · ${n} şarj · ort. ${kwh(avg, 1)}` : ''}</div>${histNote}</div>
        <div class="car-wrap"><img class="car-img" src="img/t10x.webp" alt="Togg T10X" width="160"></div>
      </div>
      <div class="share-bar" style="position:relative;z-index:1" aria-label="Togg payı ${pct(M.evShare * 100)}">
        <i style="width:${M.evShare * 100}%;background:var(--ev)"></i><i style="flex:1;background:var(--home)"></i></div>
      <div class="legend" style="position:relative;z-index:1"><span><i style="background:var(--ev)"></i>Togg ${pct(M.evShare * 100)}</span><span><i style="background:var(--home)"></i>Evin geri kalanı</span></div>
      <div class="trio">
        <div><b>${M.per100 ? num(M.per100, 1) : '–'}</b><span>kWh/100 km</span></div>
        <div><b>${tlPer100 ? num(tlPer100, 2) : '–'}</b><span>₺/100 km</span></div>
        <div><b>${num(M.evProj)}</b><span>yıl sonu kWh</span></div>
      </div>
    </div>
    <div data-slot="charge">${chargeCard(M)}</div>
    <div class="card">
      <div class="card-head"><h2>Aylık şarj</h2><span class="muted" style="font-size:12px;font-weight:700">kWh</span></div>
      <div class="chart short" id="cm"></div>
      <details class="tbl"><summary>Tablo olarak göster</summary>
        <table class="table"><thead><tr><th>Ay</th><th>kWh</th><th>₺</th></tr></thead><tbody>
        ${M.evMonths.map((k, i) => (i <= M.mi ? `<tr class="${M.durum.aylikSktt[i] ? 'sktt' : ''}"><td>${AYLAR[i]}</td><td>${num(k, 1)}</td><td>${num(M.evTlByMonth[i])}</td></tr>` : '')).join('')}
        </tbody></table></details>
    </div>
    <div class="card">
      <h2>Tarife karşılaştırması</h2>
      <p class="hint">Bu yılki Togg şarjının maliyeti, limit aşılıp son kaynak fiyatına geçilseydi:</p>
      <div class="mini-stats" style="grid-template-columns:1fr 1fr 1fr">
        <div><b>${num(M.evTl)}</b><span>şu anki ₺</span></div>
        <div><b style="color:var(--bad)">${num(skttCost)}</b><span>SKTT'de ₺</span></div>
        <div><b>${M.evTl ? '×' + num(skttCost / M.evTl, 1) : '–'}</b><span>kat</span></div>
      </div>
      <p class="chart-note">İstasyonla kıyas: aynı ${num(M.evYtd)} kWh halka açık istasyonda ${num(M.car.public_tl, 2)} ₺/kWh'den ≈ <b>${num(M.evYtd * M.car.public_tl)} ₺</b> ederdi (fiyat Ayarlar'da).</p>
    </div>
    <div class="card">
      <div class="card-head"><h2>Şarj oturumları</h2><span class="muted" style="font-size:12px;font-weight:700">${M.sessions.length} kayıt</span></div>
      ${M.sessions.length ? `<div class="sess">${list.map((s) => sessItem(M, s)).join('')}</div>` : '<div class="empty">Henüz oturum yok. Şarj başlayınca otomatik görünür.</div>'}
      ${M.sessions.length > 8 ? `<button class="btn ghost" id="more" style="margin-top:10px">${showAll ? 'Daha az göster' : 'Tümünü göster'}</button>` : ''}
    </div>`;

  el.querySelectorAll('.sess-item').forEach((b) => b.addEventListener('click', () => {
    const s = M.sessions.find((x) => x.sid === b.dataset.sid && x.dev === b.dataset.dev);
    if (s) openSession(M, s, app);
  }));
  el.querySelector('#more')?.addEventListener('click', () => { showAll = !showAll; app.refresh(); });

  const c = colors();
  const ax = axisStyle(c);
  const cats = AY_K.slice(0, M.mi + 1);
  mount(el.querySelector('#cm'), {
    grid: { left: 38, right: 6, top: 14, bottom: 24 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: c.hi } },
      formatter: (p) => `<b>${AYLAR[p[0].dataIndex]}</b><br>${num(p[0].value, 1)} kWh · ${tl(M.evTlByMonth[p[0].dataIndex], 0)}${M.durum.aylikSktt[p[0].dataIndex] ? '<br><span style="color:' + c.bad + '">Son kaynak fiyatı</span>' : ''}` },
    xAxis: { type: 'category', data: cats, ...ax },
    yAxis: { type: 'value', ...ax, axisLine: { show: false }, splitNumber: 4 },
    series: [{ type: 'bar', data: M.evMonths.slice(0, M.mi + 1).map((v) => +v.toFixed(1)), barMaxWidth: 24,
      itemStyle: { color: c.ev, borderRadius: [4, 4, 0, 0] }, emphasis: { itemStyle: { color: c.accent2 } } }],
  });
}

export function updateTogg(el, M) {
  const slot = el.querySelector('[data-slot="charge"]');
  if (slot) slot.innerHTML = chargeCard(M);
}
