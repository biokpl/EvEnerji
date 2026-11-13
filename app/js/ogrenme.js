// Öğrenen tüketim: girilen şarj yüzdeleri + km + günlük İstanbul sıcaklığından aracın tüketimini öğrenir,
// kendini sınar (her yeni şarjda "bu kez %X ile gelmeliydi" tahmini, gerçek girişle kıyas) ve tahminleri
// yeterince tutunca yüzde/km sormayı bırakıp kendisi hesaplar.
//
// Model: araç tüketimi (kWh/100 km, bataryadan) = a + b · max(0, KONFOR − sıcaklık)
//   b: soğukta ısıtma yükü. Az veride b önsel değere (EV'lerde tipik ≈0,35) çekilir; veri çoğaldıkça ve
//   farklı sıcaklıklar biriktikçe kendi değerini bulur. Ağırlık: km (kısa yolun %1 yuvarlama hatası büyük) ×
//   yenilik (yarı ömür 120 gün; araç/lastik/sürüş alışkanlığı zamanla değişir).

export const KONFOR = 18;          // °C; üstünde ısıtma yükü yok sayılır
const B_ONSEL = 0.35;              // kWh/100 km / °C
const LAMBDA = 300;                // önselin ağırlığı (≈300 km'lik 1 °C yayılımlı veri)
const YARI_OMUR_GUN = 120;
const OTO_HATA = 3;                // son 5 sınamanın km'siz ort. hatası bunun altındaysa (puan) kendi hesaplar
const OTO_N = 5;
const KONTROL_ARALIGI = 5;         // kendi hesaplarken her 5. şarjda bir yine sorar (sapma kontrolü)

const gunKey = (ts) => { const d = new Date(ts * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// t1..t2 arası günlerin ortalama sıcaklığı (yoksa null)
export function sicaklik(hava, t1, t2) {
  let top = 0, n = 0;
  const son = gunKey(t2);
  for (let t = t1, k = gunKey(t1); ; t += 86400, k = gunKey(t)) {
    const h = hava[k];
    if (h && Number.isFinite(h.ort)) { top += h.ort; n++; }
    if (k >= son || n > 400) break;
  }
  return n ? top / n : null;
}

// Ağırlıklı en küçük kareler, b önsele doğru düzenlenmiş; b ∈ [0, 1,2]
export function uydur(ornekler, simdi) {
  const veri = ornekler.filter((o) => o.T != null);
  const km = veri.reduce((s, o) => s + o.km, 0);
  if (km < 60) return null;
  let W = 0, Wx = 0, Wxx = 0, Wy = 0, Wxy = 0;
  for (const o of veri) {
    const w = o.km * Math.pow(0.5, Math.max(0, simdi - o.t2) / 86400 / YARI_OMUR_GUN);
    const x = Math.max(0, KONFOR - o.T), y = o.c;
    W += w; Wx += w * x; Wxx += w * x * x; Wy += w * y; Wxy += w * x * y;
  }
  const lam = LAMBDA * (W / km);        // önsel, yenilik ağırlığıyla aynı ölçekte
  const det = W * (Wxx + lam) - Wx * Wx;
  let b = (W * (Wxy + lam * B_ONSEL) - Wx * Wy) / det;
  b = Math.min(1.2, Math.max(0, b));
  const a = (Wy - b * Wx) / W;
  const xler = veri.map((o) => Math.max(0, KONFOR - o.T));
  return { a, b, km, n: veri.length, xMin: Math.min(...xler), xMax: Math.max(...xler),
    tahmin: (T) => a + b * Math.max(0, KONFOR - (T ?? KONFOR)) };
}

// Sürüş parçaları: bilinen bir yüzde noktasından (şarj bitişi) bir sonraki başlangıç yüzdesi + km girilmiş
// şarja kadar. Aradaki (yüzdesi girilmemiş) şarjların eklediği enerji de hesaba katılır.
//   sessions: zamana göre sıralı; her biri {start, end, kwh, odo, full, socStart, socEnd}
export function parcalar(sessions, { cap, eff, hedef, hava }) {
  const ekle = (s) => ((s.kwh || 0) * eff / cap) * 100;          // şarjın eklediği yüzde
  const bitisSoc = (s) => s.socEnd ?? (s.full ? hedef : (s.socStart != null ? Math.min(100, s.socStart + ekle(s)) : null));
  const out = [];
  let A = null, araEk = 0;                                         // A: son bilinen bitiş noktası
  for (const s of sessions) {
    if (A && s.socStart != null && s.odo) {
      const km = s.odo - A.odo, dus = A.soc + araEk - s.socStart;
      if (km > 0 && km < 3000 && dus >= 0) {
        const kwh = (dus / 100) * cap;
        out.push({ t1: A.t, t2: s.start, km, dus, kwh, c: (kwh / km) * 100, gun: Math.max(0.05, (s.start - A.t) / 86400),
          T: sicaklik(hava, A.t, s.start), yol: yolSayisi(A.t, s.start), basSoc: A.soc + araEk, sid: s.sid, cap });
      }
    }
    if (!s.end) break;                                             // süren şarj: sonrası yok
    const b = bitisSoc(s);
    if (b != null && s.odo) { A = { soc: b, odo: s.odo, t: s.end }; araEk = 0; }
    else if (A && s.socStart == null) araEk += ekle(s);            // girişsiz ara şarj: enerjisi eklenir
    else { A = null; araEk = 0; }                                  // km bilinmiyor: zincir koptu
  }
  return out;
}

// Km tahmini: kullanıcının düzeni — hafta içi 08:00 işe ~20 km, 17:00 dönüş ~20 km. İki şarj arasında kaç iş
// yolu kaldığı sayılır; km = yol × (yol başı km) + gün × (ek km/gün: hafta sonu, ek gezmeler). İkisi de veriden
// öğrenilir; az veride kullanıcının verdiği değerlere (20 km, ek ≈ 5 km/gün) çekilir.
export const IS_SAATLERI = [8, 17];
const YOL_KM = 20, EK_KM = 5, L_YOL = 20, L_EK = 5;
// t1..t2 arasındaki hafta içi iş yolları: [{ts, gun, ad: 'sabah'|'aksam'}]
export function yolListesi(t1, t2) {
  const out = [];
  const d = new Date(t1 * 1000); d.setHours(0, 0, 0, 0);
  for (; d.getTime() / 1000 < t2 && out.length < 400; d.setDate(d.getDate() + 1)) {
    const g = d.getDay();
    if (g === 0 || g === 6) continue;
    IS_SAATLERI.forEach((h, i) => {
      const t = new Date(d); t.setHours(h, 0, 0, 0);
      const ts = t.getTime() / 1000;
      if (ts > t1 && ts < t2) out.push({ ts, gun: gunKey(ts), ad: i ? 'aksam' : 'sabah' });
    });
  }
  return out;
}
export const yolSayisi = (t1, t2) => yolListesi(t1, t2).length;

// Bir aralıkta aracın gördüğü sıcaklık: iş yolları kendi saatinin (08:00 / 17:00) sıcaklığıyla, ek yollar gün
// ortalamasıyla; km payına göre ağırlıklı. Saatlik değer yoksa gün ortalaması.
export function yolSicakligi(hava, t1, t2, kmM) {
  const y = kmM?.yol ?? YOL_KM, e = kmM?.ek ?? EK_KM;
  let top = 0, w = 0;
  for (const l of yolListesi(t1, t2)) {
    const h = hava[l.gun];
    const T = h ? (h[l.ad] ?? h.ort) : null;
    if (T != null) { top += y * T; w += y; }
  }
  const ort = sicaklik(hava, t1, t2);
  const ek = e * Math.max(0, t2 - t1) / 86400;
  if (ort != null && ek > 0) { top += ek * ort; w += ek; }
  return w > 0 ? top / w : ort;
}

export function kmModeli(pr) {
  // Σ (km − y·L − e·D)² + L_YOL·(y − 20)² + L_EK·(e − 5)² en küçük (ridge, önsele doğru)
  let LL = L_YOL, LD = 0, DD = L_EK, LK = L_YOL * YOL_KM, DK = L_EK * EK_KM;
  for (const p of pr) {
    const L = p.yol ?? yolSayisi(p.t1, p.t2), D = p.gun;
    LL += L * L; LD += L * D; DD += D * D; LK += L * p.km; DK += D * p.km;
  }
  const det = LL * DD - LD * LD;
  let y = (LK * DD - LD * DK) / det, e = (LL * DK - LD * LK) / det;
  if (e < 0) { e = 0; y = LK / LL; }
  if (y < 0) { y = 0; e = DK / DD; }
  return { yol: y, ek: e, n: pr.length, haftaIci: 2 * y + e,
    tahmin: (t1, t2) => y * yolSayisi(t1, t2) + e * Math.max(0, t2 - t1) / 86400 };
}

// İleri yürüyen sınama: her parça için yalnız ÖNCEKİ parçalarla öğrenip tahmin et (gerçek hayattaki gibi)
export function sinama(pr, yedek) {
  const sonuc = [];
  for (let j = 0; j < pr.length; j++) {
    const once = pr.slice(0, j), p = pr[j];
    const m = uydur(once, p.t2);
    const c = m ? m.tahmin(p.T) : yedek;
    const kmM = kmModeli(once.filter((o) => p.t2 - o.t2 < 90 * 86400));
    const tahDus = (km) => (km * c) / p.cap;                         // km × kWh/100km → batarya yüzdesi
    const kmli = Math.abs(tahDus(p.km) - p.dus);
    const kmTah = kmM.tahmin(p.t1, p.t2);
    const kmsiz = Math.abs(tahDus(kmTah) - p.dus);
    sonuc.push({ sid: p.sid, t: p.t2, kmli, kmsiz, km: p.km, kmTah, gercek: p.dus, tahmin: tahDus(p.km), ogrenildi: !!m });
  }
  return sonuc;
}

export function ogren({ sessions, cap, eff, hedef, hava, yedek, simdi = Date.now() / 1000, bugunT }) {
  const pr = parcalar(sessions, { cap, eff, hedef, hava });
  const kmM0 = kmModeli(pr.filter((p) => simdi - p.t2 < 90 * 86400));
  for (const p of pr) p.T = yolSicakligi(hava, p.t1, p.t2, kmM0) ?? p.T;   // iş yolu saatlerinin sıcaklığı
  const model = uydur(pr, simdi);
  const sin = sinama(pr, yedek);
  const son = sin.filter((s) => s.kmsiz != null).slice(-OTO_N);
  const ort = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const maeKmsiz = ort(son.map((s) => s.kmsiz));
  const maeKmli = ort(sin.slice(-OTO_N).map((s) => s.kmli));
  // Km düzeni: son 90 günün parçalarından (iş yolu başı km + ek km/gün)
  const kmM = kmModeli(pr.filter((p) => simdi - p.t2 < 90 * 86400));
  const kmGun = kmM.haftaIci;
  const oto = son.length >= OTO_N && maeKmsiz <= OTO_HATA;
  const bugun = model ? model.tahmin(bugunT) : null;
  return { pr, model, sin, son, maeKmsiz, maeKmli, kmGun, kmM, oto, bugunT, bugun, hedefN: OTO_N, esik: OTO_HATA };
}

// Kendi hesaplama: girilmemiş başlangıç/bitiş yüzdesi ve km'yi önceki bilinen noktadan tahmin eder.
// Öğrenmeye KATILMAZ (yalnız gösterim için); gerçek girişler hep önceliklidir.
export function otoDoldur(sessions, O, { cap, eff, hedef, hava, yedek }) {
  const ekle = (s) => ((s.kwh || 0) * eff / cap) * 100;
  const tuk = (t1, t2) => { const T = yolSicakligi(hava, t1, t2, O.kmM); return O.model ? O.model.tahmin(T) : yedek; };
  let A = null;                                                     // {soc, odo, t, oto}
  for (const s of sessions) {
    if (A && s.socStart == null) {
      const km = s.odo && A.odo ? s.odo - A.odo : O.kmM.tahmin(A.t, s.start);
      s.socStart = Math.max(0, Math.round(A.soc - (km * tuk(A.t, s.start) / 100) / cap * 100));
      s.socAuto = true;
      if (!s.odo && A.odo) { s.odoTahmin = Math.round(A.odo + km); }
    }
    if (!s.end) break;
    if (s.socEnd == null && s.socStart != null) {
      s.socEnd = s.full ? hedef : Math.min(100, Math.round(s.socStart + ekle(s)));
      s.socEndAuto = true;
    }
    const soc = s.socEnd ?? (s.full ? hedef : null);
    A = soc != null ? { soc, odo: s.odo || s.odoTahmin || null, t: s.end } : null;
  }
  return A;                                                         // son bilinen/tahmin edilen nokta (süren şarj için)
}

// Kendi hesaplama modunda bu şarj için yine de sorulmalı mı? (her 5. şarj kontrol)
export function kontrolSirasi(sessions) {
  let n = 0;
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i];
    if (s.socStart != null && !s.socAuto) break;
    n++;
  }
  return n >= KONTROL_ARALIGI;
}

// ---- Araç şimdi: son şarjdan bu yana iş yolları düşülerek tahmini pil yüzdesi, menzil ve ileriye bakış
const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
export function simdiDurum(sessions, O, { cap, eff, hedef, hava, yedek }, simdi = Date.now() / 1000, alt = 20, aktif = null) {
  const ekle = (s) => ((s.kwh || 0) * eff / cap) * 100;
  // aktif: şarj sürüyor {soc, w} → bir sonraki iş yoluna (08:00) kadar şarj devam eder, o yüzdeyle yola çıkılır
  const son = aktif ? null : [...sessions].reverse().find((s) => s.end);
  if (!aktif && (!son || sessions.some((s) => !s.end))) return null;
  const basSoc = aktif ? aktif.soc
    : son.socEnd ?? (son.full ? hedef : (son.socStart != null ? Math.min(100, son.socStart + ekle(son)) : null));
  if (basSoc == null) return null;
  const kmM = O.kmM;
  const c = (T) => (O.model ? O.model.tahmin(T) : yedek);
  const sicak = (gun, ad) => { const h = hava[gun]; return h ? (h[ad] ?? h.ort) : null; };
  // Olaylar: iş yolları (yol başı km, kendi saatinin sıcaklığı) + her gün 13:00'te ek yol (gün ortalaması)
  const olaylar = (t1, t2) => {
    const ev = yolListesi(t1, t2).map((l) => ({ ts: l.ts, km: kmM.yol, T: sicak(l.gun, l.ad), ad: l.ad }));
    const d = new Date(t1 * 1000); d.setHours(13, 0, 0, 0);
    for (; d.getTime() / 1000 < t2; d.setDate(d.getDate() + 1)) {
      const ts = d.getTime() / 1000;
      if (ts > t1 && kmM.ek > 0) ev.push({ ts, km: kmM.ek, T: hava[gunKey(ts)]?.ort ?? null, ad: 'ek' });
    }
    return ev.sort((x, y) => x.ts - y.ts);
  };
  let soc = basSoc, km = 0, sonT = null;
  let cikis = null;
  const gunAdi = (ts) => (gunKey(simdi) === gunKey(ts) ? 'Bugün' : gunKey(simdi + 86400) === gunKey(ts) ? 'Yarın' : GUNLER[new Date(ts * 1000).getDay()]);
  if (aktif) {                                                       // bir sonraki yola çıkışta beklenen yüzde
    const ilk = olaylar(simdi, simdi + 8 * 86400)[0];
    if (ilk) {
      const saat = (ilk.ts - simdi) / 3600;
      cikis = { ts: ilk.ts, soc: Math.min(Math.max(basSoc, aktif.hedef ?? hedef), basSoc + ((aktif.w / 1000) * saat * eff / cap) * 100) };
      cikis.dolu = cikis.soc >= (aktif.hedef ?? hedef) - 0.5;
      cikis.not = ilk.ad === 'ek' ? `${gunAdi(ilk.ts)} öğlene` : `${gunAdi(ilk.ts)} ${ilk.ad === 'sabah' ? '08:00' : '17:00'} çıkışta`;
    }
  }
  for (const o of (aktif ? [] : olaylar(son.end, simdi))) {
    const T = o.T ?? sonT; sonT = T;
    soc -= (o.km * c(T)) / cap; km += o.km;
  }
  soc = Math.max(0, soc);
  // İleriye bakış (14 gün): ne zaman %alt altına iner, kaç iş günü yeter
  let f = cikis ? cikis.soc : soc, altinda = null, isGunu = 0;
  for (const o of olaylar(cikis ? cikis.ts - 1 : simdi, simdi + 14 * 86400)) {
    const T = o.T ?? sonT; sonT = T ?? sonT;
    f -= (o.km * c(T)) / cap;
    if (f < alt) { altinda = o; break; }
    if (o.ad === 'aksam') isGunu++;
  }
  const altinNot = altinda ? (() => {
    const d = new Date(altinda.ts * 1000);
    const bugun = gunKey(simdi) === gunKey(altinda.ts), yarin = gunKey(simdi + 86400) === gunKey(altinda.ts);
    const g = bugun ? 'Bugün' : yarin ? 'Yarın' : GUNLER[d.getDay()];
    if (bugun) return altinda.ad === 'sabah' ? 'Bu sabah' : altinda.ad === 'aksam' ? 'Bu akşam' : 'Bugün';
    return `${g} ${altinda.ad === 'sabah' ? 'sabahı' : altinda.ad === 'aksam' ? 'akşamı' : 'gün içinde'}`;
  })() : null;
  // Yarın: sabah/akşam sıcaklığıyla beklenen tüketim
  const yh = hava[gunKey(simdi + 86400)];
  const yarin = yh ? { sabah: yh.sabah ?? yh.ort, aksam: yh.aksam ?? yh.ort } : null;
  if (yarin) yarin.c = c((yarin.sabah + yarin.aksam) / 2);
  const bh = hava[gunKey(simdi)];
  const cSimdi = c(bh ? ((bh.sabah ?? bh.ort) + (bh.aksam ?? bh.ort)) / 2 : null);
  const odo0 = aktif ? aktif.odo : son.odo || son.odoTahmin;
  return {
    soc, km, basSoc, son, sarjda: !!aktif, cikis, odo: odo0 ? Math.round(odo0 + km) : null,
    menzil: ((soc / 100) * cap / cSimdi) * 100, c: cSimdi, altinda, altinNot, isGunu, alt, yarin,
    gunKm: kmM.haftaIci, gunKwh: (kmM.haftaIci * cSimdi) / 100 / eff,
  };
}

// Bu ay gidilen ≈ km: şarjlardaki km okumaları + bugünkü tahmini km'den, ay başına doğrusal ara değer
export function ayKm(sessions, simdiOdo, kmM, simdi = Date.now() / 1000) {
  const p = sessions.filter((s) => s.odo).map((s) => ({ t: s.start, odo: s.odo }));
  if (simdiOdo) p.push({ t: simdi, odo: simdiOdo });
  if (!p.length) return null;
  p.sort((a, b) => a.t - b.t);
  const d = new Date(simdi * 1000);
  const ay = new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000;
  const once = [...p].reverse().find((x) => x.t <= ay), sonra = p.find((x) => x.t > ay);
  let basOdo;
  if (once && sonra) basOdo = once.odo + (sonra.odo - once.odo) * (ay - once.t) / (sonra.t - once.t);
  else if (sonra) basOdo = sonra.odo - kmM.tahmin(ay, sonra.t);
  else return null;
  return Math.max(0, p[p.length - 1].odo - basOdo);
}
