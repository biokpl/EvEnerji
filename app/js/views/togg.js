// Togg ekranı: yıl özeti, verimlilik, aylık şarj, oturum listesi
import { axisStyle, colors, mount } from '../charts.js';
import { AYLAR, AY_K, GUN_K, closeSheet, dur, esc, hm, icon, kwh, num, openSheet, pct, tl, toast, watt } from '../ui.js';
import { chargeCard } from './pano.js';

let showAll = false;

function sessItem(M, s) {
  const d = new Date(s.start * 1000);
  const live = !!(M.activeSession && M.activeSession.id === s.id);   // canlı veriye göre (Pi'nin bitiş kaydını beklemez)
  const cost = M.sarjTl(s);
  return `
  <button class="sess-item ${live ? 'live' : ''}" data-sid="${esc(s.sid)}" data-dev="${esc(s.dev)}">
    <div class="sess-date"><b>${d.getDate()}</b><span>${AY_K[d.getMonth()]}</span></div>
    <div class="sess-main">
      <div class="t">${live ? 'Şarj sürüyor' : `${GUN_K[d.getDay()]} ${hm(s.start)}${s.end ? ' – ' + hm(s.end) : ''}`}</div>
      <div class="s">${live ? `Başlangıç ${hm(s.start)}` : s.end || s.minutes ? dur(s.minutes ?? ((s.end - s.start) / 60)) : 'Bitti · kaydediliyor'}${s.socStart != null ? ` · ${s.socAuto ? '≈' : ''}%${num(s.socStart)}→${s.socEnd != null || s.full ? '' : '≈'}%${num(s.socEnd ?? s.socEst)}` : ''}${s.per100 ? ` · ${num(s.per100, 1)} kWh/100 km` : ''}${s.odo ? ` · ${num(s.odo)} km` : ''}</div>
    </div>
    <div class="sess-amt"><b>${num(s.kwh, 1)} kWh</b>${tl(cost)}</div>
  </button>`;
}

const socVal = (v) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) && x >= 0 && x <= 100 ? Math.round(x) : null; };

// Şarj sürerken: aracın şu anki yüzdesini sor, bu şarjda eklenen kadarını düşüp başlangıç olarak kaydet
// Şarj başlayınca / bitince açılan kısa kayıt penceresi (bildirimden ya da uygulama açılınca bir kez).
// Bitişte araç %100 dolduysa yüzde sorulmaz; km bu şarja girilmemişse sorulur (şarj sırasında araç yol yapmaz).
const SORULDU = 'evEnerji.soruldu';
const soruldu = (k) => { try { return (JSON.parse(localStorage.getItem(SORULDU) || '{}'))[k]; } catch { return false; } };
const soruldIsaretle = (k) => {
  try {
    const o = JSON.parse(localStorage.getItem(SORULDU) || '{}');
    o[k] = Date.now();
    for (const [x, t] of Object.entries(o)) if (Date.now() - t > 30 * 864e5) delete o[x];   // eskileri temizle
    localStorage.setItem(SORULDU, JSON.stringify(o));
  } catch { /* yoksay */ }
};

export function hizliKayitGerek(M) {
  // Uygulama açılınca kendiliğinden sorulacak bir şey var mı? → [tür, oturum kimliği] ya da null
  // Kendi hesaplama modunda sormaz; yalnız her 5. şarjda kontrol için sorar
  if (M.ogrenme?.oto && !M.ogrenme.kontrol) return null;
  const now = Date.now() / 1000;
  const a = M.activeSession;
  if (a && now - a.start < 3600 && (a.socStart == null || a.socAuto) && !soruldu(`basla/${a.id}`)) return ['basla', a.id];
  const son = M.sessions.find((x) => x.end);
  if (son && now - son.end < 3 * 3600 && !soruldu(`bitis/${son.sid}`)
      && ((!son.full && (son.socEnd == null || son.socEndAuto)) || !son.odo)) return ['bitis', son.sid];
  return null;
}

export function openHizliKayit(M, app, tur, sid) {
  const s = M.sessions.find((x) => x.sid === sid || x.id === sid) || (M.activeSession?.id === sid ? M.activeSession : null);
  if (!s) return false;
  soruldIsaretle(`${tur}/${sid}`);
  const bitis = tur === 'bitis';
  const yuzdeSor = bitis ? !s.full && s.socEnd == null : true;
  const kmSor = bitis ? !s.odo : true;
  if (!yuzdeSor && !kmSor) { toast(s.full ? 'Araç doldu · kayıt tamam' : 'Kayıt tamam'); return true; }
  const dev = s.dev || s.dev?.id;
  const ozet = bitis
    ? `${num(s.kwh, 1)} kWh · ${tl(M.sarjTl(s))} · ${dur(s.minutes ?? (((s.end || Date.now() / 1000) - s.start) / 60))}${s.full ? ' · Araç Doldu' : ''}`
    : `Saat ${hm(s.start)} · araçtaki değerleri gir`;
  openSheet(`
    <h3>${bitis ? 'Şarj bitti' : 'Şarj başladı'}</h3>
    <div class="sh-sub">${ozet}</div>
    ${yuzdeSor ? `<div class="field"><div><label for="hk-y">${bitis ? 'Bitiş yüzdesi' : 'Başlangıç yüzdesi'}</label><small>Trumore ya da araç ekranındaki pil yüzdesi.</small></div>
      <input class="input num" id="hk-y" inputmode="numeric" placeholder="${(bitis ? s.socEndAuto && s.socEnd : s.socAuto && s.socStart) ? `≈ %${bitis ? s.socEnd : s.socStart}` : '%'}" value="${bitis ? (s.socEndAuto ? '' : s.socEnd ?? '') : (s.socAuto ? '' : s.socStart ?? '')}"></div>` : ''}
    ${kmSor ? `<div class="field"><div><label for="hk-km">Kilometre</label><small>Aracın toplam km'si (tüketimi öğrenmek için).</small></div>
      <input class="input num" id="hk-km" inputmode="numeric" placeholder="km" value="${s.odo ?? ''}"></div>` : ''}
    <div class="btn-row" style="margin-top:14px">
      <button class="btn ghost" id="cancel">Sonra</button>
      <button class="btn primary" id="save">${icon('check')}Kaydet</button>
    </div>`, (sh) => {
    sh.querySelector('#cancel').onclick = () => closeSheet();
    sh.querySelector('#save').onclick = async () => {
      const y = sh.querySelector('#hk-y') ? socVal(sh.querySelector('#hk-y').value) : null;
      const km = sh.querySelector('#hk-km') ? parseInt(String(sh.querySelector('#hk-km').value).replace(/\D/g, ''), 10) : NaN;
      if (yuzdeSor && sh.querySelector('#hk-y').value && y == null) return toast('0–100 arası bir yüzde gir');
      if (bitis && y != null && s.socStart != null && y <= s.socStart) return toast('Bitiş yüzdesi başlangıçtan büyük olmalı');
      try {
        if (y != null) await app.store.patch(`settings/soc/${s.sid || s.id}`, bitis ? { bitis: y } : { basla: y });
        if (Number.isFinite(km) && km > 0) await app.store.put(`sessions/${s.dev?.id || s.dev}/${s.sid || s.id}/odo`, km);
        closeSheet(); toast('Kaydedildi');
      } catch { toast('Kaydedilemedi'); }
    };
  });
  return true;
}

export function openSocSheet(M, app) {
  const s = M.activeSession;
  if (!s) return;
  openSheet(`
    <h3>Şarj yüzdesi</h3>
    <div class="sh-sub">Aracın ekranındaki ya da Togg uygulamasındaki değer</div>
    <div class="field"><div><label for="socn">Araçta şu an</label><small>Gerisini prizden ölçülen enerjiyle tahmin ederim.</small></div>
      <input class="input num" id="socn" inputmode="numeric" placeholder="%" value="${s.socNow != null ? Math.round(s.socNow) : ''}"></div>
    <div class="field"><div><label for="hdf">Hedef</label><small>Araçta ayarlı şarj sınırı.</small></div>
      <input class="input num" id="hdf" inputmode="numeric" placeholder="%" value="${Math.round(Number(M.car.hedef_yuzde) || 100)}"></div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn ghost" id="cancel">Vazgeç</button>
      <button class="btn primary" id="save">${icon('check')}Kaydet</button>
    </div>`, (sh) => {
    sh.querySelector('#cancel').onclick = () => closeSheet();
    sh.querySelector('#save').onclick = async () => {
      const now = socVal(sh.querySelector('#socn').value), hdf = socVal(sh.querySelector('#hdf').value);
      if (now == null) return toast('0–100 arası bir yüzde gir');
      const basla = Math.max(0, Math.round((now - s.added) * 10) / 10);
      try {
        await app.store.put(`settings/soc/${s.id}`, { basla });
        if (hdf != null && hdf !== Number(M.car.hedef_yuzde)) await app.store.put('settings/car/hedef_yuzde', hdf);
        closeSheet(); toast('Kaydedildi');
      } catch { toast('Kaydedilemedi'); }
    };
  });
}

function openSession(M, s, app) {
  const cost = M.sarjTl(s);
  const sktt = s.tl_sktt ?? s.kwh * M.t.sktt_tl;
  const soc = (s.kwh * M.car.eff) / M.car.battery_kwh * 100;
  const ended = !!s.end;
  const sEff = !s.socAuto && s.socStart != null && s.socEnd != null && s.kwh > 1 ? ((s.socEnd - s.socStart) / 100) * M.car.battery_kwh / s.kwh : null;
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
    ${s.socStart != null ? `<p class="chart-note" style="margin:4px 0 6px">${s.socAuto ? '≈ ' : ''}%${num(s.socStart)} → ${s.socAuto ? `<b>%${num(s.socEnd)}</b> (Araç Doldu · Başlangıç Hesaplandı)` : s.socEnd != null ? `<b>%${num(s.socEnd)}</b>` : (s.full ? `%${num(s.socEst)} (Araç Doldu)` : `≈ %${num(s.socEst)} (Tahmin)`)}${s.km >= 1 ? ` · ${s.kmTahmini ? '≈ ' : ''}+${num(s.km)} km Menzil` : ''}${sEff ? ` · Bu Şarjda Verim %${num(sEff * 100)}` : ''}</p>` : ''}
    <div class="field">
      <div><label for="ss">Başlangıç %</label><small>Şarj başlarken araçtaki yüzde.</small></div>
      <input class="input num" id="ss" inputmode="numeric" placeholder="${s.socAuto ? '≈' + num(s.socStart) : '%'}" value="${s.socAuto ? '' : s.socStart ?? ''}">
    </div>
    ${ended ? `<div class="field">
      <div><label for="se">Bitiş %</label><small>Girersen aracının gerçek şarj verimini öğrenirim.</small></div>
      <input class="input num" id="se" inputmode="numeric" placeholder="${s.socAuto ? num(s.socEnd) : '%'}" value="${s.socAuto ? '' : s.socEnd ?? ''}">
    </div>` : ''}
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
      const basla = socVal(sh.querySelector('#ss').value);
      const bitis = ended ? socVal(sh.querySelector('#se').value) : null;
      if (basla != null && bitis != null && bitis <= basla) return toast('Bitiş yüzdesi başlangıçtan büyük olmalı');
      try {
        await app.store.put(`sessions/${s.dev}/${s.sid}/odo`, Number.isFinite(odo) ? odo : null);
        await app.store.put(`sessions/${s.dev}/${s.sid}/note`, note || null);
        const soc = {};
        if (basla != null) soc.basla = basla;
        if (bitis != null) soc.bitis = bitis;
        await app.store.put(`settings/soc/${s.sid}`, Object.keys(soc).length ? soc : null);
        closeSheet(); toast('Kaydedildi');
      } catch { toast('Kaydedilemedi'); }
    };
  });
}

// Üç zamanlı tarife: son 30 günün saatlik ölçümüyle aylık fatura karşılaştırması
function ucCard(M) {
  const u = M.ucz;
  if (!u) return '';
  const fark = u.tek - u.ucHepGece;
  const verdict = fark > 20
    ? `Togg'u gece (22–06) şarj edersen üç zamanlıda ayda ≈ <b>${num(fark)} ₺</b> daha az ödersin.`
    : u.tek - u.uc > 20 ? `Şu anki kullanımınla bile üç zamanlı ayda ≈ <b>${num(u.tek - u.uc)} ₺</b> daha ucuz.`
      : 'Şu anki tüketimle tek zamanlı daha uygun ya da fark çok küçük.';
  const togg = u.toggGece != null
    ? `Togg şarjında gece diliminin payı: <b>%${num(u.toggGece * 100)}</b>.`
    : "Togg'un hangi saatlerde şarj olduğu ilk ev şarjlarından sonra ölçülecek.";
  return `
    <div class="card">
      <div class="card-head"><h2>Üç Zamanlı Tarife</h2><span class="muted" style="font-size:12px;font-weight:700">${u.n < 7 ? 'Ön Tahmin' : `Son ${u.n} Gün`}</span></div>
      <p class="hint">Aylık fatura (≈ ${num(u.ayKwh)} kWh) iki tarifede:</p>
      <div class="mini-stats" style="grid-template-columns:1fr 1fr 1fr">
        <div><b>${num(u.tek)}</b><span>Tek Zamanlı ₺</span></div>
        <div><b>${num(u.uc)}</b><span>Üç Zamanlı ₺</span></div>
        <div><b style="color:${fark > 20 ? 'var(--good)' : 'inherit'}">${num(u.ucHepGece)}</b><span>Togg Hep Gece ₺</span></div>
      </div>
      <p class="chart-note">${verdict} ${togg}</p>
      <p class="chart-note">Üç zamanlıda kademe yok; gece ${num(u.fiyat.gece, 2)} · gündüz ${num(u.fiyat.gunduz, 2)} · puant ${num(u.fiyat.puant, 2)} ₺/kWh (Ayarlar'dan değişir).${u.varsayim ? ' Ana şalter olmadığı için evin geri kalanının saat dağılımı varsayıldı (gündüz %45 · puant %35 · gece %20).' : ''} Limit aşılırsa iki tarifede de son kaynak fiyatı uygulanır.</p>
    </div>`;
}

// Şarj kararı: gelecek yıl Togg evde mi (limit aşılır), DC'de mi (limit içinde kalınır)? Değerler canlı veriden.
// Öğrenen tüketim kartı: sıcaklığa göre tüketim, kendini sınama (son 5 şarj), kendi hesaplama durumu
function ogrenmeCard(M) {
  const O = M.ogrenme;
  if (!O) return '';
  const T = O.bugunT;
  const hataRenk = (h) => (h == null ? 'var(--line)' : h <= O.esik ? 'var(--good)' : h <= 2 * O.esik ? 'var(--mid)' : 'var(--bad)');
  const kutular = Array.from({ length: O.hedefN }, (_, i) => O.son[O.son.length - O.hedefN + i] || null);
  const iyi = O.son.filter((x) => x.kmsiz <= O.esik).length;
  const isitma = O.model && O.model.xMax - O.model.xMin >= 4 && O.model.b >= 0.05;
  const durumNot = O.oto
    ? (O.kontrol ? 'Bu şarjda kontrol için yüzde ve km sorulacak' : 'Yüzde ve km sorulmuyor · her 5. şarjda bir kontrol')
    : O.pr.length ? `Son ${O.hedefN} şarjda km'siz tahmin ±${num(O.esik, 0)} puan içinde kalınca sormayı bırakır`
      : 'İki şarj arası yüzde ve km girdikçe öğrenir';
  return `
  <div class="card karar ogren ${O.oto ? 'evde' : 'dc'}">
    <div class="kr-head">
      <div><div class="kr-lbl">Öğrenen tüketim</div>
        <div class="kr-title">${O.bugun != null ? `${num(O.bugun, 1)} <small>kWh/100 km</small>` : 'Veri bekleniyor'}</div></div>
      <span class="kr-pill">${icon(O.oto ? 'check' : 'trend')}${O.oto ? 'Kendi hesaplıyor' : `Öğreniyor ${iyi}/${O.hedefN}`}</span>
    </div>
    <p class="kr-sub">${T != null ? `Bugün İstanbul <b>${num(T, 0)} °C</b>` : 'Sıcaklık bekleniyor'}${M.activeSession?.menzil ? ` · menzil ≈ <b>${num(M.activeSession.menzil)} km</b>` : ''}</p>
    <div class="og-grafik" id="og-ch"></div>
    <div class="kr-cam">
      <div class="kr-lbl">Tahmin sınaması · son ${O.hedefN} şarj</div>
      <div class="og-kutu">${kutular.map((k) => `<div><i style="--c:${hataRenk(k?.kmsiz)}"${k ? '' : ' class="bos"'}></i><span>${k ? (k.kmsiz > 20 ? '>20' : `±${num(k.kmsiz, 1)}`) : '–'}</span></div>`).join('')}</div>
      <p class="kr-not">${durumNot}</p>
      <div class="kr-ayrac"></div>
      <div class="og-uc">
        <div><b>${num(O.kmM.yol)}</b><span>km · iş yolu</span></div>
        <div><b>%${num(M.carEff * 100)}</b><span>şarj verimi</span></div>
        <div><b>${num(O.model?.km ?? O.pr.reduce((t, p) => t + p.km, 0))}</b><span>öğrenilen km</span></div>
      </div>
      <p class="kr-not">${isitma ? `Soğukta her 1 °C için +${num(O.model.b, 2)} kWh/100 km (18 °C altı)` : 'Soğuğun etkisi henüz belirgin değil · farklı sıcaklıklarda sürüş biriktikçe ölçülecek'}</p>
    </div>
  </div>`;
}

function ogrenmeGrafik(el, M) {
  const O = M.ogrenme, kap = el.querySelector('#og-ch');
  if (!O || !kap) return;
  const c = colors(), ax = axisStyle(c);
  const noktalar = O.pr.filter((p) => p.T != null).map((p) => ({ value: [+p.T.toFixed(1), +p.c.toFixed(1)], km: p.km, t: p.t2 }));
  const Ts = noktalar.map((n) => n.value[0]).concat(O.bugunT ?? []);
  const x0 = Math.floor(Math.min(0, ...Ts) / 5) * 5, x1 = Math.ceil(Math.max(25, ...Ts) / 5) * 5;
  const egri = O.model ? Array.from({ length: (x1 - x0) * 2 + 1 }, (_, i) => { const t = x0 + i / 2; return [t, +O.model.tahmin(t).toFixed(2)]; }) : [];
  mount(kap, {
    grid: { left: 34, right: 10, top: 12, bottom: 26 },
    tooltip: { trigger: 'item', formatter: (p) => p.seriesIndex === 0
      ? `<b>${num(p.data.km)} km sürüş</b><br>${num(p.value[0], 1)} °C · ${num(p.value[1], 1)} kWh/100 km`
      : p.seriesIndex === 2 ? `<b>Bugün ${num(p.value[0], 0)} °C</b><br>beklenen ${num(p.value[1], 1)} kWh/100 km`
        : `${num(p.value[0], 1)} °C → ${num(p.value[1], 1)} kWh/100 km` },
    xAxis: { type: 'value', min: x0, max: x1, interval: 5, ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: '{value}°' } },
    yAxis: { type: 'value', scale: true, ...ax, axisLine: { show: false }, splitNumber: 3 },
    series: [
      { type: 'scatter', data: noktalar, symbolSize: (v, p) => Math.max(7, Math.min(22, Math.sqrt(p.data.km) * 1.4)),
        itemStyle: { color: c.ev, opacity: 0.75, borderColor: 'rgba(255,255,255,.6)', borderWidth: 0.6, shadowBlur: 10, shadowColor: c.ev } },
      { type: 'line', data: egri, showSymbol: false, smooth: true, lineStyle: { color: c.accent2 || c.ev, width: 2, type: [6, 4] }, z: 1 },
      ...(O.bugun != null && O.bugunT != null ? [{ type: 'effectScatter', data: [[O.bugunT, +O.bugun.toFixed(2)]], symbolSize: 9,
        rippleEffect: { scale: 2.6, brushType: 'stroke' }, itemStyle: { color: c.good }, z: 3 }] : []),
    ],
  });
}

function kararCard(M) {
  const k = M.karar;
  if (!k) return '';
  const evde = k.evdeKarli;
  const enBuyuk = Math.max(k.evde, k.dcInd, k.dcTam);
  const w = (x) => `${Math.max(0, (x / enBuyuk) * 100).toFixed(1)}%`;
  const evPay = k.H * k.sktt;                              // evde seçeneğinde evin payı (son kaynak)
  const satir = (ad, top, parcalar, soluk) => `
    <div class="kr-row${soluk ? ' soluk' : ''}"><span>${ad}</span><b>≈ ${num(top)} ₺</b></div>
    <div class="kr-bar${soluk ? ' soluk' : ''}">${parcalar.map(([x, c]) => `<i style="width:${w(x)};background:${c}"></i>`).join('')}</div>`;
  const pos = (v) => `${Math.min(97, Math.max(3, ((v - 6) / 10) * 100)).toFixed(1)}%`;   // 6–16 ₺ ölçeği
  const ayRenk = (i) => (k.hepsiSktt || (k.skttBas && i + 1 >= k.skttBas) ? 'var(--bad)' : k.asimAyi && i + 1 >= k.asimAyi ? 'var(--mid)' : 'var(--good)');
  const yolNot = k.hepsiSktt ? `${k.yil} tamamen son kaynak fiyatıyla`
    : k.asimAyi ? `${AYLAR[k.asimAyi - 1]} ayında aşılır${k.skttBas ? ` · ${AYLAR[k.skttBas - 1]} ayından son kaynak` : ''} · ${k.yil + 1} tamamen son kaynak`
    : 'Bu tempoyla limit aşılmıyor';
  const ilerleme = Math.min(100, (k.sktt / k.esikSktt) * 100);
  const dcYaz = (v) => num(v, v % 1 ? 2 : 0);
  return `
  <div class="card karar ${evde ? 'evde' : 'dc'}">
    <div class="kr-head">
      <div><div class="kr-lbl">Şarj kararı · ${k.yil}</div>
        <div class="kr-title">${evde ? 'Evde şarj daha kârlı' : 'DC şarj daha kârlı'}</div></div>
      <span class="kr-pill">${icon(evde ? 'home' : 'bolt')}${evde ? 'Evde' : 'DC'}</span>
    </div>
    <p class="kr-sub">${evde ? "İndirimli DC'ye göre" : 'Evde şarja göre'} yılda <b>≈ ${num(k.fark)} ₺</b> tasarruf</p>
    <div class="kr-bars">
      ${satir('Evde şarj · limit aşılır', k.evde, [[evPay, 'var(--home)'], [k.evde - evPay, 'var(--ev)']], false)}
      ${satir(`DC indirimli · ${dcYaz(k.dc)} ₺`, k.dcInd, [[k.evNormal, 'var(--home)'], [k.evHakTl, 'var(--ev)'], [(k.T - k.hak) * k.dc, 'var(--mid)']], false)}
      ${satir(`DC indirimsiz · ${dcYaz(k.dcTamFiyat)} ₺`, k.dcTam, [[k.evNormal, 'var(--home)'], [k.evHakTl, 'var(--ev)'], [(k.T - k.hak) * k.dcTamFiyat, 'var(--mid)']], true)}
      <div class="kr-lg"><span><i style="background:var(--home)"></i>Ev</span><span><i style="background:var(--ev)"></i>Togg evde</span><span><i style="background:var(--mid)"></i>Togg DC</span></div>
    </div>
    <div class="kr-cam">
      <div class="kr-lbl">Togg'un 1 kWh maliyeti</div>
      <div class="kr-olcek">
        <div class="kr-iz"></div>
        <div class="kr-im ana" style="left:${pos(k.toggBirim)}"><span>Evde ${num(k.toggBirim, 1)}</span></div>
        <div class="kr-im alt" style="left:${pos(k.dc)}"><span>DC ${dcYaz(k.dc)}</span></div>
        <div class="kr-im alt soluk" style="left:${pos(k.dcTamFiyat)}"><span>${dcYaz(k.dcTamFiyat)}</span></div>
      </div>
      <p class="kr-not">Evdeki maliyete limit aşımı yüzünden evin zamlı faturası da dahil</p>
      <div class="kr-ayrac"></div>
      <div class="kr-row"><span>${icon('trend')} Karar değişir</span><span class="kr-not" style="margin:0">son kaynak fiyatı</span></div>
      <div class="kr-esik"><b>${num(k.sktt, 2)} ₺</b><span>→</span><b class="hedef">${num(k.esikSktt, 2)} ₺</b></div>
      <div class="kr-bar ince"><i style="width:${ilerleme.toFixed(1)}%;background:${ilerleme > 95 ? 'var(--mid)' : 'var(--good)'}"></i></div>
      <p class="kr-not">${evde ? 'Bunu geçerse DC daha ucuz olur' : 'Bunun altına inerse evde şarj yeniden kârlı'} · fiyat her ay güncellenir</p>
    </div>
    <div class="kr-cam">
      <div class="kr-lbl">${k.yil} limit yolu · ${num(k.L)} kWh</div>
      <div class="kr-aylar">${AY_K.map((a, i) => `<div><i style="--c:${ayRenk(i)}"></i><span>${a[0]}</span></div>`).join('')}</div>
      <p class="kr-not">${yolNot}${evde ? '' : ` · limit içinde Togg'a evde ≈ ${num(k.hak)} kWh hak`}</p>
    </div>
  </div>`;
}

export function renderTogg(el, M, app) {
  if (!M.evs.length && !M.histTotal) {
    el.innerHTML = `<div class="card"><div class="empty">${icon('car')}<br>Araç şarj prizi tanımlı değil.<br>Cihazlar sekmesinden prizin türünü <b>Araç şarjı</b> yap.</div></div>`;
    return;
  }
  const yearSess = M.sessions.filter((s) => new Date(s.start * 1000).getFullYear() === M.y);
  // Şarj sayısı: Pi'nin kaydettikleri + eski uygulamanın günlük verisinden çıkarılanlar (≈)
  const n = yearSess.length + (M.histSarj || 0);
  const avg = n ? M.evYtd / n : 0;
  const nYak = M.histSarj ? '≈ ' : '';
  const tlPer100 = M.per100Duvar * M.toggAyBirim(M.mi);   // prizden çekilen enerjinin bu ayki Togg birim maliyetiyle bedeli
  const yak = M.per100Tahmini ? '≈ ' : '';
  const skttCost = M.evYtd * M.t.sktt_tl;
  const list = showAll ? M.sessions : M.sessions.slice(0, 8);
  el.innerHTML = `
    <div class="card hero">
      <div class="row-between" style="position:relative;z-index:1">
        <div><div class="muted" style="font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase">${M.y} şarjı</div>
          <div style="font-size:34px;font-weight:800;letter-spacing:-.03em" class="num">${num(M.evYtd)} <small class="muted" style="font-size:15px">kWh</small></div>
          <div class="muted" style="font-weight:700">${tl(M.evTl, 0)}${n ? ` · ${nYak}${n} şarj<br>ort. ${kwh(avg, 1)}` : ''}</div></div>
        <div class="car-wrap"><img class="car-img" src="img/t10x.webp" alt="Togg T10X" width="160" height="83"></div>
      </div>
      <div class="share-bar" style="position:relative;z-index:1" aria-label="Togg payı ${pct(M.evShare * 100)}">
        <i style="width:${M.evShare * 100}%;background:var(--ev)"></i><i style="flex:1;background:var(--home)"></i></div>
      <div class="legend" style="position:relative;z-index:1"><span><i style="background:var(--ev)"></i>Togg ${pct(M.evShare * 100)}</span><span><i style="background:var(--home)"></i>Evin geri kalanı</span></div>
      <div class="trio">
        <div><b>${yak}${num(M.aracTuketim, 1)}</b><span>kWh/100 km</span><small class="tri-not">${M.ogrenme.model ? `${num(M.ogrenme.bugunT ?? 18, 0)} °C · öğrenilen` : M.per100Bat ? `Son ${num(M.per100Km)} km` : 'Trumore ort.'}</small></div>
        <div><b>${yak}${num(tlPer100, 0)}</b><span>₺/100 km</span><small class="tri-not">Masraf · ${num(tlPer100 / 100, 2)} ₺/km</small></div>
        <div><b>≈ ${num(M.evProj)}</b><span>Yıl Sonu kWh</span><small class="tri-not">Beklenen Toplam</small></div>
      </div>
    </div>
    <div data-slot="charge">${chargeCard(M)}</div>
    ${kararCard(M)}
    ${ogrenmeCard(M)}
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
    ${ucCard(M)}
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
  ogrenmeGrafik(el, M);
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
