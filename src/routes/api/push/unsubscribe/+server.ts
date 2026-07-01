import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeSubscription } from '$lib/server/services/push';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Non authentifié.');
	const { endpoint } = await request.json().catch(() => ({ endpoint: null }));
	if (!endpoint) error(400, 'Endpoint manquant.');
	await removeSubscription(locals.user.id, endpoint);
	return json({ ok: true });
};
