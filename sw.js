var CACHE_NAME = 'budget-app-v5';
var ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(ASSETS); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// Network-first：有網路時一定拿最新版本（開發中常常改東西，不想要使用者卡在舊快取），
// 只有離線的時候才退回用快取，離線可用這件事還是保留。
// cache: 'no-store' 是關鍵——沒有這個，下面這個 fetch() 還是會被瀏覽器自己的 HTTP 快取
// 擋下來，只要 Firebase Hosting 回應的快取期限還沒到，就會直接吃到舊版本、根本不會真的發出
// 網路請求，導致「network-first」名不符實。這在有分頁手動重新整理可以繞過的 Safari 分頁裡
// 不明顯，但在沒有「重新整理」動作、單純靠開啟就觸發 fetch 的加到主畫面 PWA 模式下特別嚴重
// （2026-08-13 使用者回報：加到主畫面的 App 完全關閉等好幾分鐘還是打不到最新版，重新加入
// 主畫面才會正確更新，就是這個問題）。
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).then(function (res) {
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(event.request);
    })
  );
});
