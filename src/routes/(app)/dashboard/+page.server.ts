import type { PageServerLoad } from './$types';
import { getDashboard } from '$lib/server/services/dashboard';

export const load: PageServerLoad = async ({ locals }) => {
	const ws = locals.workspace!;
	return { dashboard: await getDashboard(ws.workspaceId) };
};
