// Ana pano: yıllık limit halkası, canlı güç, şarj durumu, uyarılar, 30 gün, gelecek yıl senaryosu
import { colors, mount, stackedBars } from '../charts.js';
import { AYLAR, alertBox, ayDa, ayDan, dur, esc, icon, kwh, num, pct, tl, watt } from '../ui.js';

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
      <circle cx="118" cy="118" r="${R}" fill="none" stroke="var(--card-hi)" stroke-width="16" stroke-dasharray="${ARC} ${C}" stroke-linecap="butt"/>
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
  const parts = [`Günde ≈ ${kwh(M.rate, 1)} hızla yıl sonu <b>≈ ${kwh(M.proj, 0)}</b>.`];
  if (M.ytdEst) parts.push(`(Son okuma ${M.covEnd.toLocaleDateString('tr-TR')}; sonrası tahmin.)`);
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
  <div class="kpis kpis-c">
    <div class="kpi" data-go="ev">
      <div class="k-label">${icon('home')}Ev şu an</div>
      <div class="k-val" data-live="homeW">${M.home ? (M.homeW == null ? '–' : watt(M.homeW)) : '–'}</div>
      <div class="k-sub">${M.home ? `Bugün <span data-live="todayHome">${kwh(M.todayHome)}</span>` : 'Şalter bağlanınca canlı'}</div>
    </div>
    <div class="kpi ${charging ? 'charging' : ''}" data-go="togg" data-live-cls="evKpi">
      <div class="k-label">${charging ? '<span class="pulse"></span>' : icon('car')}Togg</div>
      <div class="k-val" data-live="evW">${charging ? watt(M.evW) : 'Boşta'}</div>
      <div class="k-sub">Bugün <span data-live="todayEv">${kwh(M.todayEv)}</span></div>
    </div>
    <div class="kpi" data-go="ev">
      <div class="k-label">${icon('coin')}${AYLAR[M.mi]} (tahmini)</div>
      <div class="k-val">${num(M.monthTl)}<small>₺</small></div>
      <div class="k-sub">≈ ${kwh(M.monthKwh, 0)} · son kWh ${num(M.priceNow, 2)} ₺</div>
    </div>
    <div class="kpi" data-go="togg">
      <div class="k-label">${icon('bolt')}Togg ${M.y}</div>
      <div class="k-val">${num(M.evTl)}<small>₺</small></div>
      <div class="k-sub">${kwh(M.evYtd, 0)} · ort. ${num(M.evAvgTl, 2)} ₺/kWh</div>
    </div>
  </div>`;
}

export function chargeCard(M) {
  const s = M.activeSession;
  if (!s) return '';
  const min = (Date.now() / 1000 - s.start) / 60;
  const km = s.km ? ` · +${num(s.km)} km` : '';
  const known = s.socNow != null;
  // Yüzde biliniyorsa: tahmini şarj durumu ve hedefe kalan süre; bilinmiyorsa girme düğmesi
  const socLine = known
    ? `<div class="soc-line"><b>≈ %${num(s.socNow)}</b>${s.socNow >= s.target - 0.5 ? ` · Hedef %${num(s.target)} · Araç Doldu` : s.etaMin != null ? ` · Hedef %${num(s.target)} · ≈ ${dur(s.etaMin)} Kaldı` : ` · Hedef %${num(s.target)}`}
        <button class="soc-edit" data-soc aria-label="Şarj yüzdesini düzelt">${icon('edit')}</button></div>`
    : `<button class="soc-ask" data-soc>${icon('plus')}Araçta Şu An Kaç %? Gir, Kalan Süreyi Hesaplayayım</button>`;
  const bar = known
    ? `<div class="progress soc"><i class="base" style="width:${Math.min(100, s.socStart)}%"></i><i style="width:${Math.max(0, Math.min(100, s.socNow) - Math.min(100, s.socStart))}%"></i>
        <span class="tgt" style="left:${Math.min(100, s.target)}%"></span></div>`
    : `<div class="progress"><i style="width:${Math.min(100, s.added)}%"></i></div>`;
  return `
  <div class="card no-anim">
    <div class="charge">
      <div class="car-wrap"><img class="car-img" src="img/t10x.webp" alt="Togg T10X" width="120" height="63"><span class="plug-dot"></span></div>
      <div>
        <div class="t"><span class="pulse" style="display:inline-block;margin-right:6px"></span>Şarj Ediliyor · ${esc(s.dev.name)}</div>
        <div class="v">${kwh(s.kwh, 2)} · ${tl(s.kwh * M.priceNow)}</div>
        <div class="s">${watt(M.evW)} · ${dur(min)} · Bataryaya ≈ +${pct(s.added)}${km}</div>
      </div>
    </div>
    ${socLine}
    ${bar}
  </div>`;
}

function insights(M) {
  const L = M.t.limit_kwh;
  const out = [];
  if (M.level === 'bad' && M.ytd <= L) {
    out.push(alertBox('danger', 'alert', 'Yıl sonu tahmini limiti aşıyor',
      `Tahmin ${kwh(M.proj, 0)}, limit ${kwh(L, 0)}. Kalan ${num(Math.max(0, L - M.ytd))} kWh'yi yıl sonuna yaymak için günde en çok <b>${kwh(M.butce, 1)}</b> harcamalısın (şu anki hız ${kwh(M.rate, 1)}/gün).`));
  } else if (M.level === 'mid') {
    out.push(alertBox('warn', 'alert', 'Limite yakınsın', `Tahmin ${kwh(M.proj, 0)} (limitin ${pct((M.proj / L) * 100)}'i). Günlük bütçe ${kwh(M.butce, 1)}.`));
  } else if (M.level === 'good') {
    out.push(alertBox('ok', 'shield', 'Limit güvende', `Tahmin ${kwh(M.proj, 0)}; yıl sonunda ${kwh(L - M.proj, 0)} pay kalıyor.`));
  }
  if (M.evYtd > 0 && M.proj > L && M.noEvProj <= L) {
    out.push(alertBox('info', 'car', 'Aşımın sebebi Togg şarjı',
      `Togg olmasa yıl sonu ≈ ${kwh(M.noEvProj, 0)} olurdu. Şarjın bir kısmını işyeri/halka açık istasyonlara kaydırmak limiti korur.`));
  }
  if (M.kademeAylari.length && M.evYtd > 0) {
    const i = M.kademeAylari.at(-1);
    const h = M.homeMonths[i], e = M.evMonths[i], k = M.t.kademe_kwh_ay;
    out.push(alertBox('warn', 'car', 'Togg evi pahalı kademeye taşıyor',
      `${ayDa(i)} Togg olmadan ev ≈ ${kwh(h - e, 0)} ile ucuz kademede (${num(k)} kWh'ye kadar ${num(M.t.normal_tl, 2)} ₺) kalırdı. Togg'la ${kwh(h, 0)} oldu; ${kwh(h - k, 0)} ${num(M.t.kademe2_tl, 2)} ₺'den faturalandı. Bu yüzden Togg'un kWh'si sana ortalama <b>${num(M.evAvgTl, 2)} ₺</b>'ye geliyor.`));
  }
  // Gelecek yıl: tam yıl tüketim bu hızla limiti aşıyor mu?
  const sel = M.scenarios[0];
  if (sel?.fromJan) {
    out.push(alertBox('danger', 'trend', `${M.y + 1} son kaynak tarifesiyle başlar`,
      `${M.y + 1} limiti ${num(sel.L)} kWh; bu yılki ≈ ${kwh(M.proj, 0)} tüketim yüzünden 1 Ocak'tan itibaren son kaynak fiyatı uygulanır.`));
  } else if (sel?.exceedNext) {
    out.push(alertBox('warn', 'trend', `${M.y + 1}'de limit aşılır`,
      `${M.y} güvende, ama bu hızla (günde ≈ ${kwh(M.rate, 1)}) ${M.y + 1}'de yıllık ≈ <b>${kwh(M.nextYear, 0)}</b> tüketirsin. ${num(sel.L)} kWh limiti <b>${ayDa(sel.exceedNext - 1)}</b> aşılır${sel.fromMonth ? `, son kaynak fiyatı <b>${ayDan(sel.fromMonth - 1)}</b> başlar` : ''} ve ${M.y + 2} yılının tamamı son kaynak tarifesinden faturalanır.`));
  }
  return out.join('');
}

function scenarios(M) {
  const max = Math.max(M.nextYear, M.proj, ...M.scenarios.map((s) => s.L)) * 1.05;
  const status = (s) => {
    if (s.fromJan) return { c: 'var(--bad)', t: 'Ocak\'tan SKTT', sub: `+${num(s.extra)} ₺` };
    if (s.fromMonth) return { c: 'var(--bad)', t: `${ayDan(s.fromMonth - 1)} SKTT`, sub: `+${num(s.extra)} ₺ · ${M.y + 2} tamamı` };
    if (s.exceedNext) return { c: 'var(--mid)', t: `${ayDa(s.exceedNext - 1)} aşılır`, sub: `${M.y + 2} SKTT` };
    return { c: 'var(--good)', t: 'Normal', sub: 'tarife' };
  };
  const rows = M.scenarios.map((s) => {
    const st = status(s);
    return `
    <div class="scen-row">
      <div class="L">${num(s.L)}<small>kWh limit</small></div>
      <div class="bar"><i style="width:${(Math.min(M.nextYear, max) / max) * 100}%;background:${st.c}"></i>
        <i style="left:${(s.L / max) * 100}%;width:2px;background:var(--text);border-radius:0"></i></div>
      <div class="r" style="color:${st.c}">${st.t}<small>${st.sub}</small></div>
    </div>`;
  }).join('');
  return `
  <div class="card">
    <h2>${M.y + 1} limiti: ${num(M.tNext.limit_kwh)} kWh</h2>
    <p class="hint">Bu hızla ${M.y + 1}'de yıllık ≈ <b>${kwh(M.nextYear, 0)}</b> (çubuk) tüketirsin; dikey çizgi limit. ${M.y} toplamı ≈ ${kwh(M.proj, 0)}.</p>
    <div class="scen">${rows}</div>
    <p class="chart-note">Limit aşılırsa aşılan ayı izleyen 3. aydan itibaren son kaynak fiyatı (tahmini ${num(M.tNext.sktt_tl, 2)} ₺/kWh) uygulanır ve ertesi yıl tamamen son kaynaktan faturalanır. Mevsim etkisi hesaba katılmadı.</p>
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
        <div><b>${num(Math.max(0, M.t.limit_kwh - M.ytd))}<small> kWh</small></b><span>Limitten Kalan</span></div>
        <div><b>${num(M.butce, 1)}<small> kWh</small></b><span>Günlük Bütçe<br>≈ ${tl(M.butce * M.priceNow, 0)} karşılığı</span></div>
        ${M.home ? `<div><b><span data-live="todayHome2">${num(M.todayHome, 1)}</span><small> kWh</small></b><span>Bugün</span></div>` : `<div><b>${num(M.rate, 1)}<small> kWh</small></b><span>Günlük Ort. Tüketim</span></div>`}
      </div>
    </div>
    ${kpis(M)}
    <div data-slot="charge">${chargeCard(M)}</div>
    <div class="card"><h2>Durum</h2><p class="hint">Yıllık ${num(M.t.limit_kwh)} kWh son kaynak limitine göre.</p><div class="alerts">${insights(M)}</div></div>
    ${M.home ? '' : '<!--'}<div class="card">
      <div class="card-head"><h2>Son 30 gün</h2><span class="muted" style="font-size:12px;font-weight:700">kWh/gün</span></div>
      <div class="legend"><span><i style="background:var(--home)"></i>Ev (diğer)</span><span><i style="background:var(--ev)"></i>Togg</span><span><i style="background:var(--mid);height:2px"></i>Günlük bütçe</span></div>
      <div class="chart short" id="c30"></div>
    </div>${M.home ? '' : '-->'}
    ${scenarios(M)}`;

  el.querySelectorAll('[data-go]').forEach((k) => k.addEventListener('click', () => app.go(k.dataset.go)));

  if (M.home) {
    const c = colors();
    const homeD = M.lastN(M.home.id, 30);
    const evD = homeD.map(([k]) => M.evDay(k));
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
