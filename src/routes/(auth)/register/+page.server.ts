import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { registerSchema } from '$lib/server/validation/auth';
import { createWorkspaceWithOwner } from '$lib/server/services/workspaces';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/imputation');
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const raw = await request.formData();
		const values = {
			workspaceName: String(raw.get('workspaceName') ?? ''),
			displayName: String(raw.get('displayName') ?? ''),
			email: String(raw.get('email') ?? '')
		};
		const parsed = registerSchema.safeParse({ ...values, password: raw.get('password') });
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message, values });
		}
		const data = parsed.data;

		let userId: string;
		let workspaceId: string;
		try {
			const res = await createWorkspaceWithOwner(data);
			userId = res.userId;
			workspaceId = res.workspaceId;
		} catch (e) {
			logger.error('register_failed', e, { email: data.email, workspaceName: data.workspaceName });
			return fail(400, {
				error: e instanceof Error ? e.message : 'Erreur inattendue',
				values
			});
		}

		const { token, expiresAt } = await createSession(userId, workspaceId);
		setSessionCookie(cookies, token, expiresAt);
		redirect(303, '/imputation');
	}
};
