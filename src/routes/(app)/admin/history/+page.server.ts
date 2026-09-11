import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listWorkspaceHistoryPage } from '$lib/server/services/changeLog';
import { config } from '$lib/server/config';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.role !== 'ADMIN') redirect(303, '/imputation');
	const ws = locals.workspace!;
	const page = await listWorkspaceHistoryPage(ws.workspaceId);
	return {
		entries: page.entries,
		nextCursor: page.nextCursor,
		windowDays: Math.round(config.changeLogRetentionMs / 86400000)
	};
};
