// Çevrimdışı önbellek (yalnız uygulama dosyaları; Firebase verisi önbelleğe alınmaz).
const CACHE = 'evenerji-v10.4';
const ASSETS = [
  './', './index.html', './manifest.json', './css/app.css', './vendor/echarts.min.js',
  './js/app.js', './js/data.js', './js/demo.js', './js/model.js', './js/ogrenme.js', './js/push.js', './js/takvim.js', './js/yolculuk.js', './js/tariff.js', './js/ui.js', './js/charts.js', './js/keypad.js', './js/auth.js',
  './js/views/pano.js', './js/views/togg.js', './js/views/ev.js', './js/views/cihazlar.js', './js/views/sarici.js', './js/views/ayarlar.js',
  './img/t10x.webp', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' → tarayıcının HTTP önbelleğindeki eski kopya değil, sunucudaki yeni dosya iner
  // (yoksa yeni sürüm kurulurken bazı dosyalar 10 dk'lık GitHub önbelleğinden eski gelip sürümler karışıyordu)
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Seyrek değişen dosyalar (resim, ikon, grafik kütüphanesi, yazı tipi): önce önbellekten anında ver,
// arkada sessizce tazele. Kod dosyaları aşağıda her açılışta sunucuya doğrulatılır.
const STATIC = /\/(img|icons|vendor)\//;
const FONTS = /^fonts\.(googleapis|gstatic)\.com$/;

function cacheFirst(e) {
  const fresh = fetch(e.request).then((res) => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  });
  e.waitUntil(fresh.then(() => {}, () => {}));
  return caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fresh);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname.endsWith('firebasedatabase.app')) return;
  // Google giriş kütüphanesi sürüm numaralı adreste: değişmez, önbellekten anında
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) { e.respondWith(cacheFirst(e)); return; }
  if (url.origin !== location.origin && !FONTS.test(url.hostname)) return;   // Google girişi: tarayıcıya bırak
  if ((url.origin === location.origin && STATIC.test(url.pathname)) || FONTS.test(url.hostname)) {
    e.respondWith(cacheFirst(e));
    return;
  }
  // Uygulama dosyaları: önce telefondaki kopya (anında açılır), arkada sunucudan tazelenir.
  // Her yayında CACHE sürümü değiştiği için yeni sürüm kurulumda bütünüyle iner; dosyalar karışmaz.
  const ag = fetch(e.request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  });
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => {
    if (hit) { e.waitUntil(ag.then(() => {}, () => {})); return hit; }
    return ag.catch(() => caches.match('./index.html'));
  }));
});

// ---- Uygulama içi bildirim (Pi'den Web Push)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Ev Enerji', body: e.data ? e.data.text() : '' }; }
  const url = new URL(d.url || './', self.registration.scope).href;
  e.waitUntil(self.registration.showNotification(d.title || 'Ev Enerji', {
    body: d.body || '', tag: d.tag, renotify: true, timestamp: d.ts || Date.now(),
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', lang: 'tr',
    requireInteraction: (d.oncelik || 3) >= 5,
    data: { url }, actions: d.buton ? [{ action: 'ac', title: d.buton }] : [],
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || self.registration.scope;
  e.waitUntil((async () => {
    const pencereler = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = pencereler.find((c) => c.url.startsWith(self.registration.scope));
    if (w) {
      await w.focus();
      try { await w.navigate(url); } catch { w.postMessage({ tip: 'git', url }); }
      return;
    }
    await self.clients.openWindow(url);
  })());
});
