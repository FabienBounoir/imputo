import { describe, it, expect } from 'vitest';
import { load as loadUntyped, actions } from './+page.server';
// `load` peut renvoyer `void` côté types (branches sans retour explicite) ; en pratique il
// renvoie toujours des données ici, donc on retype pour éviter un cast répété à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals, formRequest } from '$lib/server/test-helpers/http';

describe('absences +page.server load', () => {
	it("redirige vers /register si l'utilisateur n'a pas d'espace courant", async () => {
		const { userId } = await makeWorkspace('absload');
		const locals = { ...(await fakeLocals(userId)), workspace: null };
		await expect(load({ locals, url: new URL('http://localhost/absences') } as never)).rejects.toMatchObject({
			status: 303,
			location: '/register'
		});
	});

	it('canManageOthers est false pour un USER, true pour un ADMIN', async () => {
		const { userId, workspaceId } = await makeWorkspace('absload');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'absload-member');
		const url = new URL('http://localhost/absences');

		const memberResult = await load({ locals: await fakeLocals(memberId), url } as never);
		const adminResult = await load({ locals: await fakeLocals(userId), url } as never);

		expect(memberResult.canManageOthers).toBe(false);
		expect(adminResult.canManageOthers).toBe(true);
		expect(memberResult.pendingAbsences).toEqual([]);
	});
});

describe('absences +page.server actions.create', () => {
	it('rejette des champs invalides', async () => {
		const { userId } = await makeWorkspace('abscreate');
		const locals = await fakeLocals(userId);
		const result = await actions.create({ locals, request: formRequest({}) } as never);
		expect(result?.status).toBe(400);
	});

	it('un USER ne peut pas déclarer un CONGE_VALIDE directement', async () => {
		const { userId, workspaceId } = await makeWorkspace('abscreate');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'abscreate-member');
		const locals = await fakeLocals(memberId);

		const result = await actions.create({
			locals,
			request: formRequest({ startDate: '2026-06-01', endDate: '2026-06-01', type: 'CONGE_VALIDE', period: 'FULL' })
		} as never);

		expect(result?.status).toBe(403);
	});

	it('un ADMIN peut déclarer un CONGE_VALIDE', async () => {
		const { userId } = await makeWorkspace('abscreate');
		const locals = await fakeLocals(userId);

		const result = await actions.create({
			locals,
			request: formRequest({ startDate: '2026-06-01', endDate: '2026-06-01', type: 'CONGE_VALIDE', period: 'FULL' })
		} as never);

		expect(result).toEqual({ ok: true });
	});

	it('un USER ne peut pas cibler un membre externe', async () => {
		const { userId, workspaceId } = await makeWorkspace('abscreate');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'abscreate-member');
		const locals = await fakeLocals(memberId);

		// subject=ext:... est ignoré pour un non-manager : l'absence est créée pour l'appelant lui-même.
		const result = await actions.create({
			locals,
			request: formRequest({
				startDate: '2026-06-02',
				endDate: '2026-06-02',
				type: 'FORMATION',
				period: 'FULL',
				subject: 'ext:some-id'
			})
		} as never);

		expect(result).toEqual({ ok: true });
	});
});

describe('absences +page.server actions.validate / addExternal / removeExternal', () => {
	it('validate refuse un membre USER (réservé admin/manager)', async () => {
		const { workspaceId } = await makeWorkspace('absvalidate2');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'absvalidate2-member');
		const locals = await fakeLocals(memberId);
		const result = await actions.validate({ locals, request: formRequest({ id: 'whatever' }) } as never);
		expect(result?.status).toBe(403);
	});

	it('addExternal / removeExternal refusent un USER', async () => {
		const { workspaceId } = await makeWorkspace('absext');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'absext-member');
		const locals = await fakeLocals(memberId);

		const addResult = await actions.addExternal({ locals, request: formRequest({ displayName: 'Ext' }) } as never);
		const removeResult = await actions.removeExternal({ locals, request: formRequest({ id: 'x' }) } as never);

		expect(addResult?.status).toBe(403);
		expect(removeResult?.status).toBe(403);
	});

	it('un ADMIN peut ajouter puis archiver un membre externe', async () => {
		const { userId } = await makeWorkspace('absext2');
		const locals = await fakeLocals(userId);

		const addResult = await actions.addExternal({ locals, request: formRequest({ displayName: 'Externe Test' }) } as never);
		expect(addResult).toEqual({ ok: true });

		const { externalMembers } = await load({ locals, url: new URL('http://localhost/absences') } as never);
		const created = externalMembers.find((m: any) => m.displayName === 'Externe Test');
		expect(created).toBeTruthy();

		const removeResult = await actions.removeExternal({ locals, request: formRequest({ id: created!.id }) } as never);
		expect(removeResult).toEqual({ ok: true });
	});
});
