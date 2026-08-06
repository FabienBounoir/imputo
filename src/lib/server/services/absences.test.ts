import { describe, it, expect } from 'vitest';
import { buildAbsenceGrid, type AbsenceWithUser } from './absences';

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
