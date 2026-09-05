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
import { createTicket, listTicketSummaries } from './tickets';
import { createPerimeter } from './perimeters';
import { listCategories, createActivity, listActivities } from './params';
import { createAbsenceFor } from './absences';
import { addObjective, listObjectivesForUser } from './weeklyObjectives';
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
		expect(pinned).toEqual([{ targetType: 'TICKET', targetId: t.id, activityId: null, objectiveId: null }]);
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
			{ targetType: 'TICKET', targetId: t.id, activityId: dev.id, objectiveId: null }
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

describe('objectiveId sur une ligne TICKET (deux objectifs sur le même ticket, cf. weeklyObjectives)', () => {
	const WEEK_MONDAY = '2026-06-22'; // == MONDAY, même semaine que WEEK

	async function twoObjectivesOnSameTicket(prefix: string) {
		const { workspaceId, userId } = await makeWorkspace(prefix);
		const t = await createTicket(workspaceId, { key: `${prefix}-T`, title: 'MCO parapluie' });
		await addObjective(workspaceId, userId, { userId, weekMondayISO: WEEK_MONDAY, kind: 'TICKET', ticketId: t.id, label: 'Support niveau 1' });
		await addObjective(workspaceId, userId, { userId, weekMondayISO: WEEK_MONDAY, kind: 'TICKET', ticketId: t.id, label: 'Astreinte' });
		const [objA, objB] = await listObjectivesForUser(workspaceId, userId, WEEK_MONDAY);
		return { workspaceId, userId, ticket: t, objA, objB };
	}

	it('deux setCell sur le même ticket avec des objectiveId différents créent deux lignes distinctes', async () => {
		const { workspaceId, userId, ticket, objA, objB } = await twoObjectivesOnSameTicket('obj-setcell');

		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: ticket.id, activityId: null, day: MONDAY, amount: 2, objectiveId: objA.id });
		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: ticket.id, activityId: null, day: MONDAY, amount: 1, objectiveId: objB.id });

		const week = await getWeek(workspaceId, userId, MONDAY);
		const rows = week.rows.filter((r) => r.targetId === ticket.id);
		expect(rows).toHaveLength(2);
		const byNote = new Map(rows.map((r) => [r.objectiveNote, r]));
		expect(byNote.get('Support niveau 1')?.amounts[MONDAY]).toBe(2);
		expect(byNote.get('Astreinte')?.amounts[MONDAY]).toBe(1);
		expect(week.dayTotals[MONDAY]).toBe(3);

		// Un second setCell sur le même (ticket, objectiveId) met à jour la ligne existante — pas un 3e doublon.
		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: ticket.id, activityId: null, day: MONDAY, amount: 5, objectiveId: objA.id });
		const week2 = await getWeek(workspaceId, userId, MONDAY);
		const rows2 = week2.rows.filter((r) => r.targetId === ticket.id);
		expect(rows2).toHaveLength(2);
		expect(rows2.find((r) => r.objectiveId === objA.id)?.amounts[MONDAY]).toBe(5);
	});

	it("une imputation directe sur le ticket sans objectiveId reste une ligne à part (objectiveId null)", async () => {
		const { workspaceId, userId, ticket, objA } = await twoObjectivesOnSameTicket('obj-direct');

		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: ticket.id, activityId: null, day: MONDAY, amount: 1, objectiveId: objA.id });
		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: ticket.id, activityId: null, day: MONDAY, amount: 4 });

		const week = await getWeek(workspaceId, userId, MONDAY);
		const rows = week.rows.filter((r) => r.targetId === ticket.id);
		expect(rows).toHaveLength(2);
		expect(rows.find((r) => r.objectiveId === null)?.amounts[MONDAY]).toBe(4);
		expect(rows.find((r) => r.objectiveId === objA.id)?.amounts[MONDAY]).toBe(1);
	});

	it("reassignActivity sur une des deux lignes n'affecte pas l'autre (même ticket, autre objectif)", async () => {
		const { workspaceId, userId, ticket, objA, objB } = await twoObjectivesOnSameTicket('obj-reassign');
		await createActivity(workspaceId, `Dev-${ticket.id}`);
		const dev = (await listActivities(workspaceId)).find((a) => a.label === `Dev-${ticket.id}`)!;

		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: ticket.id, activityId: null, day: MONDAY, amount: 2, objectiveId: objA.id });
		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: ticket.id, activityId: null, day: MONDAY, amount: 1, objectiveId: objB.id });

		await reassignActivity(workspaceId, userId, {
			targetType: 'TICKET',
			targetId: ticket.id,
			fromActivityId: null,
			toActivityId: dev.id,
			fromISO: MONDAY,
			toISO: MONDAY,
			objectiveId: objA.id
		});

		const week = await getWeek(workspaceId, userId, MONDAY);
		const rows = week.rows.filter((r) => r.targetId === ticket.id);
		expect(rows).toHaveLength(2);
		expect(rows.find((r) => r.objectiveId === objA.id)?.activityId).toBe(dev.id);
		expect(rows.find((r) => r.objectiveId === objB.id)?.activityId).toBeNull();
		expect(rows.find((r) => r.objectiveId === objB.id)?.amounts[MONDAY]).toBe(1);
	});

	it('deleteRow ne supprime que la ligne visée (même ticket, autre objectif intact)', async () => {
		const { workspaceId, userId, ticket, objA, objB } = await twoObjectivesOnSameTicket('obj-delete');

		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: ticket.id, activityId: null, day: MONDAY, amount: 2, objectiveId: objA.id });
		await setCell(workspaceId, userId, { targetType: 'TICKET', targetId: ticket.id, activityId: null, day: MONDAY, amount: 1, objectiveId: objB.id });

		await deleteRow(workspaceId, userId, { targetType: 'TICKET', targetId: ticket.id, activityId: null, fromISO: MONDAY, toISO: MONDAY, objectiveId: objA.id });

		const week = await getWeek(workspaceId, userId, MONDAY);
		const rows = week.rows.filter((r) => r.targetId === ticket.id);
		expect(rows).toHaveLength(1);
		expect(rows[0].objectiveId).toBe(objB.id);
		expect(rows[0].amounts[MONDAY]).toBe(1);
	});

	it('pinRow avec deux objectiveId sur le même ticket produit deux PinnedRow distincts', async () => {
		const { workspaceId, userId, ticket, objA, objB } = await twoObjectivesOnSameTicket('obj-pin');

		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: ticket.id, activityId: null, firstDay: MONDAY, lastDay: FRIDAY, objectiveId: objA.id });
		await pinRow(workspaceId, userId, { targetType: 'TICKET', targetId: ticket.id, activityId: null, firstDay: MONDAY, lastDay: FRIDAY, objectiveId: objB.id });

		const pinned = await listPinnedRows(workspaceId, userId, WEEK.firstDay, WEEK.lastDay);
		expect(pinned).toHaveLength(2);
		expect(new Set(pinned.map((p) => p.objectiveId))).toEqual(new Set([objA.id, objB.id]));
	});

	it("refuse un objectiveId qui ne désigne pas un objectif de ce ticket/cette personne", async () => {
		const { workspaceId, userId, ticket } = await twoObjectivesOnSameTicket('obj-guard');
		const { workspaceId: otherWs, userId: otherUser } = await makeWorkspace('obj-guard-other');
		const otherTicket = await createTicket(otherWs, { key: 'OTHER-T', title: 'y' });
		await addObjective(otherWs, otherUser, { userId: otherUser, weekMondayISO: WEEK_MONDAY, kind: 'TICKET', ticketId: otherTicket.id });
		const [foreignObj] = await listObjectivesForUser(otherWs, otherUser, WEEK_MONDAY);

		// objectiveId d'un autre espace/ticket.
		await expect(
			setCell(workspaceId, userId, { targetType: 'TICKET', targetId: ticket.id, activityId: null, day: MONDAY, amount: 1, objectiveId: foreignObj.id })
		).rejects.toThrow();

		// objectiveId inexistant.
		await expect(
			setCell(workspaceId, userId, {
				targetType: 'TICKET',
				targetId: ticket.id,
				activityId: null,
				day: MONDAY,
				amount: 1,
				objectiveId: 'ffffffff-ffff-ffff-ffff-ffffffffffff'
			})
		).rejects.toThrow();
	});
});

describe('périmètre sur la feuille d’imputation', () => {
	/** Un espace avec deux périmètres, un ticket dans chacun, et une catégorie (sans périmètre). */
	async function fixture(tag: string) {
		const ws = await makeWorkspace(`imp-perim-${tag}`);
		const web = await createPerimeter(ws.workspaceId, `Web ${tag}`, '#111111', false);
		const mobile = await createPerimeter(ws.workspaceId, `Mobile ${tag}`, '#222222', false);
		// Le périmètre par défaut de l'espace vient en premier (sortOrder 0) ; les deux nôtres suivent
		// dans leur ordre de création — c'est cet ordre que le tri doit respecter.
		const tWeb = await createTicket(ws.workspaceId, { key: `PW-${tag}`, title: 'Zeta web', perimeterId: web });
		const tMobile = await createTicket(ws.workspaceId, { key: `PM-${tag}`, title: 'Alpha mobile', perimeterId: mobile });
		// MCO et non « Congé » : les catégories liées à un type d'absence ne sont pas imputables
		// directement (elles sont alimentées depuis la page Absences).
		const [mco] = (await listCategories(ws.workspaceId)).filter((c) => c.label === 'MCO');
		return { ws, web, mobile, tWeb, tMobile, mco };
	}

	it('une ligne de ticket porte son périmètre, une catégorie n’en a pas et reste présente', async () => {
		const f = await fixture('base');
		await setCell(f.ws.workspaceId, f.ws.userId, {
			targetType: 'TICKET',
			targetId: f.tWeb.id,
			activityId: null,
			day: MONDAY,
			amount: 1
		});
		// Le cas que le leftJoin protège : une catégorie n'a pas de ticket, donc pas de périmètre.
		// Avec un innerJoin, cette ligne disparaîtrait purement et simplement de la feuille.
		await setCell(f.ws.workspaceId, f.ws.userId, {
			targetType: 'CATEGORY',
			targetId: f.mco.id,
			activityId: null,
			day: MONDAY,
			amount: 1
		});

		const week = await getWeek(f.ws.workspaceId, f.ws.userId, MONDAY);
		const ticketRow = week.rows.find((r) => r.targetId === f.tWeb.id)!;
		const categoryRow = week.rows.find((r) => r.targetId === f.mco.id)!;

		expect(ticketRow.perimeterId).toBe(f.web);
		expect(ticketRow.perimeterName).toBe(`Web base`);
		expect(ticketRow.perimeterColor).toBe('#111111');
		expect(categoryRow).toBeDefined();
		expect(categoryRow.perimeterId).toBeNull();
	});

	it('les lignes sont groupées par périmètre, les catégories en dernier, dans un ordre stable', async () => {
		const f = await fixture('ordre');
		for (const [type, id] of [
			['CATEGORY', f.mco.id],
			['TICKET', f.tMobile.id],
			['TICKET', f.tWeb.id]
		] as const) {
			await setCell(f.ws.workspaceId, f.ws.userId, {
				targetType: type,
				targetId: id,
				activityId: null,
				day: MONDAY,
				amount: 1
			});
		}

		const week = await getWeek(f.ws.workspaceId, f.ws.userId, MONDAY);
		// Web a été créé avant Mobile : il passe donc devant, quel que soit l'ordre de saisie.
		expect(week.rows.map((r) => r.perimeterName)).toEqual(['Web ordre', 'Mobile ordre', null]);

		// Stable : sans le tri, l'ordre venait de la base et changeait d'un appel à l'autre.
		const again = await getWeek(f.ws.workspaceId, f.ws.userId, MONDAY);
		expect(again.rows.map((r) => r.rowKey)).toEqual(week.rows.map((r) => r.rowKey));
	});

	it('listTicketSummaries remonte le périmètre (palette d’ajout + lignes construites côté client)', async () => {
		const f = await fixture('summ');
		const summaries = await listTicketSummaries(f.ws.workspaceId);
		const web = summaries.find((t) => t.id === f.tWeb.id)!;
		expect(web.perimeterId).toBe(f.web);
		expect(web.perimeterName).toBe('Web summ');
		expect(web.perimeterTransverse).toBe(false);
	});
});
