import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { loginSchema } from '$lib/server/validation/auth';
import { login } from '$lib/server/services/accounts';
import { listMembershipsForUser } from '$lib/server/services/workspaces';
import { createSession, setSessionCookie } from '$lib/server/auth/session';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/imputation');
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const form = Object.fromEntries(await request.formData());
		const parsed = loginSchema.safeParse(form);
		if (!parsed.success)
			return fail(400, { error: parsed.error.issues[0].message, values: { email: form.email } });

		const res = await login(parsed.data.email, parsed.data.password);
		if (!res) return fail(400, { error: 'Email ou mot de passe incorrect.', values: { email: form.email } });

		const memberships = await listMembershipsForUser(res.userId);
		const { token, expiresAt } = await createSession(res.userId, memberships[0]?.workspaceId ?? null);
		setSessionCookie(cookies, token, expiresAt);
		redirect(303, '/imputation');
	}
};
