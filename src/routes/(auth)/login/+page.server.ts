import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { loginSchema } from '$lib/server/validation/auth';
import { login } from '$lib/server/services/accounts';
import { listMembershipsForUser } from '$lib/server/services/workspaces';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { logger } from '$lib/server/logger';
import { passwordEnabled, ssoEnabled } from '$lib/server/config';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, '/imputation');
	const sso = url.searchParams.get('sso');
	return {
		passwordEnabled: passwordEnabled(),
		ssoEnabled: ssoEnabled(),
		ssoError:
			sso === 'unknown'
				? "Ce compte n'a pas d'accès à Imputo. Demandez une invitation à l'admin de votre espace."
				: sso === 'error'
					? 'La connexion SSO a échoué. Réessayez.'
					: null
	};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		if (!passwordEnabled()) return fail(403, { error: 'Connexion par mot de passe désactivée.', values: { email: '' } });
		const form = Object.fromEntries(await request.formData());
		const parsed = loginSchema.safeParse(form);
		if (!parsed.success)
			return fail(400, { error: parsed.error.issues[0].message, values: { email: form.email } });

		const res = await login(parsed.data.email, parsed.data.password);
		if (res && 'locked' in res) {
			// Rate-limit atteint : signal plus fort qu'un simple échec, cible potentielle de brute-force.
			logger.warn('login_rate_limited', { email: parsed.data.email });
			return fail(429, {
				error: 'Trop de tentatives. Réessayez plus tard.',
				retryAfterMs: res.retryAfterMs,
				values: { email: form.email }
			});
		}
		if (!res) {
			logger.warn('login_failed', { email: parsed.data.email });
			return fail(400, { error: 'Email ou mot de passe incorrect.', values: { email: form.email } });
		}

		logger.info('login_success', { userId: res.userId });
		const memberships = await listMembershipsForUser(res.userId);
		const { token, expiresAt } = await createSession(res.userId, memberships[0]?.workspaceId ?? null);
		setSessionCookie(cookies, token, expiresAt);
		redirect(303, '/imputation');
	}
};
