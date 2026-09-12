import { listMembershipsForUser } from '$lib/server/services/workspaces';
import { loadPerimeterCtx, EMPTY_PERIMETER_CTX } from '$lib/server/services/perimeters';

// Fabrique les objets minimaux dont les handlers +server.ts / +page.server.ts ont besoin, sans
// mocker tout RequestEvent (SvelteKit ne fournit pas de harness de test officiel pour ça, et ses
// handlers ne lisent jamais que quelques champs : locals, params, request, url, cookies).

/** locals.user/workspace/role réels, construits à partir d'un utilisateur/espace créé en DB. */
export async function fakeLocals(userId: string, opts: { email?: string; displayName?: string } = {}) {
	const [membership] = await listMembershipsForUser(userId);
	return {
		user: {
			id: userId,
			displayName: opts.displayName ?? 'Test',
			email: opts.email ?? 'test@acme.test',
			themePref: 'SYSTEM',
			accentMode: 'WORKSPACE',
			accentColor: null
		},
		sessionToken: 'test-session-token',
		memberships: membership ? [membership] : [],
		workspace: membership ?? null,
		role: membership?.role ?? null,
		canViewImputations: membership?.canViewImputations ?? false,
		canViewMoodResults: membership?.canViewMoodResults ?? false,
		deactivatedWorkspace: null,
		// Chargé pour de vrai, comme hooks.server.ts : un contexte périmètre bidon masquerait
		// justement les régressions de droits qu'on veut attraper.
		perimeterCtx: membership
			? await loadPerimeterCtx(membership.workspaceId, userId, membership.role)
			: EMPTY_PERIMETER_CTX
	};
}

/** cookies.{get,set,delete,...} en mémoire, pour les actions qui posent/lisent un cookie de session. */
export function fakeCookies() {
	const store = new Map<string, string>();
	return {
		get: (name: string) => store.get(name),
		getAll: () => [...store.entries()].map(([name, value]) => ({ name, value })),
		set: (name: string, value: string) => store.set(name, value),
		delete: (name: string) => store.delete(name),
		serialize: () => ''
	};
}

/** new Request(...) avec un body FormData, pour appeler une action de +page.server.ts. */
export function formRequest(fields: Record<string, string>, url = 'http://localhost/test') {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return new Request(url, { method: 'POST', body });
}

/** new Request(...) avec un body JSON, pour appeler un handler +server.ts (POST). */
export function jsonRequest(payload: unknown, url = 'http://localhost/test') {
	return new Request(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload)
	});
}
