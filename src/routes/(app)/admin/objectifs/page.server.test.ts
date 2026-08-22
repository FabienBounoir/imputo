import { describe, it, expect } from 'vitest';
import { actions, load as loadUntyped } from './+page.server';
// `load` peut renvoyer `void` côté types (branche redirect sans retour explicite) ; en pratique il
// renvoie toujours des données ici, donc on retype pour éviter un cast répété à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals, formRequest } from '$lib/server/test-helpers/http';
import { setMemberFactice } from '$lib/server/services/accounts';

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

describe('admin/objectifs load — membres "factice"', () => {
	it('un membre marqué factice (cf. membership.factice) est exclu de la liste des membres', async () => {
		const { userId: ownerId, workspaceId } = await makeWorkspace('obj-factice');
		const { userId: normalId } = await addMember(workspaceId, 'USER', 'obj-factice-normal');
		const { userId: facticeId } = await addMember(workspaceId, 'USER', 'obj-factice-dummy');
		await setMemberFactice(workspaceId, facticeId, true);

		const locals = await fakeLocals(ownerId);
		const result = await load({ locals, url: new URL('http://localhost/admin/objectifs') } as never);

		const memberIds = result.members.map((m: { id: string }) => m.id);
		expect(memberIds).toContain(normalId);
		expect(memberIds).not.toContain(facticeId);
	});
});
