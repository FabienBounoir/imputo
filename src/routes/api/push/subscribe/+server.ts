import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveSubscription } from '$lib/server/services/push';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Non authentifié.');
	const sub = await request.json().catch(() => null);
	if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) error(400, 'Abonnement invalide.');
	try {
		await saveSubscription(locals.user.id, sub, request.headers.get('user-agent'));
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Abonnement invalide.');
	}
	return json({ ok: true });
};
