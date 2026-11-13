// Çevrimdışı önbellek (yalnız uygulama dosyaları; Firebase verisi önbelleğe alınmaz).
const CACHE = 'evenerji-v85';
const ASSETS = [
  './', './index.html', './manifest.json', './css/app.css', './vendor/echarts.min.js',
  './js/app.js', './js/data.js', './js/demo.js', './js/model.js', './js/ogrenme.js', './js/tariff.js', './js/ui.js', './js/charts.js', './js/keypad.js', './js/auth.js',
  './js/views/pano.js', './js/views/togg.js', './js/views/ev.js', './js/views/cihazlar.js', './js/views/sarici.js', './js/views/ayarlar.js',
  './img/t10x.webp', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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
