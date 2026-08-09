import { describe, it, expect } from 'vitest';
import { actions } from './+page.server';
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals, formRequest } from '$lib/server/test-helpers/http';

describe('admin/objectifs addObjective action', () => {
	it('un MANAGER peut ajouter un objectif custom à un membre', async () => {
		const { workspaceId } = await makeWorkspace('obj1');
		const { userId: managerId } = await addMember(workspaceId, 'MANAGER', 'obj1-mgr');
		const { userId: targetUserId } = await addMember(workspaceId, 'USER', 'obj1-target');
		const locals = await fakeLocals(managerId);
		const event = {
			locals,
			request: formRequest({
				userId: targetUserId,
				weekMondayISO: '2026-06-22',
				kind: 'CUSTOM',
				label: 'Rédiger la doc'
			})
		};
		const res = await actions.addObjective(event as never);
		expect(res).toEqual({ objOk: true });
	});

	it('un rôle USER ne peut pas ajouter un objectif (403)', async () => {
		const { workspaceId } = await makeWorkspace('obj2');
		const { userId } = await addMember(workspaceId, 'USER', 'obj2-user');
		const locals = await fakeLocals(userId);
		const event = {
			locals,
			request: formRequest({ userId, weekMondayISO: '2026-06-22', kind: 'CUSTOM', label: 'x' })
		};
		const res = await actions.addObjective(event as never);
		expect(res?.status).toBe(403);
	});

	it('données invalides -> fail 400', async () => {
		const { userId } = await makeWorkspace('obj3');
		const locals = await fakeLocals(userId);
		const event = { locals, request: formRequest({ userId: '', weekMondayISO: '' }) };
		const res = await actions.addObjective(event as never);
		expect(res?.status).toBe(400);
	});
});

describe('admin/objectifs removeObjective + toggleVacation actions', () => {
	it('ADMIN peut ajouter puis retirer un objectif', async () => {
		const { userId, workspaceId } = await makeWorkspace('obj4');
		const locals = await fakeLocals(userId);

		await actions.addObjective({
			locals,
			request: formRequest({
				userId,
				weekMondayISO: '2026-06-22',
				kind: 'CUSTOM',
				label: 'À supprimer'
			})
		} as never);

		const { listObjectivesForUser } = await import('$lib/server/services/weeklyObjectives');
		const [objective] = await listObjectivesForUser(workspaceId, userId, '2026-06-22');

		const res = await actions.removeObjective({
			locals,
			request: formRequest({ id: objective.id })
		} as never);
		expect(res).toEqual({ objOk: true });
	});

	it('ADMIN peut basculer les vacances d’un membre', async () => {
		const { userId } = await makeWorkspace('obj5');
		const locals = await fakeLocals(userId);
		const res = await actions.toggleVacation({
			locals,
			request: formRequest({ userId, weekMondayISO: '2026-06-22', onVacation: 'true' })
		} as never);
		expect(res).toEqual({ objOk: true });
	});
});
