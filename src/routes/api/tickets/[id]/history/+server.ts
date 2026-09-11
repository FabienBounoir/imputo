import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listEntityHistory } from '$lib/server/services/changeLog';
import { ADMIN_ONLY_FIELDS } from '$lib/server/services/tickets';
import { isManagerOrAdmin } from '$lib/server/services/workspaces';

export const GET: RequestHandler = async ({ locals, params }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');
	const entries = await listEntityHistory(ws.workspaceId, 'TICKET', params.id);
	// Même redaction que getTicketById : Estimation prév. / Enveloppe totale (niveau ticket) réservées
	// MANAGER/ADMIN — l'historique ne doit pas révéler ce que la modal masque. Le budget par activité
	// reste lisible de tous (cf. listTicketsPage), donc pas filtré ici non plus.
	const visible = isManagerOrAdmin(locals.role)
		? entries
		: entries.filter((e) => e.activityId || !ADMIN_ONLY_FIELDS.has(e.field ?? ''));
	return json({ entries: visible });
};
