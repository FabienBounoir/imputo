import { describe, it, expect } from 'vitest';
import { mergeRecurringObjectiveRows, type Row } from './imputationRow';
import { addDays, mondayOf, parseISODate, toISODate } from './utils/date';

// Deux semaines ouvrées consécutives, dérivées et non écrites en dur : le test porte sur la
// fusion, pas sur le calendrier.
const W1 = toISODate(mondayOf(parseISODate('2026-09-15')));
const W2 = toISODate(addDays(parseISODate(W1), 7));
const workWeek = (monday: string) => Array.from({ length: 5 }, (_, i) => toISODate(addDays(parseISODate(monday), i)));
const DAYS = [...workWeek(W1), ...workWeek(W2)];
const WEEKS = new Map([
	['o1', W1],
	['o2', W2]
]);

function row(over: Partial<Row> & { targetId: string }): Row {
	return {
		rowKey: `${over.targetId}:${over.activityId ?? ''}:${over.objectiveId ?? ''}`,
		targetType: 'TICKET',
		activityId: null,
		objectiveId: null,
		objectiveNote: null,
		label: 'API paiement',
		sublabel: 'T-1',
		emoji: '🎫',
		nonProductive: false,
		sprintName: null,
		versionName: null,
		raeReal: null,
		estimation: null,
		raeAge: 0,
		amounts: {},
		lockedDays: {},
		absenceType: null,
		...over
	};
}

describe('fusion des objectifs reconduits (Mon imputation, quinzaine / mois)', () => {
	it('replie en une seule ligne le même objectif reconduit sur deux semaines', () => {
		const merged = mergeRecurringObjectiveRows(
			[
				row({ targetId: 'T', objectiveId: 'o1', objectiveNote: 'API', amounts: { [DAYS[0]]: 1 } }),
				row({ targetId: 'T', objectiveId: 'o2', objectiveNote: 'API', amounts: { [DAYS[5]]: 2 } })
			],
			WEEKS,
			DAYS
		);
		expect(merged).toHaveLength(1);
		expect(merged[0].amounts).toEqual({ [DAYS[0]]: 1, [DAYS[5]]: 2 });
	});

	it('rattache chaque jour à l’objectif de SA semaine', () => {
		const merged = mergeRecurringObjectiveRows(
			[
				row({ targetId: 'T', objectiveId: 'o1', objectiveNote: 'API' }),
				row({ targetId: 'T', objectiveId: 'o2', objectiveNote: 'API' })
			],
			WEEKS,
			DAYS
		);
		const byDay = merged[0].objectiveByDay!;
		for (const d of workWeek(W1)) expect(byDay[d], d).toBe('o1');
		for (const d of workWeek(W2)) expect(byDay[d], d).toBe('o2');
	});

	// Sans ça, setCell ne retrouverait pas l'entrée déjà enregistrée et en insérerait une seconde
	// le même jour : le total du jour doublerait.
	it('garde, pour un jour déjà saisi, l’objectif sous lequel il a été enregistré', () => {
		const stray = DAYS[1]; // un jour de la semaine 1, mais saisi sous l'objectif de la semaine 2
		const merged = mergeRecurringObjectiveRows(
			[
				row({ targetId: 'T', objectiveId: 'o1', objectiveNote: 'API' }),
				row({ targetId: 'T', objectiveId: 'o2', objectiveNote: 'API', amounts: { [stray]: 0.5 } })
			],
			WEEKS,
			DAYS
		);
		expect(merged[0].objectiveByDay![stray]).toBe('o2');
		expect(merged[0].objectiveByDay![DAYS[0]]).toBe('o1');
	});

	// La contrainte explicite : deux activités = deux lignes, comme partout ailleurs dans la feuille.
	it('ne fusionne jamais deux objectifs portant des activités différentes', () => {
		const merged = mergeRecurringObjectiveRows(
			[
				row({ targetId: 'T', activityId: 'dev', objectiveId: 'o1', objectiveNote: 'API' }),
				row({ targetId: 'T', activityId: 'test', objectiveId: 'o2', objectiveNote: 'API' })
			],
			WEEKS,
			DAYS
		);
		expect(merged).toHaveLength(2);
	});

	// Comportement voulu et testé côté serveur : deux objectifs distincts sur le même ticket la
	// même semaine restent deux lignes.
	it('ne fusionne pas deux objectifs de libellés différents', () => {
		const merged = mergeRecurringObjectiveRows(
			[
				row({ targetId: 'T', objectiveId: 'o1', objectiveNote: 'Support niveau 1' }),
				row({ targetId: 'T', objectiveId: 'o1b', objectiveNote: 'Astreinte' })
			],
			new Map([
				['o1', W1],
				['o1b', W1]
			]),
			DAYS
		);
		expect(merged).toHaveLength(2);
	});

	it('laisse intactes les lignes sans objectif', () => {
		const direct = row({ targetId: 'T', amounts: { [DAYS[0]]: 3 } });
		const merged = mergeRecurringObjectiveRows([direct, row({ targetId: 'T', objectiveId: 'o1', objectiveNote: 'API' })], WEEKS, DAYS);
		expect(merged).toHaveLength(2);
		expect(merged[0]).toBe(direct);
		expect(merged[0].objectiveByDay).toBeUndefined();
	});

	it('additionne deux saisies tombées le même jour sous des objectifs repliés', () => {
		const merged = mergeRecurringObjectiveRows(
			[
				row({ targetId: 'T', objectiveId: 'o1', objectiveNote: 'API', amounts: { [DAYS[0]]: 0.125 } }),
				row({ targetId: 'T', objectiveId: 'o2', objectiveNote: 'API', amounts: { [DAYS[0]]: 0.25 } })
			],
			WEEKS,
			DAYS
		);
		expect(merged[0].amounts[DAYS[0]]).toBe(0.375);
	});
});
