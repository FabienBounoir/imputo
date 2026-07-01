import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { setPasswordSchema } from '$lib/server/validation/auth';
import { getTokenTarget, setPasswordWithToken } from '$lib/server/services/accounts';
import { listMembershipsForUser } from '$lib/server/services/workspaces';
import { createSession, setSessionCookie } from '$lib/server/auth/session';

export const load: PageServerLoad = async ({ params }) => {
	const target = await getTokenTarget(params.token);
	if (!target) return { invalid: true, email: null };
	return { invalid: false, email: target.email };
};

export const actions: Actions = {
	default: async ({ request, params, cookies }) => {
		const target = await getTokenTarget(params.token);
		if (!target) return fail(400, { error: 'Lien invalide ou expiré.' });

		const form = Object.fromEntries(await request.formData());
		const parsed = setPasswordSchema.safeParse(form);
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		const ok = await setPasswordWithToken(params.token, parsed.data.password);
		if (!ok) return fail(400, { error: 'Lien invalide ou expiré.' });

		const memberships = await listMembershipsForUser(target.userId);
		const { token, expiresAt } = await createSession(target.userId, memberships[0]?.workspaceId ?? null);
		setSessionCookie(cookies, token, expiresAt);
		redirect(303, '/imputation');
	}
};
