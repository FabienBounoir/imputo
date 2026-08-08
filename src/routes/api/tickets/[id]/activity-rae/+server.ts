import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	canEditActivityRae,
	getTicketActivityBreakdown,
	upsertTicketActivityRae
} from '$lib/server/services/tickets';

// GET retiré : le détail par activité est désormais chargé eagerly avec la liste des tickets
// (listTickets), les lignes fines sont toujours visibles — plus besoin d'un fetch à l'ouverture.
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');
	const body = await request.json().catch(() => null);
	const activityId = body?.activityId;
	const field = body?.field;
	const value = Number(body?.value);
	if (typeof activityId !== 'string' || (field !== 'raeReal' && field !== 'raeTest') || !Number.isFinite(value))
		error(400, 'Données invalides.');

	// Point de passage unique du RAE par activité (onglet chiffrage ET colonne RAE de Mon
	// imputation) : le contrôle de rôle vit donc ici, pas dans les pages.
	if (!(await canEditActivityRae(ws.workspaceId, locals.user.id, locals.role, params.id, activityId)))
		error(403, 'RAE réservé aux personnes ayant imputé sur cette activité.');

	try {
		await upsertTicketActivityRae(ws.workspaceId, params.id, activityId, field, value, locals.user.id);
		const rows = await getTicketActivityBreakdown(ws.workspaceId, params.id);
		return json({ rows });
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Erreur.');
	}
};
