import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { setSessionWorkspace } from '$lib/server/auth/session';

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.sessionToken) redirect(303, '/login');
		const form = await request.formData();
		const workspaceId = String(form.get('workspaceId') ?? '');
		// Anti-fuite : on ne bascule que vers un espace dont l'utilisateur est membre.
		const allowed = locals.memberships.some((m) => m.workspaceId === workspaceId);
		if (!allowed) return fail(403, { error: 'Espace non autorisé.' });
		await setSessionWorkspace(locals.sessionToken, workspaceId);
		redirect(303, '/imputation');
	}
};
