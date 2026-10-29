// Ana pano: yıllık limit halkası, canlı güç, şarj durumu, uyarılar, 30 gün, gelecek yıl senaryosu
import { colors, mount, stackedBars } from '../charts.js';
import { AYLAR, alertBox, dur, esc, icon, kwh, num, pct, tl, watt } from '../ui.js';

const R = 96, C = 2 * Math.PI * R, ARC = 0.75 * C;

function ring(M) {
  const L = M.t.limit_kwh;
  const f = (x) => Math.max(0, Math.min(1, x / L)) * ARC;
  const other = Math.max(0, M.ytd - M.evYtd);
  const a1 = f(other), a2 = Math.max(0, f(M.ytd) - a1), a3 = Math.max(0, f(M.proj) - f(M.ytd));
  const seg = (len, off, color, extra = '') =>
    `<circle class="arc" cx="118" cy="118" r="${R}" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="butt"
      stroke-dasharray="${len} ${C}" stroke-dashoffset="${-off}" ${extra}/>`;
  const over = M.proj > L;
  return `
  <div class="ring-wrap">
    <svg viewBox="0 0 236 236" aria-hidden="true">
      <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="${over ? 'var(--bad)' : 'var(--faint)'}" opacity=".22"/><rect width="2.4" height="6" fill="${over ? 'var(--bad)' : 'var(--faint)'}" opacity=".75"/></pattern></defs>
      <circle cx="118" cy="118" r="${R}" fill="none" stroke="var(--card-hi)" stroke-width="16" stroke-dasharray="${ARC} ${C}" stroke-linecap="round"/>
      ${a3 > 0.5 ? seg(a3, a1 + a2, 'url(#hatch)') : ''}
      ${seg(a1, 0, 'var(--home)')}
      ${a2 > 0.5 ? seg(a2 - 2, a1 + 2, 'var(--ev)') : ''}
    </svg>
    <div class="ring-center">
      <div class="lbl">${M.y} tüketimi</div>
      <div class="big num">${num(M.ytd)}<small> kWh</small></div>
      <div class="of">limit ${num(L)} kWh · ${pct((M.ytd / L) * 100)}</div>
    </div>
  </div>
  <div class="ring-legend">
    <span><i style="background:var(--home)"></i>Ev</span>
    <span><i style="background:var(--ev)"></i>Togg</span>
    <span><i class="proj"></i>Yıl sonu tahmini</span>
  </div>`;
}

function heroText(M) {
  const L = M.t.limit_kwh;
  const parts = [`Bu gidişle yıl sonu <b>≈ ${kwh(M.proj, 0)}</b>.`];
  if (M.exceedDate === 'gecti') parts.push('Yıllık limit <b>aşıldı</b>.');
  else if (M.exceedDate) parts.push(`Limit <b>${M.exceedDate.getDate()} ${AYLAR[M.exceedDate.getMonth()]}</b> civarı aşılabilir.`);
  const sb = M.projDurum.skttBas;
  if (sb && M.ytd <= L) parts.push(`Aşılırsa son kaynak fiyatı <b>${AYLAR[sb[1] - 1]} ${sb[0]}</b>'den itibaren.`);
  if (M.t.onceki_yil_kwh > L) parts.push('Geçen yıl limiti aştığı için bu yıl <b>son kaynak tarifesindesin</b>.');
  return parts.join(' ');
}

function kpis(M) {
  const charging = M.evW > 50;
  return `
  <div class="kpis">
    <div class="kpi" data-go="ev">
      <div class="k-label">${icon('home')}Ev şu an</div>
      <div class="k-val" data-live="homeW">${M.homeW == null ? '–' : watt(M.homeW)}</div>
      <div class="k-sub">Bugün <span data-live="todayHome">${kwh(M.todayHome)}</span></div>
    </div>
    <div class="kpi ${charging ? 'charging' : ''}" data-go="togg" data-live-cls="evKpi">
      <div class="k-label">${charging ? '<span class="pulse"></span>' : icon('car')}Togg</div>
      <div class="k-val" data-live="evW">${charging ? watt(M.evW) : 'Boşta'}</div>
      <div class="k-sub">Bugün <span data-live="todayEv">${kwh(M.todayEv)}</span></div>
    </div>
    <div class="kpi" data-go="ev">
      <div class="k-label">${icon('coin')}${AYLAR[M.mi]} faturası</div>
      <div class="k-val">${num(M.monthTl)}<small>TL</small></div>
      <div class="k-sub">${kwh(M.monthKwh, 0)} · ${num(M.priceNow, 2)} TL/kWh</div>
    </div>
    <div class="kpi" data-go="togg">
      <div class="k-label">${icon('bolt')}Togg ${M.y}</div>
      <div class="k-val">${num(M.evTl)}<small>TL</small></div>
      <div class="k-sub">${kwh(M.evYtd, 0)} · evin ${pct(M.evShare * 100)}'i</div>
    </div>
  </div>`;
}

export function chargeCard(M) {
  const s = M.activeSession;
  if (!s) return '';
  const min = (Date.now() / 1000 - s.start) / 60;
  const added = (s.kwh * M.car.efficiency) / M.car.battery_kwh * 100;
  return `
  <div class="card no-anim">
    <div class="charge">
      <div class="batt">${icon('battery')}</div>
      <div>
        <div class="t"><span class="pulse" style="display:inline-block;margin-right:6px"></span>Şarj ediliyor · ${esc(s.dev.name)}</div>
        <div class="v">${kwh(s.kwh, 2)} · ${tl(s.kwh * M.priceNow)}</div>
        <div class="s">${watt(M.evW)} · ${dur(min)} · bataryaya ≈ +${pct(added)}</div>
      </div>
    </div>
    <div class="progress"><i style="width:${Math.min(100, added)}%"></i></div>
  </div>`;
}

function insights(M) {
  const L = M.t.limit_kwh;
  const out = [];
  if (M.level === 'bad' && M.ytd <= L) {
    out.push(alertBox('danger', 'alert', 'Yıl sonu tahmini limiti aşıyor',
      `Tahmin ${kwh(M.proj, 0)}, limit ${kwh(L, 0)}. Kalan ${num(Math.max(0, L - M.ytd))} kWh'yi yıl sonuna yaymak için günde en çok <b>${kwh(M.butce, 1)}</b> harcamalısın (son 30 gün ort. ${kwh(M.son30 / 30 || 0, 1)}).`));
  } else if (M.level === 'mid') {
    out.push(alertBox('warn', 'alert', 'Limite yakınsın', `Tahmin ${kwh(M.proj, 0)} (limitin ${pct((M.proj / L) * 100)}'i). Günlük bütçe ${kwh(M.butce, 1)}.`));
  } else if (M.level === 'good') {
    out.push(alertBox('ok', 'shield', 'Limit güvende', `Tahmin ${kwh(M.proj, 0)}; yıl sonunda ${kwh(L - M.proj, 0)} pay kalıyor.`));
  }
  if (M.evYtd > 0 && M.proj > L && M.noEvProj <= L) {
    out.push(alertBox('info', 'car', 'Aşımın sebebi Togg şarjı',
      `Togg olmasa yıl sonu ≈ ${kwh(M.noEvProj, 0)} olurdu. Şarjın bir kısmını işyeri/halka açık istasyonlara kaydırmak limiti korur.`));
  }
  const s3500 = M.scenarios.find((s) => s.L === 3500);
  if (s3500?.sktt) {
    out.push(alertBox('warn', 'trend', `${M.y + 1} için dikkat`,
      `Limit 3.500'e inerse bu yılki tüketimin (≈ ${kwh(M.proj, 0)}) yüzünden 1 Ocak ${M.y + 1}'den itibaren son kaynak fiyatı uygulanır.`));
  }
  return out.join('');
}

function scenarios(M) {
  const max = Math.max(M.proj, 4000) * 1.05;
  const rows = M.scenarios.map((s) => `
    <div class="scen-row">
      <div class="L">${num(s.L)}<small>kWh limit${s.selected ? ' · seçili' : ''}</small></div>
      <div class="bar"><i style="width:${(Math.min(M.proj, max) / max) * 100}%;background:${s.sktt ? 'var(--bad)' : 'var(--good)'}"></i>
        <i style="left:${(s.L / max) * 100}%;width:2px;background:var(--text);border-radius:0"></i></div>
      <div class="r" style="color:${s.sktt ? 'var(--bad)' : 'var(--good)'}">${s.sktt ? `+${num(s.extra)} TL` : 'Normal'}<small>${s.sktt ? 'yıllık fark' : 'tarife'}</small></div>
    </div>`).join('');
  return `
  <div class="card">
    <h2>${M.y + 1} limiti senaryosu</h2>
    <p class="hint">Yeni limit önceki yılın tüketimine uygulanır. Bu yılı ≈ ${kwh(M.proj, 0)} ile kapatırsan (çizgi = limit):</p>
    <div class="scen">${rows}</div>
    <p class="chart-note">Fark, gelecek yıl da benzer tüketim varsayımıyla ${num(M.tNext.normal_tl, 2)} → ${num(M.tNext.sktt_tl, 2)} TL/kWh üzerinden hesaplandı. Fiyatları Ayarlar'dan güncelle.</p>
  </div>`;
}

export function renderPano(el, M, app) {
  el.innerHTML = `
    <div class="card hero" style="--hero-glow:${M.level === 'bad' ? 'rgba(255,77,106,.18)' : M.level === 'mid' ? 'rgba(255,176,32,.16)' : 'var(--glow1)'}">
      ${ring(M)}
      <div class="hero-meta">
        <span class="badge ${M.level}">${icon(M.level === 'good' ? 'shield' : 'alert')}${M.levelText}</span>
        <p>${heroText(M)}</p>
      </div>
      <div class="trio">
        <div><b>${num(Math.max(0, M.t.limit_kwh - M.ytd))}</b><span>kalan kWh</span></div>
        <div><b>${num(M.butce, 1)}</b><span>günlük bütçe</span></div>
        <div><b data-live="todayHome2">${num(M.todayHome, 1)}</b><span>bugün kWh</span></div>
      </div>
    </div>
    ${kpis(M)}
    <div data-slot="charge">${chargeCard(M)}</div>
    <div class="card"><h2>Durum</h2><p class="hint">Yıllık ${num(M.t.limit_kwh)} kWh son kaynak limitine göre.</p><div class="alerts">${insights(M)}</div></div>
    <div class="card">
      <div class="card-head"><h2>Son 30 gün</h2><span class="muted" style="font-size:12px;font-weight:700">kWh/gün</span></div>
      <div class="legend"><span><i style="background:var(--home)"></i>Ev (diğer)</span><span><i style="background:var(--ev)"></i>Togg</span><span><i style="background:var(--mid);height:2px"></i>Günlük bütçe</span></div>
      <div class="chart short" id="c30"></div>
    </div>
    ${scenarios(M)}`;

  el.querySelectorAll('[data-go]').forEach((k) => k.addEventListener('click', () => app.go(k.dataset.go)));

  if (M.home) {
    const c = colors();
    const homeD = M.lastN(M.home.id, 30);
    const evD = homeD.map(([k]) => M.evs.reduce((a, d) => a + Number(M.days(d.id)[k] || 0), 0));
    const other = homeD.map(([, v], i) => Math.max(0, v - evD[i]));
    const cats = homeD.map(([k]) => `${+k.slice(8)}.${+k.slice(5, 7)}`);
    const opt = stackedBars(c, cats, evD.map((v) => +v.toFixed(2)), other.map((v) => +v.toFixed(2)), {
      tip: (p) => `<b>${p[0].axisValue}</b><br>${p.map((x) => `${x.marker}${x.seriesName}: ${num(x.value, 1)} kWh`).join('<br>')}<br>Toplam: <b>${num(p.reduce((a, x) => a + x.value, 0), 1)} kWh</b>`,
    });
    opt.series[1].markLine = { symbol: 'none', silent: true, lineStyle: { color: c.mid, type: 'dashed', width: 1.5 }, label: { show: false }, data: [{ yAxis: +M.butce.toFixed(2) }] };
    mount(el.querySelector('#c30'), opt);
  }
}

// Canlı güncelleme: grafiklere dokunmadan yalnız sayılar
export function updatePano(el, M) {
  const set = (k, v) => { const n = el.querySelector(`[data-live="${k}"]`); if (n) n.textContent = v; };
  set('homeW', M.homeW == null ? '–' : watt(M.homeW));
  set('evW', M.evW > 50 ? watt(M.evW) : 'Boşta');
  set('todayHome', kwh(M.todayHome));
  set('todayHome2', num(M.todayHome, 1));
  set('todayEv', kwh(M.todayEv));
  el.querySelector('[data-live-cls="evKpi"]')?.classList.toggle('charging', M.evW > 50);
  const slot = el.querySelector('[data-slot="charge"]');
  if (slot) slot.innerHTML = chargeCard(M);
}
