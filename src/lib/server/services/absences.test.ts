import { describe, it, expect } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db, category } from '$lib/server/db';
import {
	buildAbsenceGrid,
	type AbsenceWithUser,
	createAbsenceFor,
	createHalfDayRangeFor,
	updateAbsence,
	validateAbsence,
	deleteAbsence,
	addExternalMember,
	listExternalMembers,
	listAbsencesForUser
} from './absences';
import { getWeek } from './imputation';
import { listCategories, setCategoryArchived } from './params';
import { makeWorkspace, addMember } from './test-helpers';

const createdAt = new Date('2026-06-01T09:00:00Z');

const abs = (over: Partial<AbsenceWithUser>): AbsenceWithUser => ({
	id: 'a1',
	subjectId: 'u1',
	startDate: '2026-06-01',
	endDate: '2026-06-01',
	type: 'CONGE_VALIDE',
	period: 'FULL',
	createdAt,
	validatedAt: null,
	validatedByName: null,
	displayName: 'Alice',
	external: false,
	...over
});

describe('buildAbsenceGrid', () => {
	it('place une absence d\'un jour sur le bon jour', () => {
		const grid = buildAbsenceGrid([abs({})], ['2026-06-01', '2026-06-02']);
		expect(grid.u1['2026-06-01']).toEqual({
			id: 'a1',
			startDate: '2026-06-01',
			endDate: '2026-06-01',
			type: 'CONGE_VALIDE',
			period: 'FULL',
			createdAt,
			validatedAt: null,
			validatedByName: null
		});
		expect(grid.u1['2026-06-02']).toBeUndefined();
	});

	it('expanse une plage multi-jours sur chaque jour', () => {
		const grid = buildAbsenceGrid(
			[abs({ startDate: '2026-06-01', endDate: '2026-06-03' })],
			['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04']
		);
		expect(Object.keys(grid.u1).sort()).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
	});

	it('ignore les jours hors de la fenêtre demandée', () => {
		const grid = buildAbsenceGrid([abs({ startDate: '2026-05-30', endDate: '2026-06-02' })], ['2026-06-01', '2026-06-02']);
		expect(Object.keys(grid.u1).sort()).toEqual(['2026-06-01', '2026-06-02']);
	});

	it('garde le type et la demi-journée sur chaque cellule', () => {
		const grid = buildAbsenceGrid([abs({ type: 'FORMATION', period: 'PM' })], ['2026-06-01']);
		expect(grid.u1['2026-06-01']).toMatchObject({ type: 'FORMATION', period: 'PM' });
	});

	it('indexe séparément un membre externe (subjectId distinct)', () => {
		const grid = buildAbsenceGrid([abs({ subjectId: 'ext1', external: true, displayName: 'Client X' })], ['2026-06-01']);
		expect(grid.ext1['2026-06-01']).toMatchObject({ type: 'CONGE_VALIDE', period: 'FULL' });
	});

	it('porte l\'id de l\'absence, pour permettre son édition depuis la grille', () => {
		const grid = buildAbsenceGrid([abs({ id: 'abs-42', startDate: '2026-06-01', endDate: '2026-06-05' })], ['2026-06-03']);
		expect(grid.u1['2026-06-03']).toMatchObject({ id: 'abs-42', startDate: '2026-06-01', endDate: '2026-06-05' });
	});
});

describe('sync absence → "Mon imputation"', () => {
	const MONDAY = '2026-06-22';

	it('un congé validé impute chaque jour ouvré sur la catégorie liée, sur la catégorie "Congé"', async () => {
		const { workspaceId, userId } = await makeWorkspace('sync-conge');
		await createAbsenceFor(
			workspaceId,
			{ userId },
			{ startDate: '2026-06-22', endDate: '2026-06-24', type: 'CONGE_VALIDE', period: 'FULL' }
		);

		const cats = await listCategories(workspaceId);
		const conge = cats.find((c) => c.label === 'Congé');
		expect(conge?.locked).toBe(true);

		const week = await getWeek(workspaceId, userId, MONDAY);
		const row = week.rows.find((r) => r.targetId === conge!.id);
		expect(row?.amounts['2026-06-22']).toBe(1);
		expect(row?.amounts['2026-06-23']).toBe(1);
		expect(row?.amounts['2026-06-24']).toBe(1);
		expect(row?.amounts['2026-06-25']).toBeUndefined();
	});

	it('une absence en demi-journée impute 0.5', async () => {
		const { workspaceId, userId } = await makeWorkspace('sync-half');
		await createAbsenceFor(
			workspaceId,
			{ userId },
			{ startDate: '2026-06-22', endDate: '2026-06-22', type: 'FORMATION', period: 'AM' }
		);

		const cats = await listCategories(workspaceId);
		const formation = cats.find((c) => c.label === 'Formation');
		const week = await getWeek(workspaceId, userId, MONDAY);
		expect(week.rows.find((r) => r.targetId === formation!.id)?.amounts['2026-06-22']).toBe(0.5);
	});

	it("un congé prévisionnel n'impute rien tant qu'il n'est pas validé", async () => {
		const { workspaceId, userId } = await makeWorkspace('sync-prov');
		await createAbsenceFor(
			workspaceId,
			{ userId },
			{ startDate: '2026-06-22', endDate: '2026-06-22', type: 'CONGE_PREVISIONNEL', period: 'FULL' }
		);

		const week = await getWeek(workspaceId, userId, MONDAY);
		expect(week.rows).toHaveLength(0);
	});

	it('valider un congé prévisionnel impute rétroactivement', async () => {
		const { workspaceId, userId } = await makeWorkspace('sync-validate');
		const absenceId = await createAbsenceFor(
			workspaceId,
			{ userId },
			{ startDate: '2026-06-22', endDate: '2026-06-22', type: 'CONGE_PREVISIONNEL', period: 'FULL' }
		);

		await validateAbsence(workspaceId, absenceId, userId);

		const week = await getWeek(workspaceId, userId, MONDAY);
		expect(week.rows).toHaveLength(1);
		expect(week.rows[0].amounts['2026-06-22']).toBe(1);
	});

	it('modifier les dates resynchronise (ancien jour retiré, nouveau jour ajouté)', async () => {
		const { workspaceId, userId } = await makeWorkspace('sync-update');
		const absenceId = await createAbsenceFor(
			workspaceId,
			{ userId },
			{ startDate: '2026-06-22', endDate: '2026-06-22', type: 'CONGE_VALIDE', period: 'FULL' }
		);

		await updateAbsence(workspaceId, userId, false, absenceId, {
			startDate: '2026-06-23',
			endDate: '2026-06-23',
			type: 'CONGE_VALIDE',
			period: 'FULL'
		});

		const week = await getWeek(workspaceId, userId, MONDAY);
		expect(week.rows).toHaveLength(1);
		expect(week.rows[0].amounts['2026-06-22']).toBeUndefined();
		expect(week.rows[0].amounts['2026-06-23']).toBe(1);
	});

	it("supprimer l'absence retire ses imputations (cascade en base)", async () => {
		const { workspaceId, userId } = await makeWorkspace('sync-delete');
		const absenceId = await createAbsenceFor(
			workspaceId,
			{ userId },
			{ startDate: '2026-06-22', endDate: '2026-06-22', type: 'CONGE_VALIDE', period: 'FULL' }
		);

		await deleteAbsence(workspaceId, userId, absenceId, false);

		const week = await getWeek(workspaceId, userId, MONDAY);
		expect(week.rows).toHaveLength(0);
	});

	it("l'absence d'un membre externe (pas de compte) n'essaie pas d'imputer", async () => {
		const { workspaceId } = await makeWorkspace('sync-ext');
		await addExternalMember(workspaceId, 'Client externe');
		const [ext] = await listExternalMembers(workspaceId);

		await expect(
			createAbsenceFor(
				workspaceId,
				{ externalMemberId: ext.id },
				{ startDate: '2026-06-22', endDate: '2026-06-22', type: 'CONGE_VALIDE', period: 'FULL' }
			)
		).resolves.not.toThrow();
	});

	it('la catégorie liée à un type d\'absence ne peut pas être archivée', async () => {
		const { workspaceId, userId } = await makeWorkspace('sync-lock');
		await createAbsenceFor(
			workspaceId,
			{ userId },
			{ startDate: '2026-06-22', endDate: '2026-06-22', type: 'CONGE_VALIDE', period: 'FULL' }
		);

		const cats = await listCategories(workspaceId);
		const conge = cats.find((c) => c.label === 'Congé')!;
		await expect(setCategoryArchived(workspaceId, conge.id, true)).rejects.toThrow();
	});

	it("un jour férié dans la plage n'est pas imputé (déjà hors capacité)", async () => {
		const { workspaceId, userId } = await makeWorkspace('sync-holiday');
		// Lundi 27/04 → vendredi 01/05/2026 : le 1er mai (Fête du travail) tombe un vendredi ouvré
		// mais doit rester hors imputation, sinon le total saisi dépasse la capacité de la période
		// (qui l'exclut déjà, cf. imputation/+page.svelte periodCapacity).
		await createAbsenceFor(
			workspaceId,
			{ userId },
			{ startDate: '2026-04-27', endDate: '2026-05-01', type: 'CONGE_VALIDE', period: 'FULL' }
		);

		const cats = await listCategories(workspaceId);
		const conge = cats.find((c) => c.label === 'Congé')!;
		const week = await getWeek(workspaceId, userId, '2026-04-27');
		const row = week.rows.find((r) => r.targetId === conge.id)!;
		expect(row.amounts['2026-04-27']).toBe(1);
		expect(row.amounts['2026-04-28']).toBe(1);
		expect(row.amounts['2026-04-29']).toBe(1);
		expect(row.amounts['2026-04-30']).toBe(1);
		expect(row.amounts['2026-05-01']).toBeUndefined();
		expect(row.total).toBe(4);
	});

	it('plusieurs congés validés créés en parallèle sur un espace sans catégorie "Congé" ne se marchent pas dessus (course sur la première synchronisation)', async () => {
		const { workspaceId, userId } = await makeWorkspace('sync-race');
		// Assez de membres en parallèle pour fiabiliser la reproduction de la course : avec 2 seuls
		// appels concurrents, le second select "byLabel"/insert peut par chance s'exécuter après que
		// le premier ait déjà commité, masquant le bug sans le corriger (reproduit de façon fiable
		// avec ~8 appels lors de l'investigation).
		const others = await Promise.all(Array.from({ length: 7 }, (_, i) => addMember(workspaceId, 'USER', `sync-race-m${i}`)));
		const userIds = [userId, ...others.map((m) => m.userId)];
		// Simule un espace créé avant cette fonctionnalité, ou dont la catégorie a été supprimée
		// entre-temps : aucune catégorie "Congé" du tout, taguée ou non.
		await db.delete(category).where(and(eq(category.workspaceId, workspaceId), sql`lower(${category.label}) = 'congé'`));

		const results = await Promise.allSettled(
			userIds.map((uid) =>
				createAbsenceFor(
					workspaceId,
					{ userId: uid },
					{ startDate: '2026-06-22', endDate: '2026-06-22', type: 'CONGE_VALIDE', period: 'FULL' }
				)
			)
		);

		expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
		const cats = await listCategories(workspaceId);
		expect(cats.filter((c) => c.label.toLowerCase() === 'congé')).toHaveLength(1);

		const conge = cats.find((c) => c.label.toLowerCase() === 'congé')!;
		for (const uid of userIds) {
			const week = await getWeek(workspaceId, uid, '2026-06-22');
			expect(week.rows.find((r) => r.targetId === conge.id)?.amounts['2026-06-22']).toBe(1);
		}
	});

	it("modifier une absence vers un id inexistant échoue sans laisser de catégorie orpheline", async () => {
		const { workspaceId } = await makeWorkspace('sync-update-404');
		await expect(
			updateAbsence(workspaceId, crypto.randomUUID(), true, crypto.randomUUID(), {
				startDate: '2026-06-22',
				endDate: '2026-06-22',
				type: 'CONGE_VALIDE',
				period: 'FULL'
			})
		).rejects.toThrow();

		// La transaction (update 0 ligne → throw) ne doit pas avoir exécuté syncAbsenceEntries : la
		// catégorie "Congé" par défaut reste la seule, non modifiée par cet appel raté.
		const cats = await listCategories(workspaceId);
		expect(cats.filter((c) => c.label === 'Congé')).toHaveLength(1);
	});
});

describe('createHalfDayRangeFor', () => {
	it('crée une ligne par jour de la plage, période conservée sur chacune', async () => {
		const { userId, workspaceId } = await makeWorkspace('half-range');
		const ids = await createHalfDayRangeFor(
			workspaceId,
			{ userId },
			{ startDate: '2026-06-01', endDate: '2026-06-03', type: 'FORMATION', period: 'AM' }
		);
		expect(ids).toHaveLength(3);

		const rows = await listAbsencesForUser(workspaceId, userId);
		const created = rows.filter((r) => r.startDate >= '2026-06-01' && r.startDate <= '2026-06-03');
		expect(created).toHaveLength(3);
		expect(created.every((r) => r.period === 'AM' && r.startDate === r.endDate)).toBe(true);
	});

	it('rejette une plage trop longue sans rien créer (garde-fou contre une boucle DB démesurée)', async () => {
		const { userId, workspaceId } = await makeWorkspace('half-range-cap');
		await expect(
			createHalfDayRangeFor(workspaceId, { userId }, { startDate: '2026-01-01', endDate: '2026-12-31', type: 'FORMATION', period: 'AM' })
		).rejects.toThrow(/plage trop longue/i);

		const rows = await listAbsencesForUser(workspaceId, userId);
		expect(rows).toHaveLength(0);
	});
});
