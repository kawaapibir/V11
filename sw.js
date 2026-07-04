// ⚠️ UBAH CACHE_VERSION SETIAP UPDATE BESAR DI index.html
// Setiap kali index.html / sw.js diubah secara signifikan, naikkan angka di
// CACHE_VERSION (misal 'v2' -> 'v3'). Ini memaksa browser membuang cache lama
// dan fetch ulang semua asset, karena nama cache jadi berbeda.
const CACHE_VERSION = 'v12';
const CACHE_NAME = `hybridath-cache-${CACHE_VERSION}`;

// Semua asset yang wajib di-cache saat install supaya app 100% bisa offline.
// Path relatif (./) karena di-host di subfolder GitHub Pages, bukan di root domain.
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './sw.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

// Halaman fallback super-simple, dipakai kalau request gagal total dan
// tidak ada apa pun di cache yang cocok (misal navigasi ke URL asing saat offline).
const OFFLINE_FALLBACK_HTML = `
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Offline - Hybrid Athlete OS</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#121212;color:#e0e0e0;font-family:-apple-system,system-ui,sans-serif;text-align:center;padding:24px;}
  .box{max-width:320px;}
  .icon{font-size:56px;margin-bottom:16px;}
  h1{color:#39FF14;font-size:20px;margin:0 0 8px;}
  p{font-size:14px;color:#999;line-height:1.5;}
  button{margin-top:20px;padding:12px 24px;background:#39FF14;color:#121212;border:none;
    border-radius:8px;font-weight:700;font-size:14px;}
</style>
</head>
<body>
  <div class="box">
    <div class="icon">📡</div>
    <h1>Halaman tidak tersedia offline</h1>
    <p>Konten ini belum sempat tersimpan di cache. Sambungkan ke internet sekali untuk memuatnya, lalu coba lagi.</p>
    <button onclick="location.reload()">Coba Lagi</button>
  </div>
</body>
</html>
`;

// ============================================================
// INSTALL EVENT
// Dijalankan sekali saat service worker pertama kali terpasang.
// Membuka cache baru dan menyimpan semua asset inti (cache warming),
// supaya begitu install selesai, app sudah bisa langsung dipakai offline.
// ============================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // addAll akan gagal total jika SATU saja request gagal,
        // jadi kita pakai pendekatan per-item yang lebih toleran.
        return Promise.all(
          ASSETS_TO_CACHE.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('[SW] Gagal cache asset:', url, err);
            })
          )
        );
      })
    // FIX: dulu self.skipWaiting() dipanggil otomatis di sini — jadi versi
    // baru langsung ambil alih PAKSA tanpa user sempat lihat/setuju notif
    // "update tersedia" di halaman (banner-nya kelewat, langsung ke-reload).
    // Sekarang worker baru menunggu di state 'waiting' sampai user sendiri
    // tap tombol "Muat Ulang" di halaman, yang kirim pesan SKIP_WAITING ke sini.
  );
});

// Menunggu sinyal dari halaman (dikirim saat user tap "Muat Ulang" di banner
// update) sebelum service worker baru benar-benar ambil alih.
self.addEventListener('message', (event) => {
  if(event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ============================================================
// ACTIVATE EVENT
// Dijalankan setelah install sukses. Tugas utamanya: bersihkan
// cache versi lama (dari CACHE_VERSION sebelumnya) supaya storage
// tidak menumpuk dan tidak ada asset basi yang nyangkut.
// ============================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith('hybridath-cache-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => {
        // Ambil kendali atas semua tab yang sedang terbuka tanpa perlu reload manual.
        return self.clients.claim();
      })
  );
});

// ============================================================
// FETCH EVENT
// Strategi: CACHE-FIRST untuk semua asset statis.
// 1) Coba ambil dari cache dulu -> kalau ada, langsung balas (instan, offline-safe).
// 2) Kalau tidak ada di cache, coba fetch ke network.
// 3) Kalau berhasil dari network, simpan copy-nya ke cache (cache warming dinamis)
//    supaya request berikutnya tetap instan & offline-ready.
// 4) Kalau network juga gagal (offline & tidak ada di cache) -> fallback:
//    - untuk navigasi halaman: tampilkan OFFLINE_FALLBACK_HTML
//    - untuk request lain: balas response error sederhana
// ============================================================
self.addEventListener('fetch', (event) => {
  // Hanya tangani request GET; biarkan method lain lewat secara normal.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          // Hanya cache response yang valid (status 200, tipe basic/same-origin).
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
          ) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Network gagal total (offline) dan tidak ada di cache.
          if (event.request.mode === 'navigate') {
            return new Response(OFFLINE_FALLBACK_HTML, {
              headers: { 'Content-Type': 'text/html; charset=UTF-8' }
            });
          }
          return new Response('Offline: resource tidak tersedia.', {
            status: 503,
            statusText: 'Offline',
            headers: { 'Content-Type': 'text/plain; charset=UTF-8' }
          });
        });
    })
  );
});
