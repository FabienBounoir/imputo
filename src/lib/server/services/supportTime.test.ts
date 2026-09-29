import { describe, it, expect } from 'vitest';
import { makeWorkspace, addMember } from './test-helpers';
import { setSupportTimeTrackingEnabled } from './support';
import {
	isSupportTimeTrackingEnabled,
	createTimeEntry,
	listOwnTimeEntries,
	listAllTimeEntries,
	listTimeEntriesPage,
	getSupportTimeStats,
	listPeopleWithEntries,
	updateTimeEntry,
	deleteTimeEntry,
	getOwnDailyRecap
} from './supportTime';

describe('supportTime', () => {
	it('désactivé par défaut, activable', async () => {
		const ws = await makeWorkspace('sti');
		expect(await isSupportTimeTrackingEnabled(ws.workspaceId)).toBe(false);
		await setSupportTimeTrackingEnabled(ws.workspaceId, true);
		expect(await isSupportTimeTrackingEnabled(ws.workspaceId)).toBe(true);
	});

	it('rejette un identifiant vide ou une durée invalide', async () => {
		const ws = await makeWorkspace('sti');
		await expect(createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: '  ', minutes: 30 })).rejects.toThrow(
			/identifiant/i
		);
		await expect(createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-1', minutes: -1 })).rejects.toThrow(
			/durée/i
		);
	});

	it('accepte une durée nulle — ticket traité sans temps passé (ex. hors périmètre)', async () => {
		const ws = await makeWorkspace('sti');
		await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-0', minutes: 0 });
		const own = await listOwnTimeEntries(ws.workspaceId, ws.userId);
		expect(own.map((e) => [e.ticketRef, e.minutes])).toEqual([['INC-0', 0]]);
	});

	it("crée une saisie sur aujourd'hui par défaut, visible dans ses propres entrées", async () => {
		const ws = await makeWorkspace('sti');
		await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-42', minutes: 90 });
		const own = await listOwnTimeEntries(ws.workspaceId, ws.userId);
		expect(own).toHaveLength(1);
		expect(own[0].ticketRef).toBe('INC-42');
		expect(own[0].minutes).toBe(90);
		expect(own[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it("un utilisateur ne voit dans listOwnTimeEntries que les siennes, l'admin voit tout via listAllTimeEntries", async () => {
		const ws = await makeWorkspace('sti');
		const other = await addMember(ws.workspaceId, 'USER', 'sti-other');
		await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-1', minutes: 30 });
		await createTimeEntry(ws.workspaceId, other.userId, { ticketRef: 'INC-2', minutes: 60 });

		const own = await listOwnTimeEntries(ws.workspaceId, ws.userId);
		expect(own.map((e) => e.ticketRef)).toEqual(['INC-1']);

		const all = await listAllTimeEntries(ws.workspaceId);
		expect(all.map((e) => e.ticketRef).sort()).toEqual(['INC-1', 'INC-2']);
	});

	// `ticketRef` n'est pas une FK : sans normalisation, "inc-1" et "INC-1" fragmentent les stats par
	// ticket (count distinct, group by) au lieu de désigner la même demande support.
	it('normalise la casse du ticket, à la création comme à la modification', async () => {
		const ws = await makeWorkspace('sti');
		await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: '  inc-1  ', minutes: 30 });
		const [created] = await listOwnTimeEntries(ws.workspaceId, ws.userId);
		expect(created.ticketRef).toBe('INC-1');

		await updateTimeEntry(ws.workspaceId, ws.userId, created.id, {
			ticketRef: 'inc-1-bis',
			minutes: 30,
			at: '2026-01-01T12:00:00.000Z'
		});
		const [updated] = await listOwnTimeEntries(ws.workspaceId, ws.userId);
		expect(updated.ticketRef).toBe('INC-1-BIS');
	});

	it('regroupe dans les mêmes stats deux saisies du même ticket tapé avec une casse différente', async () => {
		const ws = await makeWorkspace('sti');
		await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'inc-1', minutes: 30 });
		await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-1', minutes: 15 });
		const stats = await getSupportTimeStats(ws.workspaceId);
		expect(stats.distinctTickets).toBe(1);
		expect(stats.byTicket).toEqual([expect.objectContaining({ ticketRef: 'INC-1', minutes: 45, entries: 2 })]);
	});

	it("modifie sa propre saisie, mais pas celle d'un autre (même auteur requis, pas seulement le même espace)", async () => {
		const ws = await makeWorkspace('sti');
		const other = await addMember(ws.workspaceId, 'USER', 'sti-other2');
		const created = await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-9', minutes: 15 });

		await updateTimeEntry(ws.workspaceId, ws.userId, created.id, { ticketRef: 'INC-9-bis', minutes: 45, at: '2026-01-01T12:00:00.000Z' });
		const [updated] = await listOwnTimeEntries(ws.workspaceId, ws.userId);
		expect(updated.ticketRef).toBe('INC-9-BIS'); // casse normalisée, cf. le test dédié plus haut
		expect(updated.minutes).toBe(45);
		expect(updated.day).toBe('2026-01-01');

		await expect(
			updateTimeEntry(ws.workspaceId, other.userId, created.id, { ticketRef: 'hijack', minutes: 5, at: '2026-01-01T12:00:00.000Z' })
		).rejects.toThrow(/introuvable/i);
	});

	it('accepte un jour et une heure passés mais refuse une date future ou mal formée', async () => {
		const ws = await makeWorkspace('sti');
		await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-5', minutes: 30, at: '2026-01-02T12:00:00.000Z' });
		const [entry] = await listOwnTimeEntries(ws.workspaceId, ws.userId);
		// `day` est déduit de l'instant (date parisienne), et l'heure choisie est conservée.
		expect(entry.day).toBe('2026-01-02');
		expect(entry.createdAt.toISOString()).toBe('2026-01-02T12:00:00.000Z');

		await expect(
			createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-5', minutes: 30, at: '2999-01-01T12:00:00.000Z' })
		).rejects.toThrow(/futur/i);
		await expect(
			createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-5', minutes: 30, at: '02/01/2026' })
		).rejects.toThrow(/date invalide/i);
		await expect(
			updateTimeEntry(ws.workspaceId, ws.userId, entry.id, { ticketRef: 'INC-5', minutes: 30, at: '2999-01-01T12:00:00.000Z' })
		).rejects.toThrow(/futur/i);
	});

	it("supprime sa propre saisie, mais pas celle d'un autre", async () => {
		const ws = await makeWorkspace('sti');
		const other = await addMember(ws.workspaceId, 'USER', 'sti-del');
		const created = await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-7', minutes: 20 });

		await expect(deleteTimeEntry(ws.workspaceId, other.userId, created.id)).rejects.toThrow(/introuvable/i);
		expect(await listOwnTimeEntries(ws.workspaceId, ws.userId)).toHaveLength(1);

		await deleteTimeEntry(ws.workspaceId, ws.userId, created.id);
		expect(await listOwnTimeEntries(ws.workspaceId, ws.userId)).toHaveLength(0);
	});

	it('agrège les stats par personne/ticket côté SQL, et filtre par période/personne', async () => {
		const ws = await makeWorkspace('sti');
		const other = await addMember(ws.workspaceId, 'USER', 'sti-stats');
		await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-1', minutes: 30, at: '2026-01-05T12:00:00.000Z' });
		await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-1', minutes: 15, at: '2026-02-01T12:00:00.000Z' });
		await createTimeEntry(ws.workspaceId, other.userId, { ticketRef: 'INC-2', minutes: 60, at: '2026-01-10T12:00:00.000Z' });

		const all = await getSupportTimeStats(ws.workspaceId);
		expect(all.totalMinutes).toBe(105);
		expect(all.entryCount).toBe(3);
		expect(all.distinctTickets).toBe(2);
		expect(all.distinctPeople).toBe(2);
		expect(all.byTicket.find((t) => t.ticketRef === 'INC-1')).toMatchObject({ minutes: 45, entries: 2, people: 1 });
		expect(all.byPerson.find((p) => p.userId === ws.userId)).toMatchObject({ minutes: 45, entries: 2, tickets: 1 });

		const jan = await getSupportTimeStats(ws.workspaceId, { from: '2026-01-01', to: '2026-01-31' });
		expect(jan.totalMinutes).toBe(90);
		expect(jan.entryCount).toBe(2);

		const onlyOther = await getSupportTimeStats(ws.workspaceId, { userId: other.userId });
		expect(onlyOther.totalMinutes).toBe(60);
	});

	it('includeByTicket:false saute la répartition par ticket sans fausser distinctTickets ni les totaux', async () => {
		const ws = await makeWorkspace('sti');
		for (let i = 0; i < 5; i++) {
			await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: `INC-${i}`, minutes: (i + 1) * 10 });
		}
		const withoutTicket = await getSupportTimeStats(ws.workspaceId, {}, { includeByTicket: false });
		expect(withoutTicket.byTicket).toEqual([]);
		// Le vrai total, lui, ne dépend pas de la requête byTicket (agrégat séparé).
		expect(withoutTicket.distinctTickets).toBe(5);
		expect(withoutTicket.totalMinutes).toBe(150);

		const withTicket = await getSupportTimeStats(ws.workspaceId);
		expect(withTicket.byTicket).toHaveLength(5);
		// Toujours triés par temps décroissant.
		expect(withTicket.byTicket[0].ticketRef).toBe('INC-4');
	});

	it('pagine par curseur sans doublon ni trou sur plusieurs pages', async () => {
		const ws = await makeWorkspace('sti');
		for (let i = 0; i < 5; i++) {
			await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: `INC-${i}`, minutes: 10, at: '2026-03-01T12:00:00.000Z' });
		}
		const page1 = await listTimeEntriesPage(ws.workspaceId, {}, { limit: 2 });
		expect(page1.entries).toHaveLength(2);
		expect(page1.nextCursor).not.toBeNull();

		const page2 = await listTimeEntriesPage(ws.workspaceId, {}, { limit: 2, cursor: page1.nextCursor! });
		expect(page2.entries).toHaveLength(2);
		expect(page2.nextCursor).not.toBeNull();

		const page3 = await listTimeEntriesPage(ws.workspaceId, {}, { limit: 2, cursor: page2.nextCursor! });
		expect(page3.entries).toHaveLength(1);
		expect(page3.nextCursor).toBeNull();

		const allIds = [...page1.entries, ...page2.entries, ...page3.entries].map((e) => e.id);
		expect(new Set(allIds).size).toBe(5);
	});

	it('liste les personnes ayant au moins une saisie', async () => {
		const ws = await makeWorkspace('sti');
		const other = await addMember(ws.workspaceId, 'USER', 'sti-people');
		expect(await listPeopleWithEntries(ws.workspaceId)).toEqual([]);
		await createTimeEntry(ws.workspaceId, other.userId, { ticketRef: 'INC-1', minutes: 10 });
		const people = await listPeopleWithEntries(ws.workspaceId);
		expect(people.map((p) => p.userId)).toEqual([other.userId]);
	});

	it('getOwnDailyRecap : temps et tickets distincts par jour, jours vides à 0, seulement les siennes', async () => {
		const ws = await makeWorkspace('sti');
		const other = await addMember(ws.workspaceId, 'USER', 'sti-recap');
		const at = (day: string, h: string) => `${day}T${h}:00:00.000Z`;
		await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-1', minutes: 30, at: at('2026-03-02', '08') });
		await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'inc-1', minutes: 15, at: at('2026-03-02', '10') }); // même ticket
		await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-2', minutes: 60, at: at('2026-03-02', '12') });
		await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-3', minutes: 20, at: at('2026-02-27', '09') }); // hors jours demandés
		await createTimeEntry(ws.workspaceId, other.userId, { ticketRef: 'INC-9', minutes: 90, at: at('2026-03-03', '09') });

		expect(await getOwnDailyRecap(ws.workspaceId, ws.userId, ['2026-03-03', '2026-03-02'])).toEqual([
			{ day: '2026-03-03', minutes: 0, tickets: 0 },
			{ day: '2026-03-02', minutes: 105, tickets: 2 }
		]);
	});
});
