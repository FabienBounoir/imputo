import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTicketsPage } from '$lib/server/services/tickets';
import { isManagerOrAdmin } from '$lib/server/services/workspaces';

/** Recherche ticket (clé/titre) pour la palette de commandes — quelques résultats, pas de pagination. */
export const GET: RequestHandler = async ({ locals, url }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');

	const q = url.searchParams.get('q')?.trim() ?? '';
	if (q.length < 2) return json({ tickets: [] });

	const { rows } = await listTicketsPage(
		ws.workspaceId,
		ws.testPhase,
		isManagerOrAdmin(locals.role),
		{ query: q },
		{ pageSize: 8, page: 1 }
	);
	return json({ tickets: rows.map((t) => ({ id: t.id, key: t.key, title: t.title })) });
};
