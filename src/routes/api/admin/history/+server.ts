import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listWorkspaceHistoryPage, type ChangeLogEntity } from '$lib/server/services/changeLog';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (locals.role !== 'ADMIN') error(403, 'Réservé aux admins.');
	const ws = locals.workspace!;

	const entityTypeRaw = url.searchParams.get('entityType');
	const entityType: ChangeLogEntity | undefined =
		entityTypeRaw === 'TICKET' || entityTypeRaw === 'ABSENCE' || entityTypeRaw === 'WORKSPACE'
			? entityTypeRaw
			: undefined;
	const query = url.searchParams.get('q') ?? undefined;
	const cursorCreatedAt = url.searchParams.get('cursorCreatedAt');
	const cursorId = url.searchParams.get('cursorId');
	const cursor = cursorCreatedAt && cursorId ? { createdAt: cursorCreatedAt, id: cursorId } : undefined;

	const page = await listWorkspaceHistoryPage(ws.workspaceId, { entityType, query, cursor, limit: 50 });
	return json(page);
};
