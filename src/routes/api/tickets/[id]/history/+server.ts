import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listEntityHistory } from '$lib/server/services/changeLog';

export const GET: RequestHandler = async ({ locals, params }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');
	const entries = await listEntityHistory(ws.workspaceId, 'TICKET', params.id);
	return json({ entries });
};
