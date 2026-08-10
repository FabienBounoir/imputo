import type { Handle } from '@sveltejs/kit';
import {
	SESSION_COOKIE,
	validateSession,
	deleteSessionCookie,
	setSessionWorkspace
} from '$lib/server/auth/session';
import { listMembershipsForUser, getDeactivatedWorkspace } from '$lib/server/services/workspaces';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.sessionToken = null;
	event.locals.memberships = [];
	event.locals.workspace = null;
	event.locals.role = null;
	event.locals.canViewImputations = false;
	event.locals.canViewMoodResults = false;
	event.locals.deactivatedWorkspace = null;

	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const { session, user } = await validateSession(token);
		if (session && user) {
			event.locals.sessionToken = token;
			event.locals.user = {
				id: user.id,
				displayName: user.displayName,
				email: user.email,
				themePref: user.themePref,
				accentMode: user.accentMode,
				accentColor: user.accentColor
			};

			const memberships = await listMembershipsForUser(user.id);
			event.locals.memberships = memberships;

			// Détermine l'espace courant (celui de la session, sinon le premier).
			let current = memberships.find((m) => m.workspaceId === session.workspaceId) ?? null;
			if (!current) {
				// L'espace de session n'est pas un espace actif : soit l'utilisateur y a été
				// désactivé (on l'en informe), soit l'espace est obsolète (on bascule).
				const deactivated = session.workspaceId
					? await getDeactivatedWorkspace(session.workspaceId, user.id)
					: null;
				if (deactivated) {
					event.locals.deactivatedWorkspace = deactivated;
				} else if (memberships.length > 0) {
					current = memberships[0];
					await setSessionWorkspace(token, current.workspaceId);
				}
			}
			event.locals.workspace = current;
			event.locals.role = current?.role ?? null;
			event.locals.canViewImputations = current?.canViewImputations ?? false;
			event.locals.canViewMoodResults = current?.canViewMoodResults ?? false;
		} else {
			deleteSessionCookie(event.cookies);
		}
	}

	return resolve(event);
};
