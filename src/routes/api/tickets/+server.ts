import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTicketsPage, type TicketFilters } from '$lib/server/services/tickets';
import { isManagerOrAdmin } from '$lib/server/services/workspaces';

const PAGE_SIZE = 50;

// Pages suivantes du tableau tickets (scroll infini) — mêmes filtres/tri que
// +page.server.ts, appelé côté client pour ajouter une page sans recharger la liste.
export const GET: RequestHandler = async ({ locals, url }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');
	const isAdmin = isManagerOrAdmin(locals.role);
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const filters: TicketFilters = {
		query: url.searchParams.get('q') ?? undefined,
		stateId: url.searchParams.get('state') ?? undefined,
		projectId: url.searchParams.get('project') ?? undefined,
		sprintId: url.searchParams.get('sprint') ?? undefined,
		versionId: url.searchParams.get('version') ?? undefined
	};
	const { rows: tickets, total } = await listTicketsPage(
		ws.workspaceId,
		ws.testPhase,
		isAdmin,
		filters,
		{ pageSize: PAGE_SIZE, page }
	);
	return json({ tickets, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
};
