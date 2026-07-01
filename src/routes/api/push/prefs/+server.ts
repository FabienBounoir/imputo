import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db, user } from '$lib/server/db';
import { parseNotifPrefs } from '$lib/server/services/notifications';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Non authentifié.');
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'Préférences invalides.');
	// Normalise via le parseur (ignore les clés inconnues, complète les manquantes).
	const prefs = parseNotifPrefs(JSON.stringify(body));
	await db.update(user).set({ notifPrefs: JSON.stringify(prefs) }).where(eq(user.id, locals.user.id));
	return json({ ok: true, prefs });
};
