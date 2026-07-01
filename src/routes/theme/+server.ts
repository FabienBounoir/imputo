import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setThemePref } from '$lib/server/services/accounts';

const VALID = ['LIGHT', 'DARK', 'SYSTEM'] as const;

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Non authentifié.');
	const { pref } = await request.json().catch(() => ({ pref: null }));
	if (!VALID.includes(pref)) error(400, 'Préférence invalide.');
	await setThemePref(locals.user.id, pref);
	return json({ ok: true });
};
