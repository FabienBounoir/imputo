import { describe, it, expect } from 'vitest';
import { createTicket, listTickets, updateTicketField, setTicketFlag, parseFlags } from './tickets';
import { makeWorkspace, addMember } from './test-helpers';

describe('parseFlags', () => {
	it('renvoie les clés par défaut vides sur une valeur nulle ou corrompue', () => {
		expect(parseFlags(null)).toEqual({ cypress: '', docTech: '', prepaQualif: '' });
		expect(parseFlags('{not json')).toEqual({ cypress: '', docTech: '', prepaQualif: '' });
	});

	it('lit les valeurs valides', () => {
		expect(parseFlags(JSON.stringify({ cypress: 'Oui', docTech: 'N/A' }))).toEqual({
			cypress: 'Oui',
			docTech: 'N/A',
			prepaQualif: ''
		});
	});
});

describe('createTicket / listTickets', () => {
	it('un ticket créé apparaît dans la liste de son espace', async () => {
		const { workspaceId } = await makeWorkspace();
		await createTicket(workspaceId, { key: 'T-1', title: 'Mon ticket' });

		const tickets = await listTickets(workspaceId);
		expect(tickets.map((t) => t.key)).toContain('T-1');
		expect(tickets.find((t) => t.key === 'T-1')?.title).toBe('Mon ticket');
	});
});

describe('updateTicketField — permissions par rôle', () => {
	it('un USER peut éditer un champ descriptif (title)', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'T-2', title: 'Titre initial' });

		await updateTicketField(workspaceId, t.id, 'title', 'Titre modifié', 'USER', userId);
		const [updated] = await listTickets(workspaceId).then((rows) => rows.filter((r) => r.id === t.id));
		expect(updated.title).toBe('Titre modifié');
	});

	it('un USER ne peut PAS éditer un champ MANAGER_ONLY (estimationReal)', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'T-3', title: 'x' });

		await expect(updateTicketField(workspaceId, t.id, 'estimationReal', '5', 'USER', userId)).rejects.toThrow(
			'Champ non éditable.'
		);
	});

	it('un USER ne peut PAS éditer un champ ADMIN_ONLY (enveloppeTotale)', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'T-4', title: 'x' });

		await expect(updateTicketField(workspaceId, t.id, 'enveloppeTotale', '1000', 'USER', userId)).rejects.toThrow(
			'Champ non éditable.'
		);
	});

	it('un MANAGER peut éditer estimationReal ET enveloppeTotale', async () => {
		const { workspaceId } = await makeWorkspace();
		const { userId: managerId } = await addMember(workspaceId, 'MANAGER');
		const t = await createTicket(workspaceId, { key: 'T-5', title: 'x' });

		await updateTicketField(workspaceId, t.id, 'estimationReal', '3.5', 'MANAGER', managerId);
		await updateTicketField(workspaceId, t.id, 'enveloppeTotale', '2000', 'MANAGER', managerId);
		const [updated] = await listTickets(workspaceId).then((rows) => rows.filter((r) => r.id === t.id));
		expect(updated.estimationReal).toBe(3.5);
		expect(updated.enveloppeTotale).toBe(2000);
	});

	it('rejette un champ numérique négatif ou non numérique', async () => {
		const { workspaceId, userId: adminId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'T-6', title: 'x' });

		await expect(updateTicketField(workspaceId, t.id, 'estimationReal', '-1', 'ADMIN', adminId)).rejects.toThrow(
			'Valeur numérique invalide.'
		);
		await expect(updateTicketField(workspaceId, t.id, 'estimationReal', 'abc', 'ADMIN', adminId)).rejects.toThrow(
			'Valeur numérique invalide.'
		);
	});

	it('rejette un champ inconnu', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'T-7', title: 'x' });
		await expect(updateTicketField(workspaceId, t.id, 'notAField', 'x', 'ADMIN', userId)).rejects.toThrow(
			'Champ non éditable.'
		);
	});
});

describe('setTicketFlag', () => {
	it('pose puis retire un indicateur valide', async () => {
		const { workspaceId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'T-8', title: 'x' });

		await setTicketFlag(workspaceId, t.id, 'cypress', 'OK');
		let [row] = await listTickets(workspaceId).then((rows) => rows.filter((r) => r.id === t.id));
		expect(row.flags.cypress).toBe('OK');

		await setTicketFlag(workspaceId, t.id, 'cypress', '');
		[row] = await listTickets(workspaceId).then((rows) => rows.filter((r) => r.id === t.id));
		expect(row.flags.cypress).toBe('');
	});

	it('rejette une clé ou une valeur inconnue', async () => {
		const { workspaceId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'T-9', title: 'x' });
		await expect(setTicketFlag(workspaceId, t.id, 'unknownKey', 'Oui')).rejects.toThrow('Indicateur inconnu.');
		await expect(setTicketFlag(workspaceId, t.id, 'cypress', 'Peut-être')).rejects.toThrow('Valeur invalide.');
	});
});
