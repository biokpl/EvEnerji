// Kablo çekici (ESP32-C3, Kablo Sarıcı projesi): durum, indir/topla/dur, ince ayar, şarjla kilit kuralı.
// Cihaz winder/state yazar ({online, state, d, t, mm, inis, bilinir, hata, ts}); komutlar Pi'ye imzalı gider,
// Pi şarj kilidini denetleyip winder/cmd'ye yazar.
import { ago, alertBox, esc, icon, num, toast } from '../ui.js';

const STATES = {
  sarili: { t: 'Park: soket yuvada', cls: 'good', ic: 'lock' },
  acik: { t: 'Kablo aşağıda', cls: 'mid', ic: 'plug' },
  sariyor: { t: 'Toplanıyor…', cls: 'mid', ic: 'up' },
  aciliyor: { t: 'İniyor…', cls: 'mid', ic: 'downArrow' },
  durdu: { t: 'Durduruldu', cls: 'mid', ic: 'stop' },
  bilinmiyor: { t: 'Konum bilinmiyor: önce Topla', cls: 'mid', ic: 'alert' },
  hata: { t: 'Hata', cls: 'bad', ic: 'alert' },
};
const MOVING = ['sariyor', 'aciliyor'];

// Type 2 (Mennekes) şarj fişi: siyah gövde, mavi ayrıntılar. Yerel eksende kablo soldan girer,
// ağız sağda. Fiş aşağı bakacak şekilde (rotate 90) kullanılır; ağız yüzü alttan hafif görünen bir elips,
// pimler ekranda doğru yönde (üstte 2 sinyal, altta 5 güç pimi) dursun diye yüz eksenleri buna göre yerleşir.
function plug(x, y, angle) {
  // Type 2 yüzü: üstte 2 küçük sinyal pimi, altta 5 güç pimi (yüz ekseninde: u yatay, v dikey)
  const pins = [[-4.5, -7, 1.4], [4.5, -7, 1.4], [-7.5, 0, 2.2], [0, 0, 2.2], [7.5, 0, 2.2], [-4.2, 7.2, 2.2], [4.2, 7.2, 2.2]];
  const fx = 84, k = 0.42;          // yüz merkezi ve perspektif (yüz elipsin yatay daralması)
  return `
  <g transform="translate(${x} ${y}) rotate(${angle})">
    <path d="M-2 -3.6 L12 -6.5 L12 6.5 L-2 3.6 Z" fill="#1e6fd9"/>
    <path d="M12 -8 Q12 -11 15 -11 L50 -11 Q56 -11 58 -14 L64 -14 L64 14 L58 14 Q56 11 50 11 L33 11 Q30 19 23 19 Q17 19 16 11 L15 11 Q12 11 12 8 Z" fill="#14161b" stroke="#2a2f38" stroke-width="1"/>
    <path d="M20 -11 L44 -11" stroke="#1e6fd9" stroke-width="3" stroke-linecap="round"/>
    <text x="36" y="3.4" text-anchor="middle" font-family="Manrope, Arial, sans-serif" font-weight="800" font-size="6.2" fill="#3b8cf0" letter-spacing=".3">MENNEKES</text>
    <path d="M64 -16 L${fx} -16 L${fx} 16 L64 16 Z" fill="#101216"/>
    <path d="M64 -16 L${fx} -16" stroke="#2a2f38" stroke-width="1"/>
    <rect x="62" y="-17.5" width="5" height="35" rx="2" fill="#1e6fd9"/>
    <ellipse cx="${fx}" cy="0" rx="${16 * k + 1.6}" ry="17.6" fill="#1e6fd9"/>
    <ellipse cx="${fx}" cy="0" rx="${16 * k}" ry="16" fill="#0b0d11"/>
    <path d="M${fx - 11 * k} -12 L${fx - 11 * k} 12" stroke="#1e6fd9" stroke-width="1.2"/>
    ${pins.map(([u, v, r]) => `<ellipse cx="${fx + (v + 1) * k}" cy="${-u}" rx="${r * k + 0.3}" ry="${r}" fill="#c9d3e0" stroke="#5b6573" stroke-width=".5"/>`).join('')}
  </g>`;
}

function reel(state) {
  const spin = state === 'sariyor' ? 'go' : state === 'aciliyor' ? 'rev' : '';
  const wound = state === 'sarili' ? 1 : state === 'acik' ? 0.15 : 0.55;
  const rings = Array.from({ length: 6 }, (_, i) => 34 + i * 8).filter((_, i) => i < Math.round(6 * wound) || i === 0);
  const hang = state === 'acik' || state === 'aciliyor';
  const rOut = rings[rings.length - 1];
  // Kablonun ucu ve fiş (ağzı aşağı): sarılıyken kablo makaranın üstünden çıkıp sağda asılı fişe iner,
  // açıkken makaranın altında sarkar
  const tail = hang
    ? `<path d="M105 ${105 + rOut} C 104 170, 128 178, 132 214" fill="none" stroke="var(--cable)" stroke-width="7.5" stroke-linecap="round"/>${plug(132, 214, 90)}`
    : (() => {
        // Fiş dik asılı (ağzı aşağı).
        // Kablonun son kontrol noktası fiş ekseni üzerinde: kablo fişe kırılmadan, eksenine teğet girer.
        const px = 220, py = 132, a = (90 * Math.PI) / 180, L = 58;
        const c2x = px - Math.cos(a) * L, c2y = py - Math.sin(a) * L;
        return `<path d="M105 ${105 - rOut} C 190 ${100 - rOut}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${px} ${py}" fill="none" stroke="var(--cable)" stroke-width="7.5" stroke-linecap="round"/>${plug(px, py, 90)}`;
      })();
  return `
  <svg viewBox="-6 -4 268 312" aria-hidden="true" style="--cable:#7cc8f5;--cable-hi:#c4e6fb">
    <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent2)"/><stop offset="1" stop-color="var(--accent)"/></linearGradient></defs>
    <circle cx="105" cy="105" r="92" fill="var(--card-hi)" stroke="var(--line)" stroke-width="2"/>
    <g class="reel-spin ${spin}">
      ${rings.map((r) => `<circle cx="105" cy="105" r="${r}" fill="none" stroke="var(--cable)" stroke-width="7.5"/><circle cx="105" cy="105" r="${r}" fill="none" stroke="var(--cable-hi)" stroke-width="1.2" stroke-dasharray="3 5" opacity=".8"/>`).join('')}
      <circle cx="105" cy="105" r="80" fill="none" stroke="url(#rg)" stroke-width="5"/>
      <circle cx="105" cy="105" r="22" fill="var(--card-solid)" stroke="url(#rg)" stroke-width="4"/>
      ${[0, 60, 120, 180, 240, 300].map((a) => `<line x1="105" y1="105" x2="${105 + 78 * Math.cos((a * Math.PI) / 180)}" y2="${105 + 78 * Math.sin((a * Math.PI) / 180)}" stroke="url(#rg)" stroke-width="3" opacity=".55"/>`).join('')}
      <circle cx="105" cy="105" r="6" fill="var(--accent)"/>
    </g>
    ${tail}
  </svg>`;
}
export { reel };

const isOnline = (w) => !!(w?.online && w.ts > 1.7e9 && Date.now() / 1000 - w.ts < 300);
const metre = (w) => Math.max(0, w?.mm || 0) / 1000;
const inisM = (w) => (w?.inis || 0) / 1000;
const doluluk = (w) => (w.bilinir && inisM(w) ? Math.min(100, (metre(w) / inisM(w)) * 100) : 0);
// Bu imza değişmedikçe ekran yeniden çizilmez; yalnız metre/çubuk/zaman güncellenir
const sig = (M) => { const w = M.winder; return JSON.stringify([isOnline(w), w?.state, w?.hata, w?.bilinir, M.evW > 50]); };
let drawn = '';

function infoLine(w) {
  return `${w.bilinir ? `${num(metre(w), 2)} m aşağıda` : 'konum bilinmiyor'} · iniş ${num(inisM(w), 2)} m · ${ago(w.ts)}`;
}

export function renderSarici(el, M, app) {
  const w = M.winder || {};
  const online = isOnline(w);
  const st = STATES[w.state] || { t: w.t || 'Bilinmiyor', cls: 'mid', ic: 'reel' };
  const charging = M.evW > 50;
  const moving = online && MOVING.includes(w.state);
  const offMove = !online || charging || moving;
  drawn = sig(M);
  el.innerHTML = `
    <div class="card hero">
      <div class="reel-stage">${reel(online ? w.state : 'sarili')}</div>
      <div class="state-pill"><span class="badge ${online ? st.cls : 'mid'}">${icon(online ? st.ic : 'wifi')}${online ? st.t : 'Bağlı değil'}</span>
        ${online ? `<div class="muted" id="kc-bilgi" style="font-size:12px;margin-top:6px;font-weight:600">${infoLine(w)}</div>
        <div class="progress" style="max-width:260px;margin:10px auto 0"><i id="kc-cubuk" style="width:${doluluk(w)}%"></i></div>` : ''}</div>
      ${online && w.hata ? `<div style="position:relative;z-index:1;margin-top:12px">${alertBox('warn', 'alert', 'Hata', esc(w.hata))}</div>` : ''}
      <div class="btn-grid" style="position:relative;z-index:1;margin-top:14px">
        <button class="btn ghost" data-a="indir" ${offMove || w.state === 'acik' ? 'disabled' : ''}>${icon('downArrow')}İndir</button>
        <button class="btn danger" data-a="dur" ${!moving ? 'disabled' : ''}>${icon('stop')}Dur</button>
        <button class="btn primary" data-a="topla" ${offMove || w.state === 'sarili' ? 'disabled' : ''}>${icon('up')}Topla</button>
      </div>
    </div>
    ${online ? `<div class="card"><h2>İnce ayar</h2>
      <div class="btn-grid" style="grid-template-columns:1fr 1fr">
        <button class="btn ghost" data-a="asagi:200" ${offMove ? 'disabled' : ''}>${icon('downArrow')}20 cm sal</button>
        <button class="btn ghost" data-a="yukari:200" ${offMove ? 'disabled' : ''}>${icon('up')}20 cm topla</button>
      </div>
      <div class="field" style="margin-top:6px"><label>İniş boyu (m)<small>Soket şarj ağzına rahat yetişsin, fazlası yerde kalmasın.</small></label>
        <span style="display:flex;gap:8px;align-items:center"><input class="input num" id="kc-inis" inputmode="decimal" placeholder="${num(inisM(w), 2)}" aria-label="İniş boyu (m)">
        <button class="btn sm ghost" id="kc-kaydet">Kaydet</button></span></div>
      <div class="field"><label>Burası park<small>Soket şu an park kılıfındaysa konumu sıfırlar.</small></label>
        <button class="btn sm ghost" data-a="burasi_park" ${moving ? 'disabled' : ''}>${icon('lock')}Sıfırla</button></div>
    </div>` : ''}
    <div class="card">
      <h2>Güvenlik kuralları</h2>
      <div class="alerts">
        ${alertBox(charging ? 'warn' : 'ok', 'bolt', charging ? 'Şarj sürüyor' : 'Şarj yok', charging ? 'Şarj bitmeden kablo indirilip toplanamaz (Dur her zaman çalışır).' : 'Kablo çekici komut alabilir.')}
        ${alertBox('info', 'lock', 'Parktayken şarj açılmaz', 'Soket yuvadayken ya da kablo hareket halindeyken Togg prizi uzaktan açılamaz.')}
        ${alertBox('info', 'bell', 'Şarj bitince', 'Pi "şarj bitti" bildirimi gönderir; kablo aşağıdaysa buradan tek dokunuşla toplayabilirsin.')}
      </div>
    </div>
    ${online ? '' : `<div class="card"><h2>Bağlantı</h2><p class="hint">Kablo çekicinin ESP32 kartı Wi-Fi'ye bağlanınca durumunu buraya yazar.
      ${w.ts > 1.7e9 ? `Son haber: ${ago(w.ts)}.` : 'Henüz haber gelmedi.'} Kart açık ve Wi-Fi'ye bağlıysa birkaç saniye içinde görünür.</p></div>`}`;

  const send = async (b, action) => {
    b.disabled = true;
    try {
      const r = await app.store.command('sarici', action);
      toast(r.msg || (r.ok ? 'Gönderildi' : 'Başarısız'));
      if (r.needKey) app.go('ayarlar');
    } catch { toast('Komut gönderilemedi'); }
    app.refresh();
  };
  el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.a;
    if (a === 'indir' && !confirm('Kablo inecek. Altında kimse yok, araç üstü boş mu?')) return;
    if (a === 'burasi_park' && !confirm('Soket şu an park kılıfında mı? Konum sıfırlanacak.')) return;
    send(b, a);
  }));
  el.querySelector('#kc-kaydet')?.addEventListener('click', (e) => {
    const m = parseFloat(String(el.querySelector('#kc-inis').value).replace(',', '.'));
    if (!(m >= 0.5 && m <= 5.6)) { toast('İniş boyu 0,5–5,6 m arası olmalı'); return; }
    send(e.currentTarget, `inis:${m.toFixed(2)}`);
  });
}

// Canlı veri: durum aynıysa yalnız metre, çubuk ve "kaç sn önce" güncellenir
export function updateSarici(el, M) {
  if (sig(M) !== drawn) return false;
  const w = M.winder;
  if (!isOnline(w)) return true;
  const b = el.querySelector('#kc-bilgi'); if (b) b.textContent = infoLine(w);
  const c = el.querySelector('#kc-cubuk'); if (c) c.style.width = `${doluluk(w)}%`;
  return true;
}
