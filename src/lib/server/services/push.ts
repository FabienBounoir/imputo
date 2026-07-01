import webpush from 'web-push';
import { and, eq } from 'drizzle-orm';
import { db, pushSubscription } from '$lib/server/db';
import { config } from '$lib/server/config';

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

let configured: boolean | null = null;
/** Initialise VAPID une fois ; renvoie false si les clés ne sont pas configurées. */
function ensureVapid(): boolean {
	if (configured !== null) return configured;
	configured = Boolean(config.vapidPublic && config.vapidPrivate);
	if (configured) webpush.setVapidDetails(config.vapidSubject, config.vapidPublic, config.vapidPrivate);
	return configured;
}

export async function saveSubscription(
	userId: string,
	sub: { endpoint: string; keys: { p256dh: string; auth: string } },
	userAgent: string | null
) {
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
				await db.delete(pushSubscription).where(eq(pushSubscription.id, s.id));
			} else {
				await db
					.update(pushSubscription)
					.set({ failureCount: s.failureCount + 1 })
					.where(eq(pushSubscription.id, s.id));
			}
		}
	}
	return ok;
}
