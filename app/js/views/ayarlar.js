// Ayarlar: tarife, geçmiş faturalar, uyarılar, araç, kontrol anahtarı, görünüm, dışa aktarım
import { AY_K, downloadFile, esc, icon, num, toast } from '../ui.js';

let yearSel = null;
// "3,24" / "3.24" / "4.000" / "4000" hepsini doğru okur
const n = (v) => {
  let s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
};
const f = (v, d = 2) => (v == null ? '' : String(v).replace('.', ','));

export function renderAyarlar(el, M, app) {
  const yr = yearSel ?? M.y;
  const T = M.S.tariff?.[yr] || {};
  const bills = M.S.bills?.[yr] || {};
  const car = M.car;
  const esik = (M.S.alerts?.esikler || [70, 85, 95]).join(', ');
  const st = app.store;
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Tarife</h2>
        <div class="seg" id="ys">${[M.y, M.y + 1].map((y) => `<button data-y="${y}" class="${y === yr ? 'on' : ''}">${y}</button>`).join('')}</div></div>
      <p class="hint">Faturandaki <b>vergiler dahil</b> birim fiyatları gir. Varsayılanlar yaklaşık değerdir.</p>
      <div class="field"><div><label for="lim">Yıllık limit (kWh)</label><small>2026: 4.000. ${M.y + 1} için EPDK kararı bekleniyor (3.000–3.500 konuşuluyor).</small></div><input class="input num" id="lim" inputmode="numeric" value="${T.limit_kwh ?? (yr === M.y ? 4000 : '')}" placeholder="${M.t.limit_kwh}"></div>
      <div class="field"><div><label for="nt">Normal fiyat (TL/kWh)</label></div><input class="input num" id="nt" inputmode="decimal" value="${f(T.normal_tl)}" placeholder="${f(3.24)}"></div>
      <div class="field"><div><label for="st">Son kaynak fiyatı (TL/kWh)</label><small>Limit aşılınca uygulanan fiyat.</small></div><input class="input num" id="st" inputmode="decimal" value="${f(T.sktt_tl)}" placeholder="${f(6.49)}"></div>
      <div class="field"><div><label for="ky">Aylık kademe (kWh)</label><small>Aylık kademe uygulanıyorsa sınır; yoksa boş bırak.</small></div><input class="input num" id="ky" inputmode="numeric" value="${T.kademe_kwh_ay || ''}" placeholder="yok"></div>
      <div class="field"><div><label for="k2">Kademe üstü fiyat</label></div><input class="input num" id="k2" inputmode="decimal" value="${f(T.kademe2_tl || '')}" placeholder="–"></div>
      ${yr === M.y ? `<div class="field"><div><label for="py">${M.y - 1} toplam tüketimi (kWh)</label><small>Bu yılın limitini aştıysa bütün yıl son kaynak fiyatı uygulanır. e-Devlet / fatura.</small></div><input class="input num" id="py" inputmode="numeric" value="${T.onceki_yil_kwh ?? ''}" placeholder="kWh"></div>` : ''}
      <button class="btn primary" id="saveT" style="margin-top:12px">${icon('check')}Tarifeyi kaydet</button>
    </div>

    <div class="card">
      <h2>${yr} faturaları (kWh)</h2>
      <p class="hint">Şalter takılmadan önceki aylar için faturadaki tüketimi gir. Her ay için fatura ile ölçümden büyük olan kullanılır.</p>
      <div class="bills">${AY_K.map((a, i) => { const k = String(i + 1).padStart(2, '0'); return `<label>${a}<input class="input" data-m="${k}" inputmode="numeric" value="${bills[k] ?? ''}" placeholder="–"></label>`; }).join('')}</div>
      <button class="btn ghost" id="saveB" style="margin-top:12px">${icon('check')}Faturaları kaydet</button>
    </div>

    <div class="card">
      <h2>Araç</h2>
      <div class="field"><div><label for="bk">Batarya (kWh)</label><small>T10X Uzun Menzil 88,5 · Standart 52,4</small></div><input class="input num" id="bk" inputmode="decimal" value="${f(car.battery_kwh)}"></div>
      <div class="field"><div><label for="ef">Şarj verimi (%)</label><small>Duvardan çekilenin bataryaya giden payı (Mode-2 AC ≈ %88–92).</small></div><input class="input num" id="ef" inputmode="numeric" value="${Math.round(car.efficiency * 100)}"></div>
      <div class="field"><div><label for="pt">İstasyon fiyatı (TL/kWh)</label><small>Togg sekmesindeki kıyas için.</small></div><input class="input num" id="pt" inputmode="decimal" value="${f(car.public_tl)}"></div>
      <button class="btn ghost" id="saveC" style="margin-top:12px">${icon('check')}Kaydet</button>
    </div>

    <div class="card">
      <h2>Bildirimler</h2>
      <p class="hint">Pi, limit eşiklerinde, şarj başlayıp bitince ve uzun süre yüksek akımda <b>ntfy</b> ile telefona bildirim gönderir.</p>
      <div class="field"><div><label for="es">Limit eşikleri (%)</label></div><input class="input" id="es" value="${esc(esik)}" style="width:130px;text-align:right"></div>
      ${M.raw.status?.ntfy ? `<div class="field"><div><label>ntfy konusu</label><small>ntfy uygulamasında bu konuya abone ol.</small></div><a class="btn ghost sm" href="https://ntfy.sh/${encodeURIComponent(M.raw.status.ntfy)}" target="_blank" rel="noopener">${esc(M.raw.status.ntfy)}</a></div>` : ''}
      <button class="btn ghost" id="saveA" style="margin-top:12px">${icon('check')}Kaydet</button>
    </div>

    <div class="card">
      <h2>Uzaktan kontrol</h2>
      <p class="hint">Priz açma/kapama ve sarıcı komutları bu anahtarla imzalanır. Pi'deki <b>config.json → control_secret</b> ile aynı olmalı. Yalnız bu telefonda saklanır.</p>
      <div class="field"><div><label for="key">Kontrol anahtarı</label><small>${st.key ? 'Kayıtlı' : 'Girilmemiş'}</small></div><input class="input" id="key" type="password" autocomplete="off" placeholder="${st.key ? '••••••••' : 'anahtar'}" style="width:150px"></div>
      <button class="btn ghost" id="saveK" style="margin-top:12px">${icon('key')}Anahtarı kaydet</button>
    </div>

    <div class="card">
      <h2>Uygulama</h2>
      <div class="field"><div><label>Tema</label></div><div class="seg" id="th">${[['dark', 'Koyu'], ['light', 'Açık']].map(([k, t]) => `<button data-t="${k}" class="${document.documentElement.dataset.theme === k ? 'on' : ''}">${t}</button>`).join('')}</div></div>
      <div class="field"><div><label>Demo veri</label><small>Gerçek veri yerine örnek veriyle göster.</small></div><button class="switch ${st.forcedDemo ? 'on' : ''}" id="demo"></button></div>
      <div class="field"><div><label>Veri kaynağı</label><small>${st.mode === 'live' ? 'Canlı · ' : st.mode === 'demo' ? 'Örnek veri · ' : ''}${M.raw.status?.ts ? 'Pi son yazım ' + new Date(M.raw.status.ts * 1000).toLocaleString('tr-TR') : ''}</small></div><span></span></div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn ghost" id="csvD">${icon('download')}Günlük CSV</button>
        <button class="btn ghost" id="csvS">${icon('download')}Şarj CSV</button>
      </div>
    </div>
    <p class="chart-note" style="text-align:center">Ev Enerji · Togg T10X ve ev tüketimi</p>`;

  const $ = (s) => el.querySelector(s);
  const save = async (path, val, msg = 'Kaydedildi') => { try { await st.put(path, val); toast(msg); } catch { toast('Kaydedilemedi (bağlantı?)'); } };

  $('#ys').onclick = (e) => { const b = e.target.closest('[data-y]'); if (b) { yearSel = +b.dataset.y; app.refresh(); } };
  $('#saveT').onclick = () => {
    const v = { limit_kwh: n($('#lim').value), normal_tl: n($('#nt').value), sktt_tl: n($('#st').value), kademe_kwh_ay: n($('#ky').value), kademe2_tl: n($('#k2').value) };
    if ($('#py')) v.onceki_yil_kwh = n($('#py').value);
    Object.keys(v).forEach((k) => v[k] == null && delete v[k]);
    save(`settings/tariff/${yr}`, v, 'Tarife kaydedildi');
  };
  $('#saveB').onclick = () => {
    const b = {};
    el.querySelectorAll('[data-m]').forEach((i) => { const x = n(i.value); if (x != null) b[i.dataset.m] = x; });
    save(`settings/bills/${yr}`, Object.keys(b).length ? b : null, 'Faturalar kaydedildi');
  };
  $('#saveC').onclick = () => save('settings/car', {
    battery_kwh: n($('#bk').value) || 88.5, efficiency: Math.min(1, (n($('#ef').value) || 90) / 100), public_tl: n($('#pt').value) || 9,
  });
  $('#saveA').onclick = () => {
    const arr = $('#es').value.split(/[,\s]+/).map(Number).filter((x) => x > 0 && x < 100).sort((a, b) => a - b);
    save('settings/alerts', { esikler: arr.length ? arr : [70, 85, 95] });
  };
  $('#saveK').onclick = () => { const k = $('#key').value.trim(); if (!k) return toast('Anahtar boş'); st.setKey(k); toast('Anahtar bu telefona kaydedildi'); app.refresh(); };
  $('#th').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) app.setTheme(b.dataset.t); };
  $('#demo').onclick = () => st.setForcedDemo(!st.forcedDemo);
  $('#csvD').onclick = () => {
    const rows = [['tarih', 'ev_kwh', 'togg_kwh']];
    const keys = new Set(Object.keys(M.home ? M.days(M.home.id) : {}));
    M.evs.forEach((d) => Object.keys(M.days(d.id)).forEach((k) => keys.add(k)));
    [...keys].sort().forEach((k) => rows.push([k, num(M.home ? M.days(M.home.id)[k] || 0 : 0, 3), num(M.evs.reduce((a, d) => a + (M.days(d.id)[k] || 0), 0), 3)]));
    downloadFile(`ev-enerji-gunluk-${M.today}.csv`, rows.map((r) => r.join(';')).join('\n'));
  };
  $('#csvS').onclick = () => {
    const rows = [['baslangic', 'bitis', 'kwh', 'tl', 'tepe_w', 'km']];
    M.sessions.forEach((s) => rows.push([new Date(s.start * 1000).toLocaleString('tr-TR'), s.end ? new Date(s.end * 1000).toLocaleString('tr-TR') : '', num(s.kwh, 3), num(s.tl ?? s.kwh * M.priceNow, 2), s.peak_w ?? '', s.odo ?? '']));
    downloadFile(`togg-sarj-${M.today}.csv`, rows.map((r) => r.join(';')).join('\n'));
  };
}
