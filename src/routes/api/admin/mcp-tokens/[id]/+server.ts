import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { mcpToken } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (locals.role !== 'ADMIN') error(403, 'Réservé aux admins.');
	const rows = await db
		.update(mcpToken)
		.set({ revokedAt: new Date() })
		.where(eq(mcpToken.id, params.id))
		.returning({ id: mcpToken.id });
	if (!rows.length) error(404, 'Token introuvable');
	return json({ ok: true });
};
