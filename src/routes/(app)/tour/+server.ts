import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markTutorialSeen } from '$lib/server/services/accounts';

/** Appelé par le tour (fin ou "passer") — pas de body, juste un marqueur "vu" côté compte. */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Non authentifié.');
	await markTutorialSeen(locals.user.id);
	return json({ ok: true });
};
