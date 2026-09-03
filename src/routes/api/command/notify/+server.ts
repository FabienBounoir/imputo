import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db, membership } from '$lib/server/db';
import { sendAdminMessage } from '$lib/server/services/notifications';

/** Envoi d'un message libre en notification à un membre (ADMIN, palette de commandes /msg). */
export const POST: RequestHandler = async ({ request, locals }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');
	if (locals.role !== 'ADMIN') error(403, 'Réservé aux admins.');

	const payload = await request.json().catch(() => null);
	const userId = payload?.userId;
	const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
	const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
	if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) error(400, 'Membre invalide.');
	if (!title || !body) error(400, 'Titre et message requis.');
	if (title.length > 60 || body.length > 200) error(400, 'Message trop long.');

	const [member] = await db
		.select({ id: membership.userId })
		.from(membership)
		.where(and(eq(membership.workspaceId, ws.workspaceId), eq(membership.userId, userId), eq(membership.active, true)));
	if (!member) error(404, 'Membre introuvable.');

	const sent = await sendAdminMessage(ws.workspaceName, userId, title, body);
	if (!sent) error(400, "Ce membre n'a pas activé les notifications.");
	return json({ sent: true });
};
