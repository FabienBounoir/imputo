import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getRefData } from '$lib/server/services/tickets';
import { getActivitySynthesisView } from '$lib/server/services/activitySynthesis';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.role !== 'ADMIN') redirect(303, '/imputation');
	const ws = locals.workspace!;

	const filters = {
		projectId: url.searchParams.get('project') || undefined,
		sprintId: url.searchParams.get('sprint') || undefined,
		versionId: url.searchParams.get('version') || undefined,
		sspId: url.searchParams.get('ssp') || undefined,
		groupId: url.searchParams.get('group') || undefined
	};

	const [ref, view] = await Promise.all([getRefData(ws.workspaceId), getActivitySynthesisView(ws.workspaceId, filters)]);

	return { ref, view, filters };
};
