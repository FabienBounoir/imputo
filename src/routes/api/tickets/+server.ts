import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTicketsPage, ticketFiltersFromUrl } from '$lib/server/services/tickets';
import { isManagerOrAdmin } from '$lib/server/services/workspaces';

const PAGE_SIZE = 50;

// Pages suivantes du tableau tickets (scroll infini) — mêmes filtres/tri que
// +page.server.ts, appelé côté client pour ajouter une page sans recharger la liste.
export const GET: RequestHandler = async ({ locals, url }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');
	const isAdmin = isManagerOrAdmin(locals.role);
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const { filters, sort } = ticketFiltersFromUrl(url, locals.user.id);
	const { rows: tickets, total } = await listTicketsPage(
		ws.workspaceId,
		ws.testPhase,
		isAdmin,
		filters,
		{ pageSize: PAGE_SIZE, page },
		true,
		sort
	);
	return json({ tickets, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
};
