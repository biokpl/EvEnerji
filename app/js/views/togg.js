// Togg ekranı: yıl özeti, verimlilik, aylık şarj, oturum listesi
import { axisStyle, colors, mount } from '../charts.js';
import { AYLAR, AY_K, GUN_K, closeSheet, dur, esc, hm, icon, kwh, num, openSheet, pct, tl, toast, watt } from '../ui.js';
import { chargeCard } from './pano.js';
import { BAKIM_AY, BAKIM_KM, takvim, tkIkon } from '../takvim.js';
import { HIZLAR, IL, TATIL, YEDEK, planla, yerKoord, yolHavasi, yolMesafesi } from '../yolculuk.js';

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
// Araç şimdi: son şarjdan bu yana iş yolları düşülerek tahmini pil, menzil ve ileriye bakış (şarj sürmüyorken)
function aracSimdiCard(M) {
  const A = M.aracSimdi;
  if (!A) return '';
  const renk = A.soc < A.alt ? 'var(--bad)' : A.soc < 40 ? 'var(--mid)' : 'var(--good)';
  const tlGun = A.gunKwh * M.toggAyBirim(M.mi);
  const yeter = A.altinda
    ? `<b>${A.isGunu} iş günü</b><span>${A.altinNot} %${A.alt}'nin altına iner</span>`
    : '<b>2 haftadan fazla</b><span>şarj gerekmiyor</span>';
  return `
  <div class="card karar simdi" style="--sc:${renk}">
    <div class="kr-head">
      <div><div class="kr-lbl">Araç şimdi · ${A.sarjda ? 'şarjda' : 'tahmini'}</div>
        <div class="sm-buyuk"><b>≈ %${num(A.soc)}</b><span>≈ ${num(A.menzil)} km menzil</span></div></div>
      <button class="kr-pill tk-duzen" id="ok-gir">${icon('edit')}Güncelle</button>
    </div>
    <div class="sm-pil"><i style="width:${Math.max(2, Math.min(100, A.soc)).toFixed(1)}%"></i><b style="left:${A.alt}%"></b></div>
    <p class="kr-not">${A.sarjda
      ? (A.cikis ? `Şarjda · ${A.cikis.not} ≈ %${num(A.cikis.soc)}${A.cikis.dolu ? ' (dolmuş olur)' : ''}` : 'Şarjda')
      : `${A.son?.okuma ? `Son okuma ${new Date(A.son.end * 1000).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} %${num(A.basSoc)}` : `Son şarj %${num(A.basSoc)}`} · o günden beri ≈ ${num(A.km)} km`}${A.odo ? ` · araç ≈ ${num(A.odo)} km` : ''} · bugün ${num(A.c, 1)} kWh/100 km</p>
    <div class="kr-cam">
      <div class="sm-satir"><span class="kr-lbl">Yeter</span><div>${yeter}</div></div>
      ${A.yarin ? `<div class="kr-ayrac"></div>
      <div class="sm-satir"><span class="kr-lbl">Yarın</span><div><b>${num(A.yarin.c, 1)} kWh/100 km</b><span>08:00 ${num(A.yarin.sabah, 0)}° · 17:00 ${num(A.yarin.aksam, 0)}°</span></div></div>` : ''}
      <div class="kr-ayrac"></div>
      <div class="og-uc">
        <div><b>≈ ${num(A.gunKm)}</b><span>km/iş günü</span></div>
        <div><b>≈ ${num(tlGun)} ₺</b><span>iş günü maliyeti</span></div>
        <div><b>${A.ayKm != null ? `≈ ${num(A.ayKm)}` : '–'}</b><span>km bu ay</span></div>
      </div>
    </div>
  </div>`;
}

// Yolculuk planlayıcı kartı (kısa) + hesaplama penceresi
function yolculukCard() {
  return `
  <div class="card karar yolk dc">
    <div class="kr-head">
      <div><div class="kr-lbl">Yolculuk planla</div>
        <div class="kr-title">Uzun yola mı çıkıyorsun?</div></div>
      <button class="kr-pill tk-duzen" id="yol-ac">${icon('trend')}Planla</button>
    </div>
    <p class="kr-not">Varış yerinin hava tahmini ve senin tüketiminle: kaç yüzdeye şarj etmeli, yolda DC gerekir mi, masraf ne tutar.</p>
  </div>`;
}

// Yer listesi: önce Antalya ve Adana (nereye), sonra 81 il alfabetik, sonra tatil yerleri; en sonda elle km
const yerSecenek = (secili, ozel = false) => {
  const opt = (ad) => `<option${ad === secili ? ' selected' : ''}>${ad}</option>`;
  const iller = IL.map(([ad]) => ad);
  return `${ozel ? `<optgroup label="Sık">${['Antalya', 'Adana'].map(opt).join('')}</optgroup>` : ''}
    <optgroup label="İller">${iller.filter((x) => !ozel || !['Antalya', 'Adana'].includes(x)).map(opt).join('')}</optgroup>
    <optgroup label="Tatil yerleri">${TATIL.map(([ad]) => opt(ad)).join('')}</optgroup>
    ${ozel ? '<option value="-1">Başka (km gir)…</option>' : ''}`;
};

function openYolculuk(M) {
  const yarin = new Date(Date.now() + 864e5);
  const gun0 = `${yarin.getFullYear()}-${String(yarin.getMonth() + 1).padStart(2, '0')}-${String(yarin.getDate()).padStart(2, '0')}`;
  let yol = 1;                                                     // 1 tek yön, 2 gidiş-dönüş
  let dcTur = 'ind';                                               // DC: indirimli (kampanyalı istasyon) / indirimsiz
  openSheet(`
    <div class="yp-bas"><h3>Yolculuk planla</h3><button class="yp-kapat" id="cancel" aria-label="Kapat">✕</button></div>
    <div class="yp-giris">
      <label class="yp-g"><span>Nereden</span><select class="input" id="yp-n">${yerSecenek('İstanbul')}</select></label>
      <label class="yp-g"><span>Nereye</span><select class="input" id="yp-s">${yerSecenek('Antalya', true)}</select></label>
      <div class="yp-g"><span>Çıkış</span><div class="yp-tarih"><input class="input" type="date" id="yp-t" value="${gun0}">
        <select class="input" id="yp-saat">${Array.from({ length: 38 }, (_, i) => { const h = 4 + Math.floor(i / 2), m = i % 2 ? '30' : '00'; const v = `${String(h).padStart(2, '0')}:${m}`; return `<option${v === '08:00' ? ' selected' : ''}>${v}</option>`; }).join('')}</select></div></div>
      <div class="yp-g"><span>Yol</span><div class="yp-seg" id="yp-y"><button data-y="1" class="on">Tek yön</button><button data-y="2">Gidiş-dönüş</button></div></div>
      <label class="yp-g"><span>Otoyol hızı</span><select class="input" id="yp-h">${HIZLAR.map(([h], i) => `<option value="${i}"${h === 120 ? ' selected' : ''}>${h} km/sa</option>`).join('')}</select></label>
      <div class="yp-g"><span>DC fiyatı (Trugo)</span><div class="yp-seg" id="yp-dc"><button data-dc="ind" class="on">${num(Number(M.car.public_tl) || 12, 2)} ₺</button><button data-dc="tam">${num(Number(M.car.public_tl_tam) || 14.98, 2)} ₺</button></div></div>
      <label class="yp-g yp-tam" id="yp-kmf" style="display:none"><span>Tek yön km</span><input class="input num" id="yp-km" inputmode="numeric" placeholder="km"></label>
    </div>
    <div id="yp-sonuc" class="kr-cam yp-sonuc"><p class="kr-not" style="margin:0">Hesaplanıyor…</p></div>`, (sh) => {
    sh.querySelector('#cancel').onclick = () => closeSheet();
    const hesap = async () => {
      const nereden = sh.querySelector('#yp-n').value, nereye = sh.querySelector('#yp-s').value;
      const elle = nereye === '-1';
      sh.querySelector('#yp-kmf').style.display = elle ? '' : 'none';
      const out = sh.querySelector('#yp-sonuc');
      let km, mesafeNot = '';
      if (elle) km = parseInt(String(sh.querySelector('#yp-km').value).replace(/\D/g, ''), 10);
      else if (nereden === nereye) { out.innerHTML = '<p class="kr-not" style="margin:0">Nereden ve nereye aynı</p>'; return; }
      else {
        if (!out.dataset.dolu) out.innerHTML = '<p class="kr-not" style="margin:0">Yol hesaplanıyor…</p>';
        const m = await yolMesafesi(nereden, nereye);
        km = m?.km; mesafeNot = m?.kaynak === 'tahmini' ? ' (tahmini)' : '';
      }
      if (!(km > 0)) { out.innerHTML = '<p class="kr-not" style="margin:0">Tek yön km gir</p>'; return; }
      const kalkis = yerKoord(nereden) || [41.01, 28.97], varisK = elle ? kalkis : yerKoord(nereye);
      const gun = sh.querySelector('#yp-t').value || gun0;
      const hiz = HIZLAR[Number(sh.querySelector('#yp-h').value)];
      if (!out.dataset.dolu) out.innerHTML = '<p class="kr-not" style="margin:0">Hava tahmini alınıyor…</p>';
      const T = await yolHavasi(varisK[0], varisK[1], gun, kalkis[0], kalkis[1]);
      const planOpt = { km, gidisDonus: yol === 2, T: T ?? M.ogrenme?.bugunT, M, katsayi: hiz[1], lpgKatsayi: hiz[2], dcFiyat: dcTur === 'tam' ? (Number(M.car.public_tl_tam) || 14.98) : (Number(M.car.public_tl) || 12) };
      let P = planla(planOpt);
      const hedefAd = elle ? 'Varış' : nereye;
      // Şarj: şu anki yüzdeden çıkış yüzdesine; en geç ne zaman takılmalı (çıkış 08:00)
      const A = M.activeSession?.socNow != null ? { soc: M.activeSession.socNow } : M.aracSimdi ? { soc: M.aracSimdi.soc } : null;
      const cap = Number(M.car.battery_kwh) || 88.5;
      const eksik = A ? Math.max(0, P.hedefBasla - A.soc) : null;
      const kwhPriz = A ? (eksik / 100) * cap / (M.carEff || 0.87) : null;
      const kw = Math.max(1, (M.sessions.find((x) => x.peak_w)?.peak_w || 1900) / 1000);
      const saat = A ? kwhPriz / kw : null;
      const cikisSaat = sh.querySelector('#yp-saat').value || '08:00';
      const hm2c = (d) => d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      const cikis = new Date(`${gun}T${cikisSaat}:00`), tak = A ? new Date(cikis.getTime() - saat * 3600e3) : null;
      // Yetişmiyorsa: şimdi takılırsa çıkışa kadar ulaşılacak yüzde; plan bu yüzdeyle yeniden kurulur
      const kalanSaat = Math.max(0, (cikis - Date.now()) / 3600e3);
      const yetismez = A && eksik > 0.5 && tak < new Date();
      if (yetismez) P = planla({ ...planOpt, baslaSoc: Math.floor(Math.min(P.hedefBasla, A.soc + (kalanSaat * kw * (M.carEff || 0.87) / cap) * 100)) });
      const buyuk = (t) => t.charAt(0).toLocaleUpperCase('tr-TR') + t.slice(1);
      const baslik = !A ? `${buyuk(new Date(cikis - 864e5).toLocaleDateString('tr-TR', { weekday: 'long' }))} akşamı şarj et`
        : eksik <= 0.5 ? 'Ek şarj gerekmiyor'
          : tak < new Date() ? 'Hemen şarja tak'
            : `${buyuk(tak.toLocaleDateString('tr-TR', { weekday: 'long' }))} ${tak.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}'de şarja tak`;
      const alt = yetismez ? `Şu an %${num(A.soc)} → ${hm2c(cikis)}'de %${num(P.basla)} · %${num(P.hedefBasla)} için ${saat >= 1 ? `${Math.round(saat)} saat` : `${Math.round(saat * 60)} dk`} gerekiyor`
        : A && eksik > 0.5 ? `Şu an %${num(A.soc)} · evde ${num(kwhPriz)} kWh · ${saat >= 1 ? `${Math.round(saat)} saat` : `${Math.round(saat * 60)} dk`}` : A ? `Şu an %${num(A.soc)}` : '';
      // Saatler: ortalama hız seçilen hızın %85'i (şehir çıkışı, yavaşlama); DC molaları eklenir
      const ortHiz = hiz[0] * 0.85;
      const saatAt = (k) => new Date(cikis.getTime() + (k / ortHiz) * 3600e3
        + P.duraklar.filter((d) => d.km < k).reduce((t, d) => t + d.dk, 0) * 60e3);
      const hm2 = (d) => d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      const varisT = saatAt(km);                                       // varış (gidiş-dönüşte dönüş noktası)
      const sureDk = Math.round((varisT - cikis) / 60e3);
      const sureYaz = (dk) => `${Math.floor(dk / 60)} sa ${dk % 60} dk`;
      const gunFarki = varisT.toDateString() !== cikis.toDateString() ? ' (ertesi gün)' : '';
      // Rota şeridi: başlangıç, DC durakları, (dönüş noktası), varış
      const pos = (k) => Math.min(100, Math.max(0, (k / P.topKm) * 100));
      const noktalar = [
        { k: 0, ad: nereden, ust: hm2(cikis), alt: `%${num(P.basla)}`, tur: 'bas' },
        ...P.duraklar.map((d, j) => ({ k: d.km, ust: d.km < km ? hm2(saatAt(d.km)) : '', alt: `%${d.son}<em>${d.dk}′</em>`, tur: 'dc', no: j + 1 })),   // varış saati · çıkış % · mola dk
        ...(yol === 2 ? [{ k: km, ad: hedefAd, ust: hm2(varisT), alt: P.varis != null ? `%${num(P.varis)}` : '', tur: 'don' }] : []),
        { k: P.topKm, ad: yol === 2 ? nereden : hedefAd, ust: yol === 2 ? '' : hm2(varisT), alt: `%${num(yol === 2 ? P.donus : P.varis)}`, tur: 'son' },
      ];
      // Şehir noktasına çok yakın DC durağının saati şehrin saatiyle çakışmasın
      for (const n of noktalar) if (n.tur === 'dc' && noktalar.some((o) => o.tur !== 'dc' && Math.abs(pos(o.k) - pos(n.k)) < 9)) n.ust = '';
      const serit = `<div class="yp-rota">
        <div class="yp-cizgi"></div>
        ${noktalar.map((n) => `<div class="yp-n ${n.tur}${pos(n.k) > 88 ? ' sag' : pos(n.k) < 12 ? ' sol' : ''}" style="left:${pos(n.k).toFixed(1)}%">
          <small class="ad">${esc(n.ad || '')}</small><small>${esc(n.ust)}</small><i>${n.tur === 'dc' ? icon('bolt') : ''}</i><b>${n.alt}</b></div>`).join('')}
      </div>`;
      const dc = dcTur === 'tam' ? (Number(M.car.public_tl_tam) || 14.98) : (Number(M.car.public_tl) || 12);
      out.dataset.dolu = '1';
      out.innerHTML = `
        <div class="yp-ana"><span>${baslik}</span><b>%${num(P.basla)}</b></div>
        ${alt ? `<p class="kr-not" style="margin:2px 0 0">${alt}</p>` : ''}
        ${serit}
        <div class="yp-sure">${icon('clock')}<span><b>${hm2(cikis)} → ${hm2(varisT)}</b>${gunFarki} · ${yol === 2 ? 'tek yön ' : ''}${sureYaz(sureDk)}${(() => { const m = P.duraklar.filter((d) => d.km < km).reduce((t, d) => t + d.dk, 0); return m ? ` <small>· ${m} dk mola dahil</small>` : ''; })()}</span>${T != null ? `<em class="yp-hava" title="Yol boyu ortalama sıcaklık">${icon('thermo')}${num(T, 0)}°</em>` : ''}</div>
        <div class="yp-izgara">
          <div><b>${num(P.topKm)} km${mesafeNot ? '*' : ''}</b><span>${num(P.c, 1)} kWh/100 km</span></div>
          <div><b>${num(P.menzil)} km</b><span>otoyol menzili</span></div>
          <div><b>${P.dcDurak ? `${P.molaDk} dk` : 'Yok'}</b><span>${P.dcDurak ? `${P.dcDurak} DC molası` : 'DC molası'}</span></div>
          <div class="yesil"><b>${num(P.tl)} ₺</b><span>Toplam Masraf</span></div>
          <div class="yp-ikili"><b>${num(P.evTl)} ₺ / ${num(P.dcTl)} ₺</b><span>Ev / DC fiyatı</span></div>
          <div class="lpg"><b>${num(P.lpgTl)} ₺</b><span>LPG'li araçla</span></div>
        </div>
        <p class="kr-not yp-not" data-son>Tüketimin ${num(P.temel, 1)} → ${hiz[0]} km/sa'te ${num(P.c, 1)} · durağa %${YEDEK} ile (${num(P.yedekKm)} km yedek) · DC ${num(dc, 2)} ₺, 150 kW · ortalama hız ≈ ${num(ortHiz)} km/sa</p>`;
    };
    sh.querySelectorAll('#yp-dc button').forEach((b) => b.addEventListener('click', () => {
      dcTur = b.dataset.dc;
      sh.querySelectorAll('#yp-dc button').forEach((x) => x.classList.toggle('on', x === b));
      hesap();
    }));
    sh.querySelectorAll('#yp-y button').forEach((b) => b.addEventListener('click', () => {
      yol = Number(b.dataset.y);
      sh.querySelectorAll('#yp-y button').forEach((x) => x.classList.toggle('on', x === b));
      hesap();
    }));
    for (const id of ['#yp-n', '#yp-s', '#yp-t', '#yp-h', '#yp-saat']) sh.querySelector(id).addEventListener('change', hesap);
    sh.querySelector('#yp-km').addEventListener('change', hesap);
    setTimeout(hesap, 340);                                      // açılış kayması bitince (takılmasın)
  });
}

// Sürüş karnesi (her şarj arası sürüş, havaya göre beklenenle kıyas) + LPG'ye göre tasarruf kumbarası
function karneCard(M) {
  const O = M.ogrenme;
  const c = M.car, lpgTl = Number(c.lpg_tl) || 50.7, lpgL = Number(c.lpg_l100) || 10;
  const parca = (O?.model ? O.pr.filter((p) => p.T != null && p.km >= 30) : []).slice(-6);
  const birim = M.toggAyBirim(M.mi) / (M.carEff || 0.87);                       // bataryaya giren 1 kWh'in ₺'si
  const kart = parca.map((p) => {
    const bek = O.model.tahmin(p.T), ger = O.model.yolC(p);
    return { p, puan: (bek / ger) * 100, tl: ((bek - ger) / 100) * p.km * birim };
  });
  const son = kart[kart.length - 1];
  // Kumbara: bu yıl LPG'li araca göre biriken (km kartıyla aynı hesap)
  const ev = M.evAvgTl > 0 ? (M.per100Duvar * M.evAvgTl) / 100 : null, lpg = (lpgL * lpgTl) / 100;
  const kmYil = M.per100Duvar > 0 ? (M.evYtd / M.per100Duvar) * 100 : 0;
  const biriken = ev != null ? kmYil * lpg - M.evTl : null;            // bu yıl LPG'ye gidecek − Togg'a ödenen
  const K = c.kumbara || {};
  const hedef = Number(K.tutar) || 0;
  const oran = hedef && biriken != null ? Math.min(100, (biriken / hedef) * 100) : null;
  if (!son && biriken == null) return '';
  return `
  <div class="card karar karne evde">
    <div class="kr-head">
      <div><div class="kr-lbl">Sürüş karnesi</div>
        <div class="kr-title">${son ? (son.puan >= 100 ? `Beklenenden %${num(son.puan - 100)} verimli` : `Beklenenden %${num(100 - son.puan)} fazla`) : 'Sürüş bekleniyor'}</div></div>
      ${son ? `<span class="kr-pill" style="--pc:${son.puan >= 100 ? 'var(--good)' : 'var(--mid)'}">${son.tl >= 0 ? '+' : '−'}${num(Math.abs(son.tl))} ₺</span>` : ''}
    </div>
    ${son ? `<p class="kr-not">Son sürüş ${num(son.p.km)} km · ${num(son.p.T, 0)} °C'de beklenen ${num(O.model.tahmin(son.p.T), 1)}, gerçekleşen ${num(O.model.yolC(son.p), 1)} kWh/100 km</p>
    <div class="kn-cubuk">${kart.map((k) => `<div title="${num(k.p.km)} km"><i style="height:${Math.max(8, Math.min(100, 50 + (k.puan - 100) * 2.5)).toFixed(0)}%;--c:${k.puan >= 100 ? 'var(--good)' : 'var(--mid)'}"></i><span>${num(k.puan)}</span></div>`).join('')}</div>` : ''}
    ${biriken != null ? `<div class="kr-cam">
      <div class="kr-row" style="margin-top:0"><span class="kr-lbl">Tasarruf kumbarası · ${M.y}</span><button class="kn-hedef" id="kn-hedef">${icon('edit')}</button></div>
      <div class="kn-tutar"><b>≈ ${num(biriken)} ₺</b><span>LPG'li araca göre cebinde kaldı</span></div>
      ${hedef ? `<div class="kr-bar"><i style="width:${oran.toFixed(1)}%;background:var(--good)"></i></div>
      <p class="kr-not">${esc(K.ad || 'Hedef')}: ${num(hedef)} ₺ · %${num(oran)}${oran >= 100 ? ' · hedefe ulaştın' : ` · ≈ ${num(hedef - biriken)} ₺ kaldı`}</p>`
      : '<p class="kr-not">Bir hedef koy (örneğin kışlık lastik); ilerlemesini burada izle.</p>'}
    </div>` : ''}
  </div>`;
}

function openKumbara(M, app) {
  const K = M.car.kumbara || {};
  openSheet(`
    <h3>Kumbara hedefi</h3>
    <div class="field"><div><label for="kb-ad">Hedef</label></div><input class="input" id="kb-ad" value="${esc(K.ad || '')}" placeholder="Kışlık lastik"></div>
    <div class="field"><div><label for="kb-t">Tutar (₺)</label></div><input class="input num" id="kb-t" inputmode="numeric" value="${K.tutar || ''}" placeholder="₺"></div>
    <div class="btn-row" style="margin-top:14px"><button class="btn ghost" id="cancel">Vazgeç</button><button class="btn primary" id="save">${icon('check')}Kaydet</button></div>`, (sh) => {
    sh.querySelector('#cancel').onclick = () => closeSheet();
    sh.querySelector('#save').onclick = async () => {
      const t = parseInt(String(sh.querySelector('#kb-t').value).replace(/\D/g, ''), 10);
      try {
        await app.store.patch('settings/car/kumbara', { ad: sh.querySelector('#kb-ad').value.trim() || null, tutar: t > 0 ? t : null });
        closeSheet(); toast('Kaydedildi');
      } catch { toast('Kaydedilemedi'); }
    };
  });
}

// Bakım ve evrak takvimi: 12 aylık zaman şeridi + dönem halkalı satırlar; dokununca ayrıntı ve tek dokunuşla yenileme
let tkAcik = null;
const tkRenk = (k) => (k <= 7 ? 'var(--bad)' : k <= 30 ? 'var(--mid)' : 'var(--good)');
const tkKalan = (k) => (k < 0 ? [String(-k), 'gün geçti'] : k === 0 ? ['Bugün', ''] : k < 60 ? [String(k), 'gün']
  : k < 365 ? [String(Math.round(k / 30)), 'ay'] : [(k / 365).toFixed(1).replace('.', ','), 'yıl']);
const tkTarih = (d, ay = 'short') => d.toLocaleDateString('tr-TR', { day: 'numeric', month: ay, year: 'numeric' });

function takvimCard(M) {
  const L = takvim(M);
  const ilk = L[0];
  // Zaman şeridi: bu aydan itibaren 12 ay; 12 ay içindeki kalemler işaretlenir
  const bugun = new Date(), bas = new Date(bugun.getFullYear(), bugun.getMonth(), 1), son = new Date(bas.getFullYear(), bas.getMonth() + 12, 1);
  const konum = (d) => ((d - bas) / (son - bas)) * 100;
  const aylar = Array.from({ length: 12 }, (_, i) => new Date(bas.getFullYear(), bas.getMonth() + i, 1));
  const yakin = L.filter((x) => x.tarih < son), uzak = L.length - yakin.length;
  // Kutucuğu saran köşeli çerçeve: üst ortadan saat yönünde, dönemin geçen kısmı kadar dolar
  const CERCEVE = 'M23 3.5H30A12.5 12.5 0 0 1 42.5 16V30A12.5 12.5 0 0 1 30 42.5H16A12.5 12.5 0 0 1 3.5 30V16A12.5 12.5 0 0 1 16 3.5Z';
  const halka = (x) => `<svg class="tk-halka" viewBox="0 0 46 46"><path d="${CERCEVE}" class="iz" pathLength="100"/>
      <path d="${CERCEVE}" class="dolu" pathLength="100" stroke-dasharray="${(x.oran * 100).toFixed(1)} 100"/></svg>`;
  return `
  <div class="card karar takvim evde">
    <div class="kr-head">
      <div><div class="kr-lbl">Bakım ve evrak</div>
        <div class="kr-title">${ilk ? `Sıradaki: ${ilk.kisa || ilk.ad}` : 'Takvim'}</div>
        ${ilk ? `<div class="tk-alt" style="color:${ilk.kalan <= 30 ? tkRenk(ilk.kalan) : `var(--tk-${ilk.ikon})`}">${ilk.tahmini ? '≈ ' : ''}${tkKalan(ilk.kalan).join(' ')} · ${tkTarih(ilk.tarih, 'long')}</div>` : ''}</div>
      <button class="kr-pill tk-duzen" id="tk-duzen">${icon('edit')}Düzenle</button>
    </div>
    <div class="tk-serit">
      <div class="tk-cizgi"><b style="left:${konum(bugun).toFixed(1)}%"></b>
        ${Object.values(yakin.reduce((g, x) => { const k = x.tarih.toDateString(); (g[k] ||= []).push(x); return g; }, {})).map((grup) => {
          const x = grup[0];
          return `<i class="tk-nokta${x.kalan <= 30 ? ' yakin' : ''}" data-tk="${x.id}" style="left:${konum(x.tarih).toFixed(1)}%;--tc:var(--tk-${x.ikon});--uc:${tkRenk(x.kalan)}" title="${esc(grup.map((g) => g.kisa || g.ad).join(' · '))}">${tkIkon(x.ikon)}${grup.length > 1 ? `<em>${grup.length}</em>` : ''}</i>`;
        }).join('')}</div>
      <div class="tk-aylar">${aylar.map((d) => `<span>${AY_K[d.getMonth()].slice(0, 3)}</span>`).join('')}</div>
      ${uzak ? `<div class="tk-uzak">+${uzak} kalem 12 aydan sonra ›</div>` : ''}
    </div>
    <div class="kr-cam tk-liste">
      ${L.map((x) => {
        const [n, b] = tkKalan(x.kalan);
        const acik = tkAcik === x.id;
        return `<div class="tk-kalem${acik ? ' acik' : ''}${x.kalan <= 30 ? ' yakin' : ''}" style="--tc:var(--tk-${x.ikon});--uc:${tkRenk(x.kalan)}" data-tk="${x.id}">
        <button class="tk-satir" data-tk-ac="${x.id}" aria-expanded="${acik}">
          <span class="tk-ikon">${halka(x)}${tkIkon(x.ikon)}</span>
          <span class="tk-orta"><b>${x.ad}</b><small>${x.tahmini ? '≈ ' : ''}${tkTarih(x.tarih)}${x.not ? ` · ${esc(x.not)}` : ''}</small></span>
          <span class="tk-sag"><b>${x.tahmini ? '≈' : ''}${n}</b><small>${b}</small></span>
        </button>
        <div class="tk-detay">
          <div class="tk-donem"><span>${tkTarih(x.bas)}</span><span>%${Math.round(x.oran * 100)} geçti</span><span>${tkTarih(x.tarih)}</span></div>
          <div class="tk-bar"><i style="width:${(x.oran * 100).toFixed(1)}%"></i></div>
          <div class="tk-cipler"><span>${icon('clock')}${esc(x.donem)}</span><span>${icon('bell')}30 · 7 · 1 gün önce</span></div>
          ${x.eylem ? `<button class="tk-eylem" data-tk-eylem="${x.id}">${icon('check')}<span>${x.eylem.etiket}</span></button>` : ''}
        </div>
      </div>`;
      }).join('')}
    </div>
  </div>`;
}

function takvimEtkilesim(el, M, app) {
  const kart = el.querySelector('.takvim');
  if (!kart) return;
  const ac = (id) => {
    tkAcik = tkAcik === id ? null : id;
    kart.querySelectorAll('.tk-kalem').forEach((k) => {
      const a = k.dataset.tk === tkAcik;
      k.classList.toggle('acik', a);
      k.querySelector('.tk-satir').setAttribute('aria-expanded', a);
    });
  };
  kart.querySelectorAll('[data-tk-ac]').forEach((b) => b.addEventListener('click', () => ac(b.dataset.tkAc)));
  kart.querySelectorAll('.tk-nokta').forEach((b) => b.addEventListener('click', () => {
    if (tkAcik !== b.dataset.tk) ac(b.dataset.tk);
    kart.querySelector(`.tk-kalem[data-tk="${b.dataset.tk}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));
  // İki dokunuşla onay: ilkinde soru, ikincisinde kayıt (4 sn içinde)
  kart.querySelectorAll('[data-tk-eylem]').forEach((b) => b.addEventListener('click', async () => {
    const x = takvim(M).find((k) => k.id === b.dataset.tkEylem);
    if (!x?.eylem) return;
    if (!b.classList.contains('onay')) {
      b.classList.add('onay');
      b.querySelector('span').textContent = `${x.eylem.onay} Tekrar dokun`;
      setTimeout(() => { if (b.isConnected) { b.classList.remove('onay'); b.querySelector('span').textContent = x.eylem.etiket; } }, 4000);
      return;
    }
    try {
      await app.store.patch('settings/car/takvim', x.eylem.yama(M.S.car?.takvim || {}));
      toast('Kaydedildi');
    } catch { toast('Kaydedilemedi'); }
  }));
}

function openTakvim(M, app) {
  const T = M.S.car?.takvim || {};
  const alan = (id, ad, alt, tip = 'date', ph = '') => `<div class="field"><div><label for="tk-${id}">${ad}</label>${alt ? `<small>${alt}</small>` : ''}</div>
    <input class="input${tip === 'date' ? '' : ' num'}" ${tip === 'date' ? 'type="date"' : 'inputmode="numeric"'} id="tk-${id}" value="${esc(String(T[id] ?? ''))}" placeholder="${ph}"></div>`;
  openSheet(`
    <h3>Bakım ve evrak</h3>
    <div class="sh-sub">Yaklaşınca 30, 7 ve 1 gün önce hatırlatılır</div>
    ${alan('bakim_km', 'Son bakım km', 'Hiç bakım yapılmadıysa boş bırak', 'num', 'km')}
    ${alan('tescil', 'Tescil tarihi', 'İlk bakım ve ilk muayene buna göre')}
    ${alan('bakim_tarih', 'Son bakım tarihi', 'Hiç bakım yapılmadıysa tescil tarihi')}
    ${alan('bakim_aralik_km', 'Bakım aralığı (km)', 'Servis kitapçığındaki değer', 'num', String(BAKIM_KM))}
    ${alan('bakim_aralik_ay', 'Bakım aralığı (ay)', '', 'num', String(BAKIM_AY))}
    ${alan('muayene', 'Muayene tarihi', 'Yeni araçta ilk muayene 3 yıl sonra')}
    ${alan('kasko', 'Kasko bitişi', '')}
    ${alan('trafik', 'Trafik sigortası bitişi', '')}
    <div class="btn-row" style="margin-top:14px">
      <button class="btn ghost" id="cancel">Vazgeç</button>
      <button class="btn primary" id="save">${icon('check')}Kaydet</button>
    </div>`, (sh) => {
    sh.querySelector('#cancel').onclick = () => closeSheet();
    sh.querySelector('#save').onclick = async () => {
      const v = {};
      for (const id of ['tescil', 'bakim_tarih', 'muayene', 'kasko', 'trafik']) v[id] = sh.querySelector(`#tk-${id}`).value || null;
      for (const id of ['bakim_km', 'bakim_aralik_km', 'bakim_aralik_ay']) {
        const n = parseInt(String(sh.querySelector(`#tk-${id}`).value).replace(/\D/g, ''), 10);
        v[id] = Number.isFinite(n) && n > 0 ? n : null;
      }
      try { await app.store.patch('settings/car/takvim', v); closeSheet(); toast('Kaydedildi'); } catch { toast('Kaydedilemedi'); }
    };
  });
}

// Ara okuma: araçtaki (Trumore) yüzde ve km'yi şarj beklemeden gir; tahmin ve öğrenme bundan düzelir
function openOkuma(M, app) {
  const A = M.aracSimdi;
  openSheet(`
    <h3>Araçtaki değerler</h3>
    <div class="sh-sub">Trumore ya da araç ekranından · tahmin ve öğrenme bu değerle düzelir</div>
    <div class="field"><div><label for="ok-y">Pil yüzdesi</label>${A ? `<small>Uygulamanın tahmini ≈ %${num(A.soc)}</small>` : ''}</div>
      <input class="input num" id="ok-y" inputmode="numeric" placeholder="%"></div>
    <div class="field"><div><label for="ok-km">Toplam km</label>${A?.odo ? `<small>Tahmin ≈ ${num(A.odo)} km</small>` : ''}</div>
      <input class="input num" id="ok-km" inputmode="numeric" placeholder="km"></div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn ghost" id="cancel">Vazgeç</button>
      <button class="btn primary" id="save">${icon('check')}Kaydet</button>
    </div>`, (sh) => {
    sh.querySelector('#cancel').onclick = () => closeSheet();
    sh.querySelector('#save').onclick = async () => {
      const y = socVal(sh.querySelector('#ok-y').value);
      const km = parseInt(String(sh.querySelector('#ok-km').value).replace(/\D/g, ''), 10);
      if (y == null) return toast('0–100 arası bir yüzde gir');
      if (!(km > 0)) return toast('Toplam km gir');
      const ts = Date.now();
      try { await app.store.patch('settings/okuma', { [ts]: { soc: y, odo: km, ts } }); closeSheet(); toast('Kaydedildi'); }
      catch { toast('Kaydedilemedi'); }
    };
  });
}

// Öğrenen tüketim kartı: sıcaklığa göre tüketim, kendini sınama (son 5 şarj), kendi hesaplama durumu
function ogrenmeCard(M) {
  const O = M.ogrenme;
  if (!O) return '';
  const T = O.bugunT;
  const hataRenk = (h) => (h == null ? 'var(--line)' : h <= O.esik ? 'var(--good)' : h <= 2 * O.esik ? 'var(--mid)' : 'var(--bad)');
  const kutular = Array.from({ length: O.hedefN }, (_, i) => O.son[i] || null);   // soldan dolar; boşlar sıradaki şarjlar
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
        <div><b>${O.model ? `${num(O.model.s, 1)} kWh` : '–'}</b><span>bekleme/gün</span></div>
      </div>
      <p class="kr-not">${isitma ? `Soğukta her 1 °C için +${num(O.model.b, 2)} kWh/100 km (18 °C altı)` : 'Soğuğun etkisi henüz belirgin değil · farklı sıcaklıklarda sürüş biriktikçe ölçülecek'}</p>
    </div>
  </div>`;
}

function ogrenmeGrafik(el, M) {
  const O = M.ogrenme, kap = el.querySelector('#og-ch');
  if (!O || !kap) return;
  const c = colors(), ax = axisStyle(c);
  // noktalar beklemesiz yol tüketimi (bekleme kaybı düşülmüş), eğriyle aynı ölçek
  const noktalar = O.pr.filter((p) => p.T != null).map((p) => ({ value: [+p.T.toFixed(1), +(O.model ? O.model.yolC(p) : p.c).toFixed(1)], km: p.km, t: p.t2 }));
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
      ...(O.bugun != null && O.bugunT != null ? [{ type: 'scatter', data: [[O.bugunT, +O.bugun.toFixed(2)]], symbolSize: 10,
        itemStyle: { color: c.good, borderColor: 'rgba(255,255,255,.8)', borderWidth: 1, shadowBlur: 8, shadowColor: c.good }, z: 3 }] : []),
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
    ${aracSimdiCard(M)}
    <div data-slot="charge">${chargeCard(M)}</div>
    ${kararCard(M)}
    ${ogrenmeCard(M)}
    ${karneCard(M)}
    ${yolculukCard()}
    ${takvimCard(M)}
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
  el.querySelector('#tk-duzen')?.addEventListener('click', () => openTakvim(M, app));
  el.querySelector('#ok-gir')?.addEventListener('click', () => openOkuma(M, app));
  takvimEtkilesim(el, M, app);
  el.querySelector('#yol-ac')?.addEventListener('click', () => openYolculuk(M));
  el.querySelector('#kn-hedef')?.addEventListener('click', () => openKumbara(M, app));

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
