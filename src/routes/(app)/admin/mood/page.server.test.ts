import { describe, it, expect } from 'vitest';
import { load as loadUntyped, actions } from './+page.server';
// `load` peut renvoyer `void` côté types (branches sans retour explicite) ; en pratique il
// renvoie toujours des données ici, donc on retype pour éviter un cast répété à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace, addMember, grantCapability } from '$lib/server/services/test-helpers';
import { fakeLocals } from '$lib/server/test-helpers/http';

describe('admin/mood load', () => {
	it('ADMIN charge periods + config', async () => {
		const { userId } = await makeWorkspace('mood1');
		const locals = await fakeLocals(userId);
		const res = await load({ locals } as never);
		expect(res.periods).toBeInstanceOf(Array);
		expect(res.currentPeriodStart).toBeTruthy();
	});

	it('un rôle USER est redirigé vers /imputation', async () => {
		const { workspaceId } = await makeWorkspace('mood2');
		const { userId } = await addMember(workspaceId, 'USER', 'mood2-user');
		const locals = await fakeLocals(userId);
		await expect(load({ locals } as never)).rejects.toMatchObject({ status: 303, location: '/imputation' });
	});

	it('un rôle MANAGER (sans canViewMoodResults) est redirigé vers /imputation — pas d\'accès par défaut', async () => {
		const { workspaceId } = await makeWorkspace('mood7');
		const { userId } = await addMember(workspaceId, 'MANAGER', 'mood7-manager');
		const locals = await fakeLocals(userId);
		await expect(load({ locals } as never)).rejects.toMatchObject({ status: 303, location: '/imputation' });
	});

	it('un USER avec canViewMoodResults charge la page en lecture (isAdmin: false)', async () => {
		const { workspaceId } = await makeWorkspace('mood5');
		const { userId } = await addMember(workspaceId, 'USER', 'mood5-user');
		await grantCapability(workspaceId, userId, 'canViewMoodResults');
		const locals = await fakeLocals(userId);
		const res = await load({ locals } as never);
		expect(res.periods).toBeInstanceOf(Array);
		expect(res.isAdmin).toBe(false);
	});
});

describe('admin/mood resetCurrentPeriod action', () => {
	it('réservé ADMIN (403 pour USER)', async () => {
		const { workspaceId } = await makeWorkspace('mood3');
		const { userId } = await addMember(workspaceId, 'USER', 'mood3-user');
		const locals = await fakeLocals(userId);
		const res = await actions.resetCurrentPeriod({ locals } as never);
		expect(res?.status).toBe(403);
	});

	it('ADMIN peut réinitialiser la période courante', async () => {
		const { userId } = await makeWorkspace('mood4');
		const locals = await fakeLocals(userId);
		const res = await actions.resetCurrentPeriod({ locals } as never);
		expect(res).toEqual({ resetOk: true });
	});

	it('canViewMoodResults ne donne pas le droit de réinitialiser (403)', async () => {
		const { workspaceId } = await makeWorkspace('mood6');
		const { userId } = await addMember(workspaceId, 'USER', 'mood6-user');
		await grantCapability(workspaceId, userId, 'canViewMoodResults');
		const locals = await fakeLocals(userId);
		const res = await actions.resetCurrentPeriod({ locals } as never);
		expect(res?.status).toBe(403);
	});
});
