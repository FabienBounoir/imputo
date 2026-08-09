import { describe, it, expect } from 'vitest';
import { load as loadUntyped, actions } from './+page.server';
// `load` peut renvoyer `void` côté types (branches sans retour explicite) ; en pratique il
// renvoie toujours des données ici, donc on retype pour éviter un cast répété à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals, formRequest } from '$lib/server/test-helpers/http';
import { createTicket } from '$lib/server/services/tickets';

describe('imputation +page.server load', () => {
	it("redirige vers /register si l'utilisateur n'a pas d'espace courant", async () => {
		const { userId } = await makeWorkspace('imputload');
		const locals = { ...(await fakeLocals(userId)), workspace: null };
		await expect(load({ locals, url: new URL('http://localhost/imputation'), cookies: undefined } as never)).rejects.toMatchObject(
			{ status: 303, location: '/register' }
		);
	});

	it("un ADMIN peut consulter l'imputation d'un autre membre via ?u=, en lecture seule", async () => {
		const { userId: adminId, workspaceId } = await makeWorkspace('imputload');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'imputload-member');
		const locals = await fakeLocals(adminId);

		const result = await load({
			locals,
			url: new URL(`http://localhost/imputation?u=${memberId}`),
			cookies: { get: () => undefined, set: () => {} }
		} as never);

		expect(result.viewedId).toBe(memberId);
		expect(result.readOnly).toBe(true);
	});

	it("un USER ne peut pas basculer sur ?u= (reste sur sa propre feuille)", async () => {
		const { workspaceId } = await makeWorkspace('imputload');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'imputload-member2');
		const { userId: otherId } = await addMember(workspaceId, 'USER', 'imputload-member3');
		const locals = await fakeLocals(memberId);

		const result = await load({
			locals,
			url: new URL(`http://localhost/imputation?u=${otherId}`),
			cookies: { get: () => undefined, set: () => {} }
		} as never);

		expect(result.viewedId).toBe(memberId);
		expect(result.readOnly).toBe(false);
	});
});

describe('imputation +page.server actions.setCell / actions.deleteRow', () => {
	it('setCell rejette un targetType invalide', async () => {
		const { userId } = await makeWorkspace('imputset');
		const locals = await fakeLocals(userId);
		const result = await actions.setCell({
			locals,
			request: formRequest({ targetType: 'BOGUS', targetId: 'x', day: '2026-06-01', amount: '1' })
		} as never);
		expect(result?.status).toBe(400);
	});

	it('setCell impute sur un ticket réel', async () => {
		const { userId, workspaceId } = await makeWorkspace('imputset');
		const ticket = await createTicket(workspaceId, { key: `IMS-${Date.now()}`, title: 'Ticket imputable' });
		const locals = await fakeLocals(userId);

		const result = await actions.setCell({
			locals,
			request: formRequest({ targetType: 'TICKET', targetId: ticket.id, day: '2026-06-01', amount: '1' })
		} as never);

		expect(result).toEqual({ ok: true });
	});

	it('deleteRow rejette des données invalides', async () => {
		const { userId } = await makeWorkspace('imputdel');
		const locals = await fakeLocals(userId);
		const result = await actions.deleteRow({
			locals,
			request: formRequest({ targetType: 'TICKET', targetId: '', anchor: '2026-06-01' })
		} as never);
		expect(result?.status).toBe(400);
	});
});
