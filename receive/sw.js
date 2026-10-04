// Retire the old offline sharing cache. New pages do not register a worker.
// Asset version: 9e17d5e035b071ac
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('nosus-receive-'))await caches.delete(key);await self.clients.claim();await self.registration.unregister();})()));
