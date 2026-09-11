import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listMoodResultsPage } from '$lib/server/services/mood';

/**
 * Pages suivantes de la liste des plages Team mood (scroll infini sur /admin/mood).
 * Même garde que la page : ADMIN, ou capacité de lecture accordée indépendamment du rôle
 * (canViewMoodResults). Les messages ne doivent pas fuiter à un membre lambda.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');
	if (locals.role !== 'ADMIN' && !locals.canViewMoodResults) error(403, 'Réservé aux admins.');

	const before = url.searchParams.get('before')?.trim();
	if (!before || !/^\d{4}-\d{2}-\d{2}$/.test(before)) error(400, 'Curseur `before` manquant ou invalide.');

	return json(await listMoodResultsPage(ws.workspaceId, { before }));
};
