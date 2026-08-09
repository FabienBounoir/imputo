import { describe, it, expect } from 'vitest';
import { load as loadUntyped, actions } from './+page.server';
// `load` peut renvoyer `void` côté types (branches sans retour explicite) ; en pratique il
// renvoie toujours des données ici, donc on retype pour éviter un cast répété à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals, formRequest } from '$lib/server/test-helpers/http';

describe('tickets +page.server load', () => {
	it('isAdmin/canEditEstimation sont false pour un USER, true pour un ADMIN', async () => {
		const { userId, workspaceId } = await makeWorkspace('ticketsload');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'ticketsload-member');
		const url = new URL('http://localhost/tickets');

		const memberResult = await load({ locals: await fakeLocals(memberId), url } as never);
		const adminResult = await load({ locals: await fakeLocals(userId), url } as never);

		expect(memberResult.isAdmin).toBe(false);
		expect(memberResult.canEditEstimation).toBe(false);
		expect(adminResult.isAdmin).toBe(true);
		expect(adminResult.canEditEstimation).toBe(true);
	});

	it('vue kanban par défaut sans pagination, vue table paginée', async () => {
		const { userId } = await makeWorkspace('ticketsload');
		const locals = await fakeLocals(userId);

		const kanban = await load({ locals, url: new URL('http://localhost/tickets?view=kanban') } as never);
		const table = await load({ locals, url: new URL('http://localhost/tickets') } as never);

		expect(kanban.view).toBe('kanban');
		expect(kanban.pageCount).toBe(1);
		expect(table.view).toBe('table');
		expect(table.pageSize).toBe(50);
	});
});

describe('tickets +page.server actions.create', () => {
	it('rejette une clé/titre manquants', async () => {
		const { userId } = await makeWorkspace('ticketscreate');
		const locals = await fakeLocals(userId);
		const result = await actions.create({ locals, request: formRequest({}) } as never);
		expect(result?.status).toBe(400);
	});

	it('ignore silencieusement estimationPrev/enveloppeTotale soumis par un USER', async () => {
		const { userId, workspaceId } = await makeWorkspace('ticketscreate');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'ticketscreate-member');
		const locals = await fakeLocals(memberId);

		const result = await actions.create({
			locals,
			request: formRequest({
				key: `TCU-${Date.now()}`,
				title: 'Ticket USER',
				estimationPrev: '100',
				enveloppeTotale: '200'
			})
		} as never);

		expect(result).toEqual({ ok: true });

		const table = await load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets') } as never);
		const created = table.tickets.find((t: any) => t.title === 'Ticket USER');
		expect(created?.estimationPrev ?? null).toBeNull();
	});

	it('un ADMIN peut poser estimationPrev/enveloppeTotale', async () => {
		const { userId } = await makeWorkspace('ticketscreate');
		const locals = await fakeLocals(userId);

		const result = await actions.create({
			locals,
			request: formRequest({
				key: `TCA-${Date.now()}`,
				title: 'Ticket ADMIN',
				estimationPrev: '100',
				enveloppeTotale: '200'
			})
		} as never);

		expect(result).toEqual({ ok: true });
	});

	it('refuse une clé dupliquée', async () => {
		const { userId } = await makeWorkspace('ticketscreate');
		const locals = await fakeLocals(userId);
		const key = `TCD-${Date.now()}`;
		await actions.create({ locals, request: formRequest({ key, title: 'Premier' }) } as never);
		const result = await actions.create({ locals, request: formRequest({ key, title: 'Doublon' }) } as never);
		expect(result?.status).toBe(400);
	});
});

describe('tickets +page.server actions.groupToggle / actions.flag', () => {
	it('groupToggle refuse sans authentification', async () => {
		const result = await actions.groupToggle({
			locals: { workspace: null },
			request: formRequest({ ticketId: 'x', groupId: 'y', member: 'true' })
		} as never);
		expect(result?.status).toBe(401);
	});

	it('flag refuse sans authentification', async () => {
		const result = await actions.flag({
			locals: { workspace: null },
			request: formRequest({ ticketId: 'x', key: 'cypress', value: 'Oui' })
		} as never);
		expect(result?.status).toBe(401);
	});
});
