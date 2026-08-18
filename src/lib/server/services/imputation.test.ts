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
import { createAbsenceFor } from './absences';
import { makeWorkspace } from './test-helpers';
import { db, timeEntry } from '$lib/server/db';

const MONDAY = '2026-06-22'; // lundi (même date que isolation.test.ts)
const FRIDAY = '2026-06-26'; // vendredi de la même semaine
const NEXT_MONDAY = '2026-06-29'; // lundi suivant — période disjointe de [MONDAY, FRIDAY]
const NEXT_FRIDAY = '2026-07-03';
const WEEK = { firstDay: MONDAY, lastDay: FRIDAY };
const NEXT_WEEK = { firstDay: NEXT_MONDAY, lastDay: NEXT_FRIDAY };

describe('setCell / getWeek', () => {
	it('pose une imputation sur une catégorie et la retrouve dans la semaine', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		// 'MCO', pas juste la première catégorie (alphabétique = 'Congé', désormais réservée aux
		// absences validées — cf. assertTargetInWorkspace(blockLinkedCategory)).
		const category = (await listCategories(workspaceId)).find((c) => c.label === 'MCO')!;

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
		// 'MCO', pas juste la première catégorie (alphabétique = 'Congé', désormais réservée aux
		// absences validées — cf. assertTargetInWorkspace(blockLinkedCategory)).
		const category = (await listCategories(workspaceId)).find((c) => c.label === 'MCO')!;
		const cell = { targetType: 'CATEGORY' as const, targetId: category.id, activityId: null, day: MONDAY };

		await setCell(workspaceId, userId, { ...cell, amount: 1.5 });
		await setCell(workspaceId, userId, { ...cell, amount: 0 });

		const week = await getWeek(workspaceId, userId, MONDAY);
		expect(week.rows.find((r) => r.targetId === category.id)).toBeUndefined();
	});

	it('un second setCell le même jour met à jour la cellule (upsert), pas de doublon', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		// 'MCO', pas juste la première catégorie (alphabétique = 'Congé', désormais réservée aux
		// absences validées — cf. assertTargetInWorkspace(blockLinkedCategory)).
		const category = (await listCategories(workspaceId)).find((c) => c.label === 'MCO')!;
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
		// 'MCO', pas juste la première catégorie (alphabétique = 'Congé', désormais réservée aux
		// absences validées — cf. assertTargetInWorkspace(blockLinkedCategory)).
		const category = (await listCategories(workspaceId)).find((c) => c.label === 'MCO')!;

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
		// 'MCO', pas juste la première catégorie (alphabétique = 'Congé', désormais réservée aux
		// absences validées — cf. assertTargetInWorkspace(blockLinkedCategory)).
		const category = (await listCategories(workspaceId)).find((c) => c.label === 'MCO')!;

		await pinRow(workspaceId, userId, { targetType: 'CATEGORY', targetId: category.id, activityId: null, ...WEEK });
		expect(await listPinnedRows(workspaceId, userId, WEEK.firstDay, WEEK.lastDay)).toHaveLength(1);

		await deleteRow(workspaceId, userId, {
			targetType: 'CATEGORY',
			targetId: category.id,
			activityId: null,
			fromISO: MONDAY,
			toISO: MONDAY
		});

		expect(await listPinnedRows(workspaceId, userId, WEEK.firstDay, WEEK.lastDay)).toHaveLength(0);
	});
});

describe('cases verrouillées par une absence (cf. absences.ts syncAbsenceEntries)', () => {
	async function makeLockedCongeCell(prefix: string) {
		const { workspaceId, userId } = await makeWorkspace(prefix);
		await createAbsenceFor(
			workspaceId,
			{ userId },
			{ startDate: MONDAY, endDate: MONDAY, type: 'CONGE_VALIDE', period: 'FULL' }
		);
		const [conge] = (await listCategories(workspaceId)).filter((c) => c.label === 'Congé');
		return { workspaceId, userId, conge };
	}

	it('getWeek expose le jour verrouillé (lockedDays) avec l\'id de l\'absence source, et le type d\'absence de la ligne', async () => {
		const { workspaceId, userId, conge } = await makeLockedCongeCell('lock-read');

		const week = await getWeek(workspaceId, userId, MONDAY);
		const row = week.rows.find((r) => r.targetId === conge.id)!;
		expect(row.lockedDays[MONDAY]).toEqual(expect.any(String));
		expect(row.lockedDays[FRIDAY]).toBeUndefined();
		expect(row.absenceType).toBe('CONGE_VALIDE');
	});

	it("absenceType reste null sur une ligne catégorie sans lien avec une absence", async () => {
		const { workspaceId, userId } = await makeWorkspace('lock-no-link');
		const mco = (await listCategories(workspaceId)).find((c) => c.label === 'MCO')!;
		await setCell(workspaceId, userId, { targetType: 'CATEGORY', targetId: mco.id, activityId: null, day: MONDAY, amount: 1 });

		const week = await getWeek(workspaceId, userId, MONDAY);
		const row = week.rows.find((r) => r.targetId === mco.id)!;
		expect(row.absenceType).toBeNull();
		expect(row.lockedDays[MONDAY]).toBeUndefined();
	});

	it('setCell refuse de modifier une case verrouillée', async () => {
		const { workspaceId, userId, conge } = await makeLockedCongeCell('lock-setcell');

		await expect(
			setCell(workspaceId, userId, { targetType: 'CATEGORY', targetId: conge.id, activityId: null, day: MONDAY, amount: 0.5 })
		).rejects.toThrow();
		// Idem pour la remise à zéro (suppression) — même garde-fou.
		await expect(
			setCell(workspaceId, userId, { targetType: 'CATEGORY', targetId: conge.id, activityId: null, day: MONDAY, amount: 0 })
		).rejects.toThrow();

		const week = await getWeek(workspaceId, userId, MONDAY);
		expect(week.rows.find((r) => r.targetId === conge.id)?.amounts[MONDAY]).toBe(1);
	});

	it("setCell refuse toute saisie manuelle sur une catégorie liée à un type d'absence, même un jour non verrouillé", async () => {
		const { workspaceId, userId, conge } = await makeLockedCongeCell('lock-setcell-other-day');

		await expect(
			setCell(workspaceId, userId, { targetType: 'CATEGORY', targetId: conge.id, activityId: null, day: FRIDAY, amount: 1 })
		).rejects.toThrow();

		const week = await getWeek(workspaceId, userId, MONDAY);
		const row = week.rows.find((r) => r.targetId === conge.id)!;
		expect(row.amounts[MONDAY]).toBe(1);
		expect(row.amounts[FRIDAY]).toBeUndefined();
	});

	it("pinRow refuse d'épingler une catégorie liée à un type d'absence", async () => {
		const { workspaceId, userId, conge } = await makeLockedCongeCell('lock-pinrow');

		await expect(
			pinRow(workspaceId, userId, { targetType: 'CATEGORY', targetId: conge.id, activityId: null, firstDay: MONDAY, lastDay: FRIDAY })
		).rejects.toThrow();
	});

	it("deleteRow retire une case manuelle historique mais laisse intacte celle de l'absence", async () => {
		const { workspaceId, userId, conge } = await makeLockedCongeCell('lock-deleterow');
		// Une case manuelle sur un autre jour de la même ligne, à côté de la case verrouillée — insérée
		// directement (setCell refuse désormais toute saisie manuelle sur cette catégorie) pour simuler
		// une entrée antérieure à ce garde-fou, que deleteRow doit pouvoir nettoyer.
		await db.insert(timeEntry).values({ workspaceId, userId, targetType: 'CATEGORY', categoryId: conge.id, day: FRIDAY, amount: '1' });

		await deleteRow(workspaceId, userId, { targetType: 'CATEGORY', targetId: conge.id, activityId: null, fromISO: MONDAY, toISO: FRIDAY });

		const week = await getWeek(workspaceId, userId, MONDAY);
		const row = week.rows.find((r) => r.targetId === conge.id);
		// La ligne existe encore (portée par la case verrouillée), mais la case manuelle a disparu.
		expect(row?.amounts[MONDAY]).toBe(1);
		expect(row?.amounts[FRIDAY]).toBeUndefined();
	});

	it("reassignActivity ignore les cases verrouillées et ne déplace que les cases manuelles", async () => {
		const { workspaceId, userId, conge } = await makeLockedCongeCell('lock-reassign');
		// Idem deleteRow ci-dessus : insérée directement, setCell refusant désormais toute saisie
		// manuelle sur une catégorie liée à un type d'absence.
		await db.insert(timeEntry).values({ workspaceId, userId, targetType: 'CATEGORY', categoryId: conge.id, day: FRIDAY, amount: '1' });
		await createActivity(workspaceId, 'Astreinte');
		const activity = (await listActivities(workspaceId)).find((a) => a.label === 'Astreinte')!;

		await reassignActivity(workspaceId, userId, {
			targetType: 'CATEGORY',
			targetId: conge.id,
			fromActivityId: null,
			toActivityId: activity.id,
			fromISO: MONDAY,
			toISO: FRIDAY
		});

		const week = await getWeek(workspaceId, userId, MONDAY);
		// La case verrouillée reste sur la ligne sans activité (id d'origine, activityId null).
		const lockedRow = week.rows.find((r) => r.targetId === conge.id && r.activityId === null);
		expect(lockedRow?.amounts[MONDAY]).toBe(1);
		// La case manuelle a bien suivi vers la nouvelle activité.
		const movedRow = week.rows.find((r) => r.targetId === conge.id && r.activityId === activity.id);
		expect(movedRow?.amounts[FRIDAY]).toBe(1);
	});
});

describe('pinRow / unpinRow / listPinnedRows', () => {
	it("une ligne épinglée sans aucune imputation reste listée — c'est tout l'intérêt du pin", async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'P-1', title: 'x' });

		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null, ...WEEK });
		const pinned = await listPinnedRows(workspaceId, userId, WEEK.firstDay, WEEK.lastDay);
		expect(pinned).toEqual([{ targetType: 'TICKET', targetId: t.id, activityId: null }]);
	});

	it("scopée à la période où elle a été ajoutée : n'apparaît pas sur une autre semaine", async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'P-SCOPE', title: 'x' });

		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null, ...WEEK });

		expect(await listPinnedRows(workspaceId, userId, WEEK.firstDay, WEEK.lastDay)).toHaveLength(1);
		expect(await listPinnedRows(workspaceId, userId, NEXT_WEEK.firstDay, NEXT_WEEK.lastDay)).toHaveLength(0);
	});

	it('idempotent : épingler deux fois la même ligne sur la même période ne crée pas de doublon', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'P-2', title: 'x' });

		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null, ...WEEK });
		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null, ...WEEK });

		expect(await listPinnedRows(workspaceId, userId, WEEK.firstDay, WEEK.lastDay)).toHaveLength(1);
	});

	it('épingler la même ligne sur une autre période crée une épingle séparée', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'P-MULTI', title: 'x' });

		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null, ...WEEK });
		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null, ...NEXT_WEEK });

		expect(await listPinnedRows(workspaceId, userId, WEEK.firstDay, WEEK.lastDay)).toHaveLength(1);
		expect(await listPinnedRows(workspaceId, userId, NEXT_WEEK.firstDay, NEXT_WEEK.lastDay)).toHaveLength(1);
	});

	it('unpinRow retire uniquement la ligne visée, sur la période affichée', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		const t1 = await createTicket(workspaceId, { key: 'P-3', title: 'x' });
		const t2 = await createTicket(workspaceId, { key: 'P-4', title: 'y' });
		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t1.id, activityId: null, ...WEEK });
		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t2.id, activityId: null, ...WEEK });

		await unpinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t1.id, activityId: null, fromISO: WEEK.firstDay, toISO: WEEK.lastDay });

		const pinned = await listPinnedRows(workspaceId, userId, WEEK.firstDay, WEEK.lastDay);
		expect(pinned.map((p) => p.targetId)).toEqual([t2.id]);
	});

	it("refuse d'épingler une cible qui n'existe pas dans l'espace", async () => {
		const { workspaceId, userId } = await makeWorkspace();
		await expect(
			pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', activityId: null, ...WEEK })
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

		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: t.id, activityId: null, ...WEEK });
		await reassignActivity(workspaceId, userId, {
			targetType: 'TICKET',
			targetId: t.id,
			fromActivityId: null,
			toActivityId: dev.id,
			fromISO: MONDAY,
			toISO: MONDAY
		});

		expect(await listPinnedRows(workspaceId, userId, WEEK.firstDay, WEEK.lastDay)).toEqual([
			{ targetType: 'TICKET', targetId: t.id, activityId: dev.id }
		]);
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
