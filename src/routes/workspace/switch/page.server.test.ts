import { describe, it, expect } from 'vitest';
import { actions } from './+page.server';
import { makeWorkspace } from '$lib/server/services/test-helpers';
import { fakeLocals, formRequest } from '$lib/server/test-helpers/http';

describe('workspace/switch action', () => {
	it('bascule vers un espace dont on est membre -> redirige vers /imputation', async () => {
		const { userId, workspaceId } = await makeWorkspace('switch1');
		const locals = await fakeLocals(userId);
		const event = { locals, request: formRequest({ workspaceId }) };
		await expect(actions.default(event as never)).rejects.toMatchObject({
			status: 303,
			location: '/imputation'
		});
	});

	it("refuse un espace dont on n'est pas membre -> fail 403", async () => {
		const a = await makeWorkspace('switchA');
		const b = await makeWorkspace('switchB');
		const locals = await fakeLocals(a.userId);
		const event = { locals, request: formRequest({ workspaceId: b.workspaceId }) };
		const res = await actions.default(event as never);
		expect(res?.status).toBe(403);
	});

	it('non authentifié -> redirige vers /login', async () => {
		const event = { locals: { sessionToken: null, memberships: [] }, request: formRequest({ workspaceId: 'x' }) };
		await expect(actions.default(event as never)).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
	});
});
