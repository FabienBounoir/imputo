import { describe, it, expect } from 'vitest';
import {
	setCell,
	getWeek,
	deleteRow,
	reassignActivity,
	pinRow,
	unpinRow,
	listPinnedRows,
	getRecentTicketIds
} from './imputation';
import { createTicket } from './tickets';
import { listCategories, createActivity, listActivities } from './params';
import { makeWorkspace } from './test-helpers';

const MONDAY = '2026-06-22'; // lundi (même date que isolation.test.ts)

describe('setCell / getWeek', () => {
	it('pose une imputation sur une catégorie et la retrouve dans la semaine', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const [category] = await listCategories(workspaceId);

		await setCell(workspaceId, userId, {
			targetType: 'CATEGORY',
			targetId: category.id,
			activityId: null,
			day: MONDAY,
			amount: 2
		});

		const week = await getWeek(workspaceId, userId, MONDAY);
		const row = week.rows.find((r) => r.targetId === category.id);
		expect(row?.amounts[MONDAY]).toBe(2);
		expect(week.dayTotals[MONDAY]).toBe(2);
		expect(week.total).toBe(2);
	});

	it('un amount <= 0 supprime la cellule existante au lieu de la mettre à 0', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const [category] = await listCategories(workspaceId);
		const cell = { targetType: 'CATEGORY' as const, targetId: category.id, activityId: null, day: MONDAY };

		await setCell(workspaceId, userId, { ...cell, amount: 1.5 });
		await setCell(workspaceId, userId, { ...cell, amount: 0 });

		const week = await getWeek(workspaceId, userId, MONDAY);
		expect(week.rows.find((r) => r.targetId === category.id)).toBeUndefined();
	});

	it('un second setCell le même jour met à jour la cellule (upsert), pas de doublon', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const [category] = await listCategories(workspaceId);
		const cell = { targetType: 'CATEGORY' as const, targetId: category.id, activityId: null, day: MONDAY };

		await setCell(workspaceId, userId, { ...cell, amount: 1 });
		await setCell(workspaceId, userId, { ...cell, amount: 3 });

		const week = await getWeek(workspaceId, userId, MONDAY);
		const rows = week.rows.filter((r) => r.targetId === category.id);
		expect(rows).toHaveLength(1);
		expect(rows[0].amounts[MONDAY]).toBe(3);
	});

	it('refuse une cible qui n’existe pas dans l’espace', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		await expect(
			setCell(workspaceId, userId, {
				targetType: 'CATEGORY',
				targetId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
				activityId: null,
				day: MONDAY,
				amount: 1
			})
		).rejects.toThrow('Catégorie introuvable dans cet espace.');
	});
});

describe('deleteRow', () => {
	it('supprime toutes les imputations de la ligne sur la période donnée', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const [category] = await listCategories(workspaceId);

		await setCell(workspaceId, userId, {
			targetType: 'CATEGORY',
			targetId: category.id,
			activityId: null,
			day: MONDAY,
			amount: 1
		});
		await deleteRow(workspaceId, userId, {
			targetType: 'CATEGORY',
			targetId: category.id,
			activityId: null,
			fromISO: MONDAY,
			toISO: MONDAY
		});

		const week = await getWeek(workspaceId, userId, MONDAY);
		expect(week.rows.find((r) => r.targetId === category.id)).toBeUndefined();
	});

	it('retire aussi l’épingle de la ligne (cf. pinRow) — sinon elle reviendrait au prochain chargement malgré la suppression', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const [category] = await listCategories(workspaceId);

		await pinRow(workspaceId, userId, { targetType: 'CATEGORY', targetId: category.id, activityId: null });
		expect(await listPinnedRows(workspaceId, userId)).toHaveLength(1);

		await deleteRow(workspaceId, userId, {
			targetType: 'CATEGORY',
			targetId: category.id,
			activityId: null,
			fromISO: MONDAY,
			toISO: MONDAY
		});

		expect(await listPinnedRows(workspaceId, userId)).toHaveLength(0);
	});
});

describe('pinRow / unpinRow / listPinnedRows', () => {
	it("une ligne épinglée sans aucune imputation reste listée — c'est tout l'intérêt du pin", async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'P-1', title: 'x' });

		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null });
		const pinned = await listPinnedRows(workspaceId, userId);
		expect(pinned).toEqual([{ targetType: 'TICKET', targetId: t.id, activityId: null }]);
	});

	it('idempotent : épingler deux fois la même ligne ne crée pas de doublon', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'P-2', title: 'x' });

		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null });
		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null });

		expect(await listPinnedRows(workspaceId, userId)).toHaveLength(1);
	});

	it('unpinRow retire uniquement la ligne visée', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t1 = await createTicket(workspaceId, { key: 'P-3', title: 'x' });
		const t2 = await createTicket(workspaceId, { key: 'P-4', title: 'y' });
		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t1.id, activityId: null });
		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t2.id, activityId: null });

		await unpinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t1.id, activityId: null });

		const pinned = await listPinnedRows(workspaceId, userId);
		expect(pinned.map((p) => p.targetId)).toEqual([t2.id]);
	});

	it("refuse d'épingler une cible qui n'existe pas dans l'espace", async () => {
		const { workspaceId, userId } = await makeWorkspace();
		await expect(
			pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', activityId: null })
		).rejects.toThrow('Ticket introuvable dans cet espace.');
	});
});

describe('reassignActivity', () => {
	it("déplace les imputations d'une ligne vers une nouvelle activité (pas de ligne existante dessus)", async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'A-1', title: 'x' });
		await createActivity(workspaceId, `Dev-${t.id}`);
		const [dev] = (await listActivities(workspaceId)).filter((a) => a.label === `Dev-${t.id}`);

		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null, day: MONDAY, amount: 2 });
		await reassignActivity(workspaceId, userId, {
			targetType: 'TICKET',
			targetId: t.id,
			fromActivityId: null,
			toActivityId: dev.id,
			fromISO: MONDAY,
			toISO: MONDAY
		});

		const week = await getWeek(workspaceId, userId, MONDAY);
		const rows = week.rows.filter((r) => r.targetId === t.id);
		expect(rows).toHaveLength(1);
		expect(rows[0].activityId).toBe(dev.id);
		expect(rows[0].amounts[MONDAY]).toBe(2);
	});

	it('fusionne (amounts additionnés) avec une ligne déjà existante sur la nouvelle activité au lieu de créer un doublon', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'A-2', title: 'x' });
		await createActivity(workspaceId, `Dev-${t.id}`);
		const [dev] = (await listActivities(workspaceId)).filter((a) => a.label === `Dev-${t.id}`);

		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null, day: MONDAY, amount: 1 });
		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: dev.id, day: MONDAY, amount: 3 });

		await reassignActivity(workspaceId, userId, {
			targetType: 'TICKET',
			targetId: t.id,
			fromActivityId: null,
			toActivityId: dev.id,
			fromISO: MONDAY,
			toISO: MONDAY
		});

		const week = await getWeek(workspaceId, userId, MONDAY);
		const rows = week.rows.filter((r) => r.targetId === t.id);
		expect(rows).toHaveLength(1); // pas de doublon
		expect(rows[0].activityId).toBe(dev.id);
		expect(rows[0].amounts[MONDAY]).toBe(4); // 1 + 3
	});

	it('ne fait rien si la nouvelle activité est la même que l’actuelle', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'A-3', title: 'x' });
		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null, day: MONDAY, amount: 1 });

		await reassignActivity(workspaceId, userId, {
			targetType: 'TICKET',
			targetId: t.id,
			fromActivityId: null,
			toActivityId: null,
			fromISO: MONDAY,
			toISO: MONDAY
		});

		const week = await getWeek(workspaceId, userId, MONDAY);
		expect(week.rows.find((r) => r.targetId === t.id)?.amounts[MONDAY]).toBe(1);
	});

	it("refuse une activité de destination qui n'existe pas dans l'espace", async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'A-4', title: 'x' });
		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null, day: MONDAY, amount: 1 });

		await expect(
			reassignActivity(workspaceId, userId, {
				targetType: 'TICKET',
				targetId: t.id,
				fromActivityId: null,
				toActivityId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
				fromISO: MONDAY,
				toISO: MONDAY
			})
		).rejects.toThrow('Activité introuvable dans cet espace.');
	});

	it("fait suivre l'épingle vers la nouvelle activité (ligne pinnée mais jamais remplie)", async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'A-5', title: 'x' });
		await createActivity(workspaceId, `Dev-${t.id}`);
		const [dev] = (await listActivities(workspaceId)).filter((a) => a.label === `Dev-${t.id}`);

		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null });
		await reassignActivity(workspaceId, userId, {
			targetType: 'TICKET',
			targetId: t.id,
			fromActivityId: null,
			toActivityId: dev.id,
			fromISO: MONDAY,
			toISO: MONDAY
		});

		expect(await listPinnedRows(workspaceId, userId)).toEqual([{ targetType: 'TICKET', targetId: t.id, activityId: dev.id }]);
	});
});

describe('getRecentTicketIds', () => {
	it('renvoie les tickets récemment imputés, les plus récents en premier', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t1 = await createTicket(workspaceId, { key: 'R-1', title: 'x' });
		const t2 = await createTicket(workspaceId, { key: 'R-2', title: 'y' });

		await setCell(workspaceId, userId, {
			targetType: 'TICKET',
			targetId: t1.id,
			activityId: null,
			day: MONDAY,
			amount: 1
		});
		await setCell(workspaceId, userId, {
			targetType: 'TICKET',
			targetId: t2.id,
			activityId: null,
			day: MONDAY,
			amount: 1
		});

		const recent = await getRecentTicketIds(workspaceId, userId, 4);
		expect(recent).toContain(t1.id);
		expect(recent).toContain(t2.id);
	});
});
