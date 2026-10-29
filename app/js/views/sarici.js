// Kablo sarıcı: durum, sar/aç/durdur, şarjla kilit kuralı
import { ago, alertBox, icon, toast } from '../ui.js';

const STATES = {
  sarili: { t: 'Kablo sarılı', cls: 'good', ic: 'lock' },
  acik: { t: 'Kablo açık', cls: 'mid', ic: 'plug' },
  sariyor: { t: 'Sarılıyor…', cls: 'mid', ic: 'up' },
  aciliyor: { t: 'Açılıyor…', cls: 'mid', ic: 'downArrow' },
  hata: { t: 'Hata', cls: 'bad', ic: 'alert' },
};

function reel(state) {
  const spin = state === 'sariyor' ? 'go' : state === 'aciliyor' ? 'rev' : '';
  const wound = state === 'sarili' ? 1 : state === 'acik' ? 0.15 : 0.55;
  const rings = Array.from({ length: 6 }, (_, i) => 34 + i * 8).filter((_, i) => i < Math.round(6 * wound) || i === 0);
  const hang = state === 'acik' || state === 'aciliyor';
  return `
  <svg viewBox="0 0 210 210" aria-hidden="true">
    <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent2)"/><stop offset="1" stop-color="var(--accent)"/></linearGradient></defs>
    <circle cx="105" cy="105" r="92" fill="var(--card-hi)" stroke="var(--line)" stroke-width="2"/>
    <g class="reel-spin ${spin}">
      ${rings.map((r) => `<circle cx="105" cy="105" r="${r}" fill="none" stroke="#1a1d24" stroke-width="7.5"/><circle cx="105" cy="105" r="${r}" fill="none" stroke="#2c313b" stroke-width="1.2" stroke-dasharray="3 5"/>`).join('')}
      <circle cx="105" cy="105" r="80" fill="none" stroke="url(#rg)" stroke-width="5"/>
      <circle cx="105" cy="105" r="22" fill="var(--card-solid)" stroke="url(#rg)" stroke-width="4"/>
      ${[0, 60, 120, 180, 240, 300].map((a) => `<line x1="105" y1="105" x2="${105 + 78 * Math.cos((a * Math.PI) / 180)}" y2="${105 + 78 * Math.sin((a * Math.PI) / 180)}" stroke="url(#rg)" stroke-width="3" opacity=".55"/>`).join('')}
      <circle cx="105" cy="105" r="6" fill="var(--accent)"/>
    </g>
    ${hang ? '<path d="M105 160 C 105 182, 112 196, 128 206" fill="none" stroke="#1a1d24" stroke-width="7.5" stroke-linecap="round"/>' : ''}
  </svg>`;
}

export function renderSarici(el, M, app) {
  const w = M.winder;
  const online = w?.online && (!w.ts || Date.now() / 1000 - w.ts < 300);
  const st = STATES[w?.state] || { t: 'Bağlı değil', cls: 'mid', ic: 'wifi' };
  const charging = M.evW > 50;
  const moving = ['sariyor', 'aciliyor'].includes(w?.state);
  el.innerHTML = `
    <div class="card hero">
      <div class="reel-stage">${reel(online ? w.state : 'sarili')}</div>
      <div class="state-pill"><span class="badge ${online ? st.cls : 'mid'}">${icon(online ? st.ic : 'wifi')}${online ? st.t : 'Henüz bağlı değil'}</span>
        ${online ? `<div class="muted" style="font-size:12px;margin-top:6px;font-weight:600">${w.turns != null ? `${w.turns} tur sarılı · ` : ''}park kilidi ${w.lock ? 'kapalı' : 'açık'}${w.ts ? ' · ' + ago(w.ts) : ''}</div>` : ''}</div>
      <div class="btn-grid" style="position:relative;z-index:1">
        <button class="btn ghost" data-a="ac" ${!online || charging || moving || w.state === 'acik' ? 'disabled' : ''}>${icon('downArrow')}Aç</button>
        <button class="btn danger" data-a="dur" ${!online || !moving ? 'disabled' : ''}>${icon('stop')}Durdur</button>
        <button class="btn primary" data-a="sar" ${!online || charging || moving || w.state === 'sarili' ? 'disabled' : ''}>${icon('up')}Sar</button>
      </div>
    </div>
    <div class="card">
      <h2>Güvenlik kuralları</h2>
      <div class="alerts">
        ${alertBox(charging ? 'warn' : 'ok', 'bolt', charging ? 'Şarj sürüyor' : 'Şarj yok', charging ? 'Şarj bitmeden sarıcı çalışmaz.' : 'Sarıcı komut alabilir.')}
        ${alertBox('info', 'lock', 'Sarılıyken şarj açılmaz', 'Kablo sarılı ya da hareket halindeyken Togg prizi uzaktan açılamaz.')}
        ${alertBox('info', 'bell', 'Şarj bitince', 'Pi "şarj bitti" bildirimi gönderir; kablo açıksa buradan tek dokunuşla sarabilirsin.')}
      </div>
    </div>
    ${online ? `<div class="card"><h2>Bakım</h2><p class="hint">İlk kurulumda ve dişli/tambur değişince park turunu yeniden ölçer.</p>
      <button class="btn ghost" data-a="kalibre" ${charging || moving ? 'disabled' : ''}>${icon('reel')}Kalibrasyon sarımı</button></div>` : `
    <div class="card"><h2>Bağlantı</h2><p class="hint">Motorlu sarıcının ESP32-S3 kartı Wi-Fi'ye bağlanınca durumunu buraya yazar:
      <b>winder/state</b> (durum, tur, kilit) ve komutları <b>winder/cmd</b>'den okur. Elektronik aşaması bitince otomatik görünür.</p></div>`}`;

  el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const r = await app.store.command('sarici', b.dataset.a);
      toast(r.msg || (r.ok ? 'Gönderildi' : 'Başarısız'));
      if (r.needKey) app.go('ayarlar');
    } catch { toast('Komut gönderilemedi'); }
    app.refresh();
  }));
}
