import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ssoEnabled } from '$lib/server/config';
import { OIDC_COOKIE, exchangeCode, type OidcPending } from '$lib/server/auth/oidc';
import { findSsoUser } from '$lib/server/services/accounts';
import { listMembershipsForUser } from '$lib/server/services/workspaces';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { logger } from '$lib/server/logger';

export const GET: RequestHandler = async ({ url, cookies }) => {
	if (!ssoEnabled()) error(404);

	const raw = cookies.get(OIDC_COOKIE);
	cookies.delete(OIDC_COOKIE, { path: '/auth/callback' });
	let pending: OidcPending | null = null;
	try {
		pending = raw ? JSON.parse(raw) : null;
	} catch {
		/* cookie altéré : traité comme absent */
	}
	const code = url.searchParams.get('code');
	if (!pending || !code || url.searchParams.get('state') !== pending.state) {
		logger.warn('sso_callback_invalid', { providerError: url.searchParams.get('error') ?? undefined });
		redirect(303, '/login?sso=error');
	}

	let email: string | null;
	try {
		email = await exchangeCode(code, pending);
	} catch (e) {
		logger.error('sso_exchange_failed', e);
		redirect(303, '/login?sso=error');
	}
	if (!email) redirect(303, '/login?sso=error');

	const found = await findSsoUser(email);
	if (!found) {
		logger.warn('sso_unknown_user', { email });
		redirect(303, '/login?sso=unknown');
	}

	logger.info('login_success', { userId: found.userId, method: 'sso' });
	const memberships = await listMembershipsForUser(found.userId);
	const { token, expiresAt } = await createSession(found.userId, memberships[0]?.workspaceId ?? null);
	setSessionCookie(cookies, token, expiresAt);
	redirect(303, '/imputation');
};
