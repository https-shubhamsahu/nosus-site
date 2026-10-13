// Device sharing on nosus.foo was retired in 1.7.0. A browser that still has
// the old receiver's worker fetches this file, removes the old cache and
// unregisters, so /receive/ reaches the redirect page.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('nosus-receive-'))await caches.delete(key);await self.clients.claim();await self.registration.unregister();})()));
