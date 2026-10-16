/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';
// Dupliqué de $lib/wrappedCopy.ts (vérifié par wrappedCopy.test.ts) : un import de $lib dans le service
// worker casse l'app sous `vite dev` (le SW est servi comme module), donc tous les e2e du CI.
const WRAPPED_MUSIC = '/wrapped_music.mp3';
const WRAPPED_MUSIC_CACHE = 'imputo-wrapped-music';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `imputo-cache-${version}`;
// Ressources à précacher : bundles de l'app (build) + fichiers statiques (icônes, manifeste…), sauf la
// musique du Wrapped qui a son propre cache (cf. WRAPPED_MUSIC).
const PRECACHE = [...build, ...files.filter((f) => f !== WRAPPED_MUSIC)];
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
			for (const key of await caches.keys()) if (key !== CACHE && key !== WRAPPED_MUSIC_CACHE) await caches.delete(key);
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
	// Musique du Wrapped : depuis son cache s'il est rempli, sinon réseau. ignoreVary : en prod, les
	// fichiers statiques portent « Vary: Accept-Encoding », et le lecteur audio n'envoie pas le même
	// en-tête que le fetch qui l'a mise en cache.
	if (url.pathname === WRAPPED_MUSIC) {
		event.respondWith(caches.match(request, { ignoreVary: true }).then((cached) => cached ?? fetch(request)));
	}
	// Tout le reste (HTML / données dynamiques sous auth) : réseau direct, jamais mis en cache.
});
