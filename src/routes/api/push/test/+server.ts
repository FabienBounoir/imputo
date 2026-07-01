import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendToUser } from '$lib/server/services/push';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Non authentifié.');
	const n = await sendToUser(locals.user.id, {
		title: 'Imputo — test',
		body: 'Les notifications fonctionnent 🎉',
		url: '/imputation'
	});
	return json({ ok: true, sent: n });
};
