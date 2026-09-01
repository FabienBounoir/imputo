import { describe, it, expect } from 'vitest';
import { handle } from './hooks.server';
import { SESSION_COOKIE, createSession } from '$lib/server/auth/session';
import { setMemberActive } from '$lib/server/services/accounts';
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeCookies } from '$lib/server/test-helpers/http';

function fakeEvent(token?: string) {
	const cookies = fakeCookies();
	if (token) cookies.set(SESSION_COOKIE, token);
	return {
		cookies,
		locals: {} as App.Locals,
		request: new Request('http://localhost/'),
		url: new URL('http://localhost/')
	};
}

const resolve = async () => new Response();

describe('hooks.server handle', () => {
	it("sans cookie de session, locals reste vide et n'appelle rien", async () => {
		const event = fakeEvent();
		await handle({ event, resolve } as never);
		expect(event.locals.user).toBeNull();
		expect(event.locals.workspace).toBeNull();
		expect(event.locals.role).toBeNull();
		expect(event.locals.deactivatedWorkspace).toBeNull();
	});

	it('avec une session valide, peuple user/workspace/role', async () => {
		const { userId, workspaceId } = await makeWorkspace();
		const { token } = await createSession(userId, workspaceId);

		const event = fakeEvent(token);
		await handle({ event, resolve } as never);

		expect(event.locals.user?.id).toBe(userId);
		expect(event.locals.sessionToken).toBe(token);
		expect(event.locals.workspace?.workspaceId).toBe(workspaceId);
		expect(event.locals.role).toBe('ADMIN');
		expect(event.locals.deactivatedWorkspace).toBeNull();
	});

	it('avec un token invalide, ne peuple rien (et ne plante pas)', async () => {
		const event = fakeEvent('token-inexistant');
		await handle({ event, resolve } as never);
		expect(event.locals.user).toBeNull();
		expect(event.locals.workspace).toBeNull();
	});

	it("si l'espace de la session a désactivé l'utilisateur, signale deactivatedWorkspace sans espace courant", async () => {
		const { workspaceId } = await makeWorkspace('deact');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'deact-member');
		const { token } = await createSession(memberId, workspaceId);

		await setMemberActive(workspaceId, memberId, false);

		const event = fakeEvent(token);
		await handle({ event, resolve } as never);

		expect(event.locals.user?.id).toBe(memberId);
		expect(event.locals.workspace).toBeNull();
		expect(event.locals.role).toBeNull();
		expect(event.locals.deactivatedWorkspace?.workspaceId).toBe(workspaceId);
	});

	it("si l'espace de la session est obsolète mais l'utilisateur a un autre espace actif, bascule dessus", async () => {
		const stale = await makeWorkspace('stale-a');
		const real = await makeWorkspace('stale-b');
		// Un même utilisateur ne peut pas être owner de deux workspaces via makeWorkspace ; on
		// simule l'espace "obsolète" en créant une session pointant vers un workspaceId auquel
		// l'utilisateur de `real` n'appartient pas du tout.
		const { token } = await createSession(real.userId, stale.workspaceId);

		const event = fakeEvent(token);
		await handle({ event, resolve } as never);

		expect(event.locals.workspace?.workspaceId).toBe(real.workspaceId);
		expect(event.locals.role).toBe('ADMIN');
		expect(event.locals.deactivatedWorkspace).toBeNull();
	});

	it('pose les headers de sécurité sur la réponse', async () => {
		const event = fakeEvent();
		const response = await handle({ event, resolve } as never);
		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
		expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=');
	});
});
