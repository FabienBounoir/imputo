import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTicketActivityBreakdown, upsertTicketActivityRae } from '$lib/server/services/tickets';

// GET retiré : le détail par activité est désormais chargé eagerly avec la liste des tickets
// (listTickets), les lignes fines sont toujours visibles — plus besoin d'un fetch à l'ouverture.
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const ws = locals.workspace;
	if (!ws) error(401, 'Non authentifié.');
	const body = await request.json().catch(() => null);
	const activityId = body?.activityId;
	const field = body?.field;
	const value = Number(body?.value);
	if (typeof activityId !== 'string' || (field !== 'raeReal' && field !== 'raeTest') || !Number.isFinite(value))
		error(400, 'Données invalides.');
	try {
		await upsertTicketActivityRae(ws.workspaceId, params.id, activityId, field, value);
		const rows = await getTicketActivityBreakdown(ws.workspaceId, params.id);
		return json({ rows });
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Erreur.');
	}
};
