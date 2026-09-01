import webpush from 'web-push';
import { and, eq } from 'drizzle-orm';
import { db, pushSubscription } from '$lib/server/db';
import { config } from '$lib/server/config';
import { logger } from '$lib/server/logger';

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

// Hôtes des services push des navigateurs supportés — un `endpoint` en dehors de cette liste ne
// peut être qu'une cible forgée (SSRF : le serveur y enverrait ensuite une requête authentifiée
// VAPID via sendToUser), jamais un vrai abonnement Push API.
const ALLOWED_PUSH_HOSTS = [
	'fcm.googleapis.com', // Chrome / Edge / autres navigateurs Chromium
	'updates.push.services.mozilla.com', // Firefox
	'web.push.apple.com', // Safari
	'notify.windows.com' // Edge legacy / WNS — sous-domaines en *.notify.windows.com
];

function isAllowedPushEndpoint(endpoint: string): boolean {
	let host: string;
	try {
		host = new URL(endpoint).hostname;
	} catch {
		return false;
	}
	return ALLOWED_PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

let configured: boolean | null = null;
/** Initialise VAPID une fois ; renvoie false si les clés ne sont pas configurées. */
function ensureVapid(): boolean {
	if (configured !== null) return configured;
	configured = Boolean(config.vapidPublic && config.vapidPrivate);
	if (configured) webpush.setVapidDetails(config.vapidSubject, config.vapidPublic, config.vapidPrivate);
	else logger.warn('push_vapid_not_configured');
	return configured;
}

export async function saveSubscription(
	userId: string,
	sub: { endpoint: string; keys: { p256dh: string; auth: string } },
	userAgent: string | null
) {
	if (!isAllowedPushEndpoint(sub.endpoint)) throw new Error('Point de terminaison push non autorisé.');
	await db
		.insert(pushSubscription)
		.values({
			userId,
			endpoint: sub.endpoint,
			p256dh: sub.keys.p256dh,
			auth: sub.keys.auth,
			userAgent
		})
		.onConflictDoUpdate({
			target: pushSubscription.endpoint,
			set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, lastSeenAt: new Date(), failureCount: 0 }
		});
}

export async function removeSubscription(userId: string, endpoint: string) {
	await db
		.delete(pushSubscription)
		.where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpoint, endpoint)));
}

export async function hasSubscription(userId: string): Promise<boolean> {
	const r = await db
		.select({ id: pushSubscription.id })
		.from(pushSubscription)
		.where(eq(pushSubscription.userId, userId))
		.limit(1);
	return r.length > 0;
}

/** Envoie une notif à toutes les subscriptions d'un utilisateur. Renvoie le nb d'envois réussis. */
export async function sendToUser(userId: string, payload: PushPayload): Promise<number> {
	if (!ensureVapid()) return 0;
	const subs = await db.select().from(pushSubscription).where(eq(pushSubscription.userId, userId));
	const body = JSON.stringify(payload);
	let ok = 0;
	for (const s of subs) {
		try {
			await webpush.sendNotification(
				{ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
				body
			);
			ok++;
		} catch (e) {
			const code = (e as { statusCode?: number }).statusCode;
			if (code === 404 || code === 410) {
				await db.delete(pushSubscription).where(eq(pushSubscription.id, s.id)); // subscription expirée
			} else if (s.failureCount + 1 >= 5) {
				logger.warn('push_subscription_dropped', { userId, statusCode: code, failureCount: s.failureCount + 1 });
				await db.delete(pushSubscription).where(eq(pushSubscription.id, s.id));
			} else {
				logger.error('push_send_failed', e, { userId, statusCode: code, failureCount: s.failureCount + 1 });
				await db
					.update(pushSubscription)
					.set({ failureCount: s.failureCount + 1 })
					.where(eq(pushSubscription.id, s.id));
			}
		}
	}
	return ok;
}
