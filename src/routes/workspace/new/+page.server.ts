import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createWorkspaceForUser } from '$lib/server/services/workspaces';
import { setSessionWorkspace } from '$lib/server/auth/session';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user || !locals.sessionToken) redirect(303, '/login');
		const f = await request.formData();
		const workspaceName = String(f.get('workspaceName') ?? '');
		let workspaceId: string;
		try {
			const res = await createWorkspaceForUser(locals.user.id, workspaceName);
			workspaceId = res.workspaceId;
		} catch (e) {
			logger.error('workspace_create_failed', e, { userId: locals.user.id });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		await setSessionWorkspace(locals.sessionToken, workspaceId);
		redirect(303, '/imputation');
	}
};
