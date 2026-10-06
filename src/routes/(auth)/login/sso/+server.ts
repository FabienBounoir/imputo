import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ssoEnabled } from '$lib/server/config';
import { OIDC_COOKIE, buildAuthorizationUrl } from '$lib/server/auth/oidc';
import { logger } from '$lib/server/logger';

export const GET: RequestHandler = async ({ cookies }) => {
	if (!ssoEnabled()) error(404);
	let target: string;
	try {
		const { url, pending } = await buildAuthorizationUrl();
		cookies.set(OIDC_COOKIE, JSON.stringify(pending), {
			path: '/auth/callback',
			httpOnly: true,
			sameSite: 'lax', // envoyé sur le retour top-level GET depuis le fournisseur
			secure: process.env.NODE_ENV === 'production',
			maxAge: 600
		});
		target = url;
	} catch (e) {
		logger.error('sso_start_failed', e);
		redirect(303, '/login?sso=error');
	}
	redirect(303, target);
};
