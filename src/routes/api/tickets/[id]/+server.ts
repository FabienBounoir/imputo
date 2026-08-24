import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTicketById, countTicketImputations } from '$lib/server/services/tickets';
import { isManagerOrAdmin } from '$lib/server/services/workspaces';

// Utilisé pour ouvrir la modal d'édition de ticket depuis une page qui n'a pas déjà la liste
// complète chargée (ex. Mon imputation) — cf. tickets/+page.svelte qui édite depuis `data.tickets`.
export const GET: RequestHandler = async ({ locals, params }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');
	const ticket = await getTicketById(ws.workspaceId, params.id, ws.testPhase, isManagerOrAdmin(locals.role));
	if (!ticket) error(404, 'Ticket introuvable.');
	// imputationCount : sert uniquement à la modal d'édition pour savoir si la suppression (réservée
	// au créateur de l'espace ou à un ADMIN) doit être bloquée — cf. TicketEditModal.svelte.
	const imputationCount = await countTicketImputations(ws.workspaceId, params.id);
	return json({ ...ticket, imputationCount });
};
