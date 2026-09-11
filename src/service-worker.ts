/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `imputo-cache-${version}`;
// Ressources à précacher : bundles de l'app (build) + fichiers statiques (icônes, manifeste…).
const PRECACHE = [...build, ...files];
const PRECACHE_SET = new Set(PRECACHE);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
			await sw.clients.claim();
		})()
	);
});

// --- Web Push : réception + clic ---
sw.addEventListener('push', (event) => {
	let data: { title?: string; body?: string; url?: string; tag?: string } = {};
	try {
		if (event.data) data = event.data.json();
	} catch {
		/* payload non-JSON : on ignore */
	}
	const title = data.title ?? 'Imputo';
	event.waitUntil(
		sw.registration.showNotification(title, {
			body: data.body ?? '',
			icon: '/icons/icon-192.png',
			badge: '/icons/icon-192.png',
			tag: data.tag,
			data: { url: data.url ?? '/' }
		})
	);
});

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = (event.notification.data && event.notification.data.url) || '/';
	event.waitUntil(
		(async () => {
			const all = (await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })) as WindowClient[];
			// Onglet Imputo déjà ouvert : on le réutilise (le visible en priorité) au lieu d'en ouvrir un
			// nouveau, et c'est l'app qui navigue (goto, sans rechargement, cf. (app)/+layout.svelte).
			// ponytail: un onglet hors espace connecté (ex. /login) ignore le message et reste où il est ;
			// repli sur client.navigate(url) si ça pose problème.
			const client = all.find((c) => c.visibilityState === 'visible') ?? all[0];
			if (!client) {
				await sw.clients.openWindow(url);
				return;
			}
			await client.focus();
			client.postMessage({ type: 'notification-click', url });
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	// Assets buildés / statiques : cache d'abord (immuables, versionnés).
	if (PRECACHE_SET.has(url.pathname)) {
		event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
	}
	// Tout le reste (HTML / données dynamiques sous auth) : réseau direct, jamais mis en cache.
});
