import { describe, it, expect } from 'vitest';
import { setCell, getWeek, deleteRow, getRecentTicketIds } from './imputation';
import { createTicket } from './tickets';
import { listCategories } from './params';
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
