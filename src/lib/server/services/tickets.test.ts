import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, ticket, timeEntry, jiraSyncRun } from '$lib/server/db';
import {
	createTicket,
	listTickets,
	updateTicketField,
	setTicketFlag,
	parseFlags,
	canEditActivityField,
	getTicketActivityBreakdown,
	deleteUntouchedSyncedTickets,
	NO_ACTIVITY_ID
} from './tickets';
import { makeWorkspace, addMember } from './test-helpers';
import { createActivity, listActivities } from './params';
import { setCell } from './imputation';
import { todayInParis } from '$lib/utils/date';

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

describe('canEditActivityField — budget par activité (ADMIN strict)', () => {
	it('un MANAGER ne peut PAS éditer le budget par activité (contrairement au reste du chiffrage)', async () => {
		const { workspaceId } = await makeWorkspace();
		const { userId: managerId } = await addMember(workspaceId, 'MANAGER');
		const t = await createTicket(workspaceId, { key: 'T-10', title: 'x' });
		await createActivity(workspaceId, `Dev-${t.id}`);
		const [act] = (await listActivities(workspaceId)).filter((a) => a.label === `Dev-${t.id}`);

		expect(await canEditActivityField(workspaceId, managerId, 'MANAGER', t.id, act.id, 'budget')).toBe(false);
	});

	it('un ADMIN peut éditer le budget par activité', async () => {
		const { workspaceId, userId: adminId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'T-11', title: 'x' });
		await createActivity(workspaceId, `Dev-${t.id}`);
		const [act] = (await listActivities(workspaceId)).filter((a) => a.label === `Dev-${t.id}`);

		expect(await canEditActivityField(workspaceId, adminId, 'ADMIN', t.id, act.id, 'budget')).toBe(true);
	});

	it("l'Estimé par activité reste éditable par tout membre, contrairement au budget", async () => {
		const { workspaceId } = await makeWorkspace();
		const { userId: userId2 } = await addMember(workspaceId, 'USER');
		const t = await createTicket(workspaceId, { key: 'T-12', title: 'x' });
		await createActivity(workspaceId, `Dev-${t.id}`);
		const [act] = (await listActivities(workspaceId)).filter((a) => a.label === `Dev-${t.id}`);

		expect(await canEditActivityField(workspaceId, userId2, 'USER', t.id, act.id, 'estimation')).toBe(true);
		expect(await canEditActivityField(workspaceId, userId2, 'USER', t.id, act.id, 'budget')).toBe(false);
	});
});

describe('activityBreakdown — bucket "Autre" pour les imputations sans activité', () => {
	it('regroupe les imputations sans activité sous "Autre", triée après les vraies activités, RAE/estimé/budget à 0', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'T-20', title: 'x' });
		await createActivity(workspaceId, `Dev-${t.id}`);
		const [act] = (await listActivities(workspaceId)).filter((a) => a.label === `Dev-${t.id}`);

		// Une imputation avec activité, une sans — le total "Consommé" du ticket doit rester correct
		// (déjà le cas), mais avant le fix la seconde disparaissait purement et simplement du détail.
		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: act.id, day: '2026-08-10', amount: 1 });
		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null, day: '2026-08-11', amount: 2 });

		const breakdown = await getTicketActivityBreakdown(workspaceId, t.id);
		expect(breakdown).toHaveLength(2);

		const other = breakdown.find((a) => a.activityId === NO_ACTIVITY_ID);
		expect(other?.label).toBe('Autre');
		expect(other?.contributors).toEqual([{ userId, displayName: expect.any(String), consumed: 2 }]);
		expect(other?.raeReal).toBe(0);
		expect(other?.raeTest).toBe(0);
		expect(other?.estimation).toBe(0);
		expect(other?.budget).toBe(0);

		// "Autre" trie après les vraies activités même si son libellé serait alphabétiquement avant.
		expect(breakdown.at(-1)?.activityId).toBe(NO_ACTIVITY_ID);

		// enrichTickets/listTickets (chemin batch de la liste des tickets) applique la même règle,
		// indépendamment de getTicketActivityBreakdown (logique dupliquée, cf. commentaires du code).
		const [row] = (await listTickets(workspaceId)).filter((r) => r.id === t.id);
		expect(row.activityBreakdown.find((a) => a.activityId === NO_ACTIVITY_ID)?.label).toBe('Autre');
		expect(row.consumed).toBe(3); // le total, lui, a toujours compté les deux imputations
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

describe('deleteUntouchedSyncedTickets', () => {
	async function makeSyncRun(workspaceId: string) {
		const [row] = await db
			.insert(jiraSyncRun)
			.values({ workspaceId, startedAt: new Date(), status: 'SUCCESS' })
			.returning({ id: jiraSyncRun.id });
		return row.id;
	}

	it('supprime les tickets vierges du run donné, ignore ceux des autres runs', async () => {
		const { workspaceId } = await makeWorkspace();
		const runId = await makeSyncRun(workspaceId);
		const otherRunId = await makeSyncRun(workspaceId);
		await db.insert(ticket).values([
			{ workspaceId, key: 'S-1', title: 'A', createdBySyncRunId: runId },
			{ workspaceId, key: 'S-2', title: 'B', createdBySyncRunId: runId },
			{ workspaceId, key: 'S-3', title: 'Autre run', createdBySyncRunId: otherRunId }
		]);

		const deleted = await deleteUntouchedSyncedTickets(workspaceId, runId);

		expect(deleted).toBe(2);
		expect((await listTickets(workspaceId)).map((t) => t.key).sort()).toEqual(['S-3']);
	});

	it('conserve un ticket dès qu’il porte une trace humaine : champ édité, imputation, ou parent d’un autre ticket', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const runId = await makeSyncRun(workspaceId);

		const [edited] = await db
			.insert(ticket)
			.values({ workspaceId, key: 'K-EDIT', title: 'x', createdBySyncRunId: runId, comment: 'note manuelle' })
			.returning({ id: ticket.id });
		const [withTime] = await db
			.insert(ticket)
			.values({ workspaceId, key: 'K-TIME', title: 'x', createdBySyncRunId: runId })
			.returning({ id: ticket.id });
		const [parent] = await db
			.insert(ticket)
			.values({ workspaceId, key: 'K-PARENT', title: 'x', createdBySyncRunId: runId })
			.returning({ id: ticket.id });
		await db.insert(ticket).values({ workspaceId, key: 'K-CHILD', title: 'x', parentId: parent.id });
		await db.insert(ticket).values({ workspaceId, key: 'K-CLEAN', title: 'x', createdBySyncRunId: runId });

		await db.insert(timeEntry).values({
			workspaceId,
			userId,
			targetType: 'TICKET',
			ticketId: withTime.id,
			day: todayInParis(),
			amount: '1'
		});

		const deleted = await deleteUntouchedSyncedTickets(workspaceId, runId);

		expect(deleted).toBe(1); // seul K-CLEAN
		const remaining = (await listTickets(workspaceId)).map((t) => t.key).sort();
		expect(remaining).toEqual(['K-CHILD', 'K-EDIT', 'K-PARENT', 'K-TIME']);
		expect((await db.select().from(ticket).where(eq(ticket.id, edited.id)))[0]).toBeTruthy();
	});
});
