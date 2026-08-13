import { describe, it, expect } from 'vitest';
import { makeWorkspace } from './test-helpers';
import { createTicket } from './tickets';
import {
	listTicketGroups,
	createTicketGroup,
	renameTicketGroup,
	setTicketGroupArchived,
	getTicketGroupIds,
	setTicketInGroup,
	reorderTicketGroups
} from './ticketGroups';

describe('ticketGroups', () => {
	it('crée, renomme et archive un groupe', async () => {
		const { workspaceId } = await makeWorkspace('tg');
		await createTicketGroup(workspaceId, 'Sprint transverse');
		let groups = await listTicketGroups(workspaceId);
		const g = groups.find((x) => x.label === 'Sprint transverse');
		expect(g).toMatchObject({ archived: false, usage: 0 });

		await renameTicketGroup(workspaceId, g!.id, 'Sprint transverse Q3');
		await setTicketGroupArchived(workspaceId, g!.id, true);
		groups = await listTicketGroups(workspaceId);
		expect(groups.find((x) => x.id === g!.id)).toMatchObject({ label: 'Sprint transverse Q3', archived: true });
	});

	it('refuse deux groupes actifs de même nom', async () => {
		const { workspaceId } = await makeWorkspace('tg-dup');
		await createTicketGroup(workspaceId, 'Doublon');
		await expect(createTicketGroup(workspaceId, 'doublon')).rejects.toThrow();
	});

	it('ajoute/retire un ticket d’un groupe et met à jour usage()', async () => {
		const { workspaceId } = await makeWorkspace('tg-member');
		await createTicketGroup(workspaceId, 'Groupe A');
		const group = (await listTicketGroups(workspaceId)).find((x) => x.label === 'Groupe A')!;
		const ticket = await createTicket(workspaceId, { key: 'TGM-1', title: 'Ticket membre' });

		expect(await getTicketGroupIds(workspaceId, ticket.id)).toEqual([]);

		await setTicketInGroup(workspaceId, ticket.id, group.id, true);
		expect(await getTicketGroupIds(workspaceId, ticket.id)).toEqual([group.id]);
		let groups = await listTicketGroups(workspaceId);
		expect(groups.find((x) => x.id === group.id)?.usage).toBe(1);

		// Idempotent (onConflictDoNothing) : réajouter ne duplique pas.
		await setTicketInGroup(workspaceId, ticket.id, group.id, true);
		expect(await getTicketGroupIds(workspaceId, ticket.id)).toEqual([group.id]);

		await setTicketInGroup(workspaceId, ticket.id, group.id, false);
		expect(await getTicketGroupIds(workspaceId, ticket.id)).toEqual([]);
		groups = await listTicketGroups(workspaceId);
		expect(groups.find((x) => x.id === group.id)?.usage).toBe(0);
	});

	it('reorderTicketGroups applique le nouvel ordre et ignore les id d’un autre espace', async () => {
		const ws = await makeWorkspace('tg-reorder');
		const other = await makeWorkspace('tg-reorder-other');
		await createTicketGroup(ws.workspaceId, 'A');
		await createTicketGroup(ws.workspaceId, 'B');
		await createTicketGroup(ws.workspaceId, 'C');
		await createTicketGroup(other.workspaceId, 'X');
		const [a, b, c] = await listTicketGroups(ws.workspaceId);
		const [x] = await listTicketGroups(other.workspaceId);
		expect([a.label, b.label, c.label]).toEqual(['A', 'B', 'C']); // ordre de création par défaut

		await reorderTicketGroups(ws.workspaceId, [c.id, a.id, x.id, b.id]);

		expect((await listTicketGroups(ws.workspaceId)).map((g) => g.label)).toEqual(['C', 'A', 'B']);
		// L'id d'un autre espace glissé dans la liste n'a rien modifié chez lui.
		expect((await listTicketGroups(other.workspaceId)).map((g) => g.label)).toEqual(['X']);
	});

	it('setTicketInGroup refuse un groupe ou un ticket d’un autre espace', async () => {
		const a = await makeWorkspace('tg-iso-a');
		const b = await makeWorkspace('tg-iso-b');
		await createTicketGroup(a.workspaceId, 'Groupe A');
		const groupA = (await listTicketGroups(a.workspaceId))[0];
		const ticketB = await createTicket(b.workspaceId, { key: 'TGB-1', title: 'Ticket B' });

		await expect(setTicketInGroup(b.workspaceId, ticketB.id, groupA.id, true)).rejects.toThrow();

		const ticketA = await createTicket(a.workspaceId, { key: 'TGA-1', title: 'Ticket A' });
		await createTicketGroup(b.workspaceId, 'Groupe B');
		const groupB = (await listTicketGroups(b.workspaceId))[0];
		await expect(setTicketInGroup(a.workspaceId, ticketA.id, groupB.id, true)).rejects.toThrow();
	});
});
