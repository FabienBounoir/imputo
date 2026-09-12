import { describe, it, expect } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, supportTimeEntry } from '$lib/server/db';
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
	type SupportTimeCursor
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
		await expect(createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-1', minutes: 0 })).rejects.toThrow(
			/durée/i
		);
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

	it("modifie sa propre saisie, mais pas celle d'un autre (même auteur requis, pas seulement le même espace)", async () => {
		const ws = await makeWorkspace('sti');
		const other = await addMember(ws.workspaceId, 'USER', 'sti-other2');
		const created = await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-9', minutes: 15 });

		await updateTimeEntry(ws.workspaceId, ws.userId, created.id, { ticketRef: 'INC-9-bis', minutes: 45, day: '2026-01-01' });
		const [updated] = await listOwnTimeEntries(ws.workspaceId, ws.userId);
		expect(updated.ticketRef).toBe('INC-9-bis');
		expect(updated.minutes).toBe(45);
		expect(updated.day).toBe('2026-01-01');

		await expect(
			updateTimeEntry(ws.workspaceId, other.userId, created.id, { ticketRef: 'hijack', minutes: 5, day: '2026-01-01' })
		).rejects.toThrow(/introuvable/i);
	});

	it('agrège les stats par personne/ticket côté SQL, et filtre par période/personne', async () => {
		const ws = await makeWorkspace('sti');
		const other = await addMember(ws.workspaceId, 'USER', 'sti-stats');
		await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-1', minutes: 30, day: '2026-01-05' });
		await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: 'INC-1', minutes: 15, day: '2026-02-01' });
		await createTimeEntry(ws.workspaceId, other.userId, { ticketRef: 'INC-2', minutes: 60, day: '2026-01-10' });

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
			await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: `INC-${i}`, minutes: 10, day: '2026-03-01' });
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

	// Régression : le curseur repart en ISO (milliseconde) alors que Postgres stocke la microseconde.
	// Comparé à la colonne brute, il faisait disparaître toute ligne située dans la MÊME milliseconde
	// que la dernière de la page précédente — d'où une pagination qui sautait des lignes, au hasard
	// des timings d'insertion. On force ici la collision plutôt que d'espérer la reproduire.
	it('ne saute aucune ligne quand plusieurs saisies partagent la même milliseconde', async () => {
		const ws = await makeWorkspace('sti');
		for (let i = 0; i < 4; i++) {
			await createTimeEntry(ws.workspaceId, ws.userId, { ticketRef: `MS-${i}`, minutes: 10, day: '2026-03-02' });
		}
		// .500000, .500250, .500500, .500750 : même milliseconde, microsecondes différentes.
		const rows = await db
			.select({ id: supportTimeEntry.id })
			.from(supportTimeEntry)
			.where(eq(supportTimeEntry.workspaceId, ws.workspaceId))
			.orderBy(supportTimeEntry.id);
		for (const [i, r] of rows.entries()) {
			await db.execute(
				sql`update support_time_entry set created_at = timestamptz '2026-03-02T10:00:00.500Z' + ${i * 250} * interval '1 microsecond' where id = ${r.id}`
			);
		}

		const seen: string[] = [];
		let cursor: SupportTimeCursor | undefined;
		for (let page = 0; page < 6; page++) {
			const res = await listTimeEntriesPage(ws.workspaceId, {}, { limit: 2, cursor });
			seen.push(...res.entries.map((e) => e.id));
			if (!res.nextCursor) break;
			cursor = res.nextCursor;
		}
		expect(new Set(seen).size).toBe(4);
	});

	it('liste les personnes ayant au moins une saisie', async () => {
		const ws = await makeWorkspace('sti');
		const other = await addMember(ws.workspaceId, 'USER', 'sti-people');
		expect(await listPeopleWithEntries(ws.workspaceId)).toEqual([]);
		await createTimeEntry(ws.workspaceId, other.userId, { ticketRef: 'INC-1', minutes: 10 });
		const people = await listPeopleWithEntries(ws.workspaceId);
		expect(people.map((p) => p.userId)).toEqual([other.userId]);
	});
});
