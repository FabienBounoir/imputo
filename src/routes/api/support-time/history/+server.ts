import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTimeEntriesPage } from '$lib/server/services/supportTime';

const isISODate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Page suivante (scroll infini) de /support/historique — jamais la première page, déjà fournie par le load. */
export const GET: RequestHandler = async ({ locals, url }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');
	if (locals.role !== 'ADMIN') error(403, 'Réservé aux admins.');

	const qFrom = url.searchParams.get('from');
	const qTo = url.searchParams.get('to');
	const from = isISODate(qFrom) ? qFrom : undefined;
	const to = isISODate(qTo) ? qTo : undefined;
	const userId = url.searchParams.get('userId') || undefined;

	const cursorDay = url.searchParams.get('cursorDay');
	const cursorCreatedAt = url.searchParams.get('cursorCreatedAt');
	const cursorId = url.searchParams.get('cursorId');
	const cursor = cursorDay && cursorCreatedAt && cursorId ? { day: cursorDay, createdAt: cursorCreatedAt, id: cursorId } : undefined;

	const page = await listTimeEntriesPage(ws.workspaceId, { from, to, userId }, { cursor, limit: 50 });
	return json(page);
};
