// Çevrimdışı önbellek (yalnız uygulama dosyaları; Firebase verisi önbelleğe alınmaz).
const CACHE = 'evenerji-v24';
const ASSETS = [
  './', './index.html', './manifest.json', './css/app.css', './vendor/echarts.min.js',
  './js/app.js', './js/data.js', './js/demo.js', './js/model.js', './js/tariff.js', './js/ui.js', './js/charts.js',
  './js/views/pano.js', './js/views/togg.js', './js/views/ev.js', './js/views/cihazlar.js', './js/views/sarici.js', './js/views/ayarlar.js',
  './img/t10x.webp', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname.endsWith('firebasedatabase.app')) return;
  e.respondWith(
    // no-cache: tarayıcı önbelleğindeki eski modülle yenisi karışmasın (sunucuya doğrulatır)
    fetch(e.request, url.origin === location.origin ? { cache: 'no-cache' } : undefined)
      .then((res) => {
        if (res.ok && url.origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
