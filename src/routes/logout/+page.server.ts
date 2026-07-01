import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { invalidateSession, deleteSessionCookie } from '$lib/server/auth/session';

export const actions: Actions = {
	default: async ({ locals, cookies }) => {
		if (locals.sessionToken) await invalidateSession(locals.sessionToken);
		deleteSessionCookie(cookies);
		redirect(303, '/login');
	}
};
