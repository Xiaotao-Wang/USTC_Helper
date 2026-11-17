var VERSION = 'tao-table-v17';
var ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './ustc-timetable.user.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return Promise.all(ASSETS.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' }));
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== VERSION) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    var bare = req.url.split('?')[0].split('#')[0];
    var shell = new URL('./index.html', self.location).href;
    var root = new URL('./', self.location).href;
    if (bare === shell || bare === root) {
      e.respondWith(
        caches.match('./index.html').then(function (hit) {
          var net = fetch(req).then(function (res) {
            if (res && res.ok) {
              var copy = res.clone();
              caches.open(VERSION).then(function (c) { c.put('./index.html', copy); });
            }
            return res;
          }).catch(function () { return hit; });
          return hit || net;
        })
      );
      return;
    }
  }

  if (url.pathname.slice(-8) === '.user.js') {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});