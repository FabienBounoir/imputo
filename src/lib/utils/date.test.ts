import { describe, it, expect } from 'vitest';
import {
	countWorkdays,
	countWorkdaysNonHoliday,
	isPublicHolidayFR,
	isWorkday,
	previousWorkday,
	todayInParis,
	formatRange,
	formatDayRange,
	formatMonthLabel,
	parseISODate,
	currentMoodPeriod,
	lastWorkdayOnOrBefore,
	currentSupportPeriod,
	supportPeriodIndex,
	buildPeriod,
	fortnightBounds,
	monthBounds,
	workdaysBetween,
	type Granularity
} from './date';

describe('countWorkdays', () => {
	it('compte 5 jours sur une semaine pleine (lun→dim)', () => {
		// 2026-06-01 = lundi
		expect(countWorkdays('2026-06-01', '2026-06-07')).toBe(5);
	});

	it('exclut le week-end', () => {
		// samedi → dimanche
		expect(countWorkdays('2026-06-06', '2026-06-07')).toBe(0);
	});

	it('inclut les deux bornes', () => {
		// lundi → mardi
		expect(countWorkdays('2026-06-01', '2026-06-02')).toBe(2);
	});

	it('renvoie 0 si from > to', () => {
		expect(countWorkdays('2026-06-10', '2026-06-01')).toBe(0);
	});

	it('compte un mois (juin 2026 = 22 jours ouvrés)', () => {
		expect(countWorkdays('2026-06-01', '2026-06-30')).toBe(22);
	});
});

describe('isWorkday', () => {
	it('lundi → vendredi = ouvré', () => {
		expect(isWorkday('2026-06-01')).toBe(true); // lundi
		expect(isWorkday('2026-06-05')).toBe(true); // vendredi
	});
	it('week-end = non ouvré', () => {
		expect(isWorkday('2026-06-06')).toBe(false); // samedi
		expect(isWorkday('2026-06-07')).toBe(false); // dimanche
	});
});

describe('previousWorkday', () => {
	it('un mardi → le lundi', () => {
		expect(previousWorkday('2026-06-02')).toBe('2026-06-01');
	});
	it('un lundi → le vendredi précédent (saute le week-end)', () => {
		expect(previousWorkday('2026-06-01')).toBe('2026-05-29');
	});
});

describe('todayInParis', () => {
	it('renvoie une date au format ISO', () => {
		expect(todayInParis()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe('isPublicHolidayFR', () => {
	it('reconnaît les jours fériés fixes', () => {
		expect(isPublicHolidayFR('2026-01-01')).toBe(true); // jour de l'an
		expect(isPublicHolidayFR('2026-05-01')).toBe(true); // fête du travail
		expect(isPublicHolidayFR('2026-07-14')).toBe(true); // fête nationale
		expect(isPublicHolidayFR('2026-12-25')).toBe(true); // Noël
	});

	it('calcule les jours fériés mobiles depuis Pâques (Pâques 2026 = 5 avril)', () => {
		expect(isPublicHolidayFR('2026-04-06')).toBe(true); // lundi de Pâques
		expect(isPublicHolidayFR('2026-05-14')).toBe(true); // Ascension
		expect(isPublicHolidayFR('2026-05-25')).toBe(true); // lundi de Pentecôte
	});

	it('renvoie false pour un jour ouvré normal', () => {
		expect(isPublicHolidayFR('2026-06-15')).toBe(false);
	});
});

describe('countWorkdaysNonHoliday', () => {
	it('égal à countWorkdays sur un mois sans jour férié', () => {
		expect(countWorkdaysNonHoliday('2026-06-01', '2026-06-30')).toBe(countWorkdays('2026-06-01', '2026-06-30'));
	});

	it('déduit les 4 jours fériés ouvrés de mai 2026 (1er mai, 8 mai, Ascension, Pentecôte)', () => {
		const withHolidays = countWorkdays('2026-05-01', '2026-05-31');
		expect(countWorkdaysNonHoliday('2026-05-01', '2026-05-31')).toBe(withHolidays - 4);
	});
});

describe('formatRange', () => {
	it('même mois : le mois n\'apparaît qu\'une fois', () => {
		expect(formatRange(parseISODate('2026-07-06'))).toBe('6 → 10 juil. 2026');
	});
	it('chevauchement de mois : ajoute le mois du lundi', () => {
		expect(formatRange(parseISODate('2026-06-29'))).toBe('29 juin → 3 juil. 2026');
	});
	it('chevauchement d\'année : ajoute mois + année du lundi', () => {
		expect(formatRange(parseISODate('2025-12-29'))).toBe('29 déc. 2025 → 2 janv. 2026');
	});
});

describe('currentMoodPeriod', () => {
	// 2026-06-01 = lundi, 2026-06-03 = mercredi
	it('WEEK_1 démarrant lundi : mercredi retombe sur le lundi de la semaine', () => {
		expect(currentMoodPeriod('WEEK_1', 0, '2026-06-03')).toEqual({
			start: '2026-06-01',
			end: '2026-06-07'
		});
	});

	it('WEEK_1 démarrant mercredi : le jour de départ lui-même ouvre la plage', () => {
		expect(currentMoodPeriod('WEEK_1', 2, '2026-06-03')).toEqual({
			start: '2026-06-03',
			end: '2026-06-09'
		});
	});

	it('WEEK_2 démarrant vendredi : remonte au dernier vendredi, plage de 14 jours', () => {
		expect(currentMoodPeriod('WEEK_2', 4, '2026-06-03')).toEqual({
			start: '2026-05-29',
			end: '2026-06-11'
		});
	});

	it('WEEK_3 : plage de 21 jours', () => {
		const { start, end } = currentMoodPeriod('WEEK_3', 0, '2026-06-03');
		expect(start).toBe('2026-06-01');
		expect(end).toBe('2026-06-21');
	});

	it('MONTH : du 1er au dernier jour du mois, startWeekday ignoré', () => {
		expect(currentMoodPeriod('MONTH', 3, '2026-06-15')).toEqual({
			start: '2026-06-01',
			end: '2026-06-30'
		});
	});

	it('MONTH : gère correctement février (année non bissextile)', () => {
		expect(currentMoodPeriod('MONTH', 0, '2026-02-10')).toEqual({
			start: '2026-02-01',
			end: '2026-02-28'
		});
	});
});

describe('lastWorkdayOnOrBefore', () => {
	// 2026-06-05 = vendredi, 06 = samedi, 07 = dimanche, 08 = lundi
	it('rend la date telle quelle si c’est un jour ouvré', () => {
		expect(lastWorkdayOnOrBefore('2026-06-05')).toBe('2026-06-05');
		expect(lastWorkdayOnOrBefore('2026-06-08')).toBe('2026-06-08');
	});
	it('recule au vendredi depuis le week-end (plage Team mood lundi→dimanche)', () => {
		expect(lastWorkdayOnOrBefore('2026-06-06')).toBe('2026-06-05');
		expect(lastWorkdayOnOrBefore('2026-06-07')).toBe('2026-06-05');
	});
});

describe('formatDayRange / formatMonthLabel', () => {
	it("n'écrit le mois qu'une fois quand les deux bornes le partagent", () => {
		expect(formatDayRange('2026-07-06', '2026-07-10')).toBe('6 → 10 juil. 2026');
	});

	it('écrit le mois des deux côtés à cheval sur deux mois', () => {
		expect(formatDayRange('2026-06-29', '2026-07-03')).toBe('29 juin → 3 juil. 2026');
	});

	it('utilise le nom complet du mois pour un titre de mois', () => {
		expect(formatMonthLabel('2026-06-01')).toBe('Juin 2026');
	});
});

describe('workdaysBetween / bornes calendaires', () => {
	it('exclut les week-ends et conserve les fériés', () => {
		// 2026-05-01 (Fête du travail) est un vendredi : il reste une colonne.
		const days = workdaysBetween('2026-04-27', '2026-05-03');
		expect(days).toEqual(['2026-04-27', '2026-04-28', '2026-04-29', '2026-04-30', '2026-05-01']);
	});

	it('découpe la quinzaine en 1→15 et 16→fin de mois', () => {
		expect(fortnightBounds('2026-06-10')).toEqual({ start: '2026-06-01', end: '2026-06-15' });
		expect(fortnightBounds('2026-06-16')).toEqual({ start: '2026-06-16', end: '2026-06-30' });
	});

	it('gère février sur une année non bissextile', () => {
		expect(monthBounds('2026-02-10')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
		expect(fortnightBounds('2026-02-20')).toEqual({ start: '2026-02-16', end: '2026-02-28' });
	});
});

describe('buildPeriod', () => {
	it('WEEK reproduit la semaine ouvrée lun→ven actuelle', () => {
		const p = buildPeriod('WEEK', 'FIXED', '2026-07-08'); // un mercredi
		expect(p.days).toEqual(['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10']);
		expect(p.anchorISO).toBe('2026-07-06');
		expect(p.label).toBe('6 → 10 juil. 2026');
		expect(p.shortLabel).toBe('S28');
	});

	it('WEEK/ROLLING est identique à WEEK/FIXED (la bascule est un no-op sur la semaine)', () => {
		expect(buildPeriod('WEEK', 'ROLLING', '2026-07-08')).toEqual(buildPeriod('WEEK', 'FIXED', '2026-07-08'));
	});

	it('MONTH/FIXED sélectionne le mois depuis la date brute, pas depuis le lundi de sa semaine', () => {
		// 2026-02-01 est un dimanche : mondayOf() renverrait 2026-01-26 → janvier.
		const p = buildPeriod('MONTH', 'FIXED', '2026-02-01');
		expect(p.firstDay).toBe('2026-02-02');
		expect(p.lastDay).toBe('2026-02-27');
		expect(p.label).toBe('Février 2026');
	});

	it('FORTNIGHT/FIXED couvre la quinzaine calendaire', () => {
		const p = buildPeriod('FORTNIGHT', 'FIXED', '2026-06-20');
		expect(p.firstDay).toBe('2026-06-16');
		expect(p.lastDay).toBe('2026-06-30');
		expect(p.shortLabel).toBe('Q2 juin');
	});

	it('les modes glissants font k semaines entières finissant au vendredi de la semaine ancre', () => {
		const q = buildPeriod('FORTNIGHT', 'ROLLING', '2026-07-08');
		expect(q.days.length).toBe(10);
		expect(q.firstDay).toBe('2026-06-29');
		expect(q.lastDay).toBe('2026-07-10');

		const m = buildPeriod('MONTH', 'ROLLING', '2026-07-08');
		expect(m.days.length).toBe(20);
		expect(m.lastDay).toBe('2026-07-10');
		expect(m.weeks.length).toBe(4);
	});

	it('ne contient jamais de week-end', () => {
		for (const g of ['WEEK', 'FORTNIGHT', 'MONTH'] as Granularity[]) {
			for (const mode of ['FIXED', 'ROLLING'] as const) {
				for (const day of ['2026-01-15', '2026-02-01', '2026-08-31', '2025-12-29']) {
					for (const iso of buildPeriod(g, mode, day).days) {
						expect(parseISODate(iso).getUTCDay()).not.toBe(0);
						expect(parseISODate(iso).getUTCDay()).not.toBe(6);
					}
				}
			}
		}
	});

	it('nextAnchor enchaîne sans trou ni recouvrement, y compris au passage d\'année', () => {
		for (const g of ['WEEK', 'FORTNIGHT', 'MONTH'] as Granularity[]) {
			for (const day of ['2026-02-01', '2025-12-20', '2026-06-10']) {
				const p = buildPeriod(g, 'FIXED', day);
				const next = buildPeriod(g, 'FIXED', p.nextAnchor);
				// Le premier jour de la période suivante est le jour ouvré qui suit la fin de celle-ci.
				expect(workdaysBetween(p.lastDay, next.firstDay)).toEqual([p.lastDay, next.firstDay]);
				// …et l'aller-retour retombe exactement sur la période de départ.
				expect(buildPeriod(g, 'FIXED', next.prevAnchor).rangeKey).toBe(p.rangeKey);
			}
		}
	});
});

describe('currentSupportPeriod / supportPeriodIndex (cadence DAY)', () => {
	// 2026-08-14 = vendredi, 15 = samedi, 16 = dimanche, 17 = lundi.
	it('sans samedi inclus, le week-end retombe sur le vendredi précédent', () => {
		expect(currentSupportPeriod('DAY', '2026-08-15').start).toBe('2026-08-14');
		expect(currentSupportPeriod('DAY', '2026-08-16').start).toBe('2026-08-14');
		expect(currentSupportPeriod('DAY', '2026-08-17').start).toBe('2026-08-17');
	});

	it("l'index avance d'exactement 1 entre vendredi et le lundi suivant (régression : le week-end ne doit pas faire sauter 2 personnes dans la rotation)", () => {
		const fri = supportPeriodIndex('DAY', '2026-08-14');
		const mon = supportPeriodIndex('DAY', '2026-08-17');
		expect(mon - fri).toBe(1);
	});

	it('samedi inclus : devient son propre jour actif, le dimanche retombe dessus, toujours +1 par jour actif', () => {
		expect(currentSupportPeriod('DAY', '2026-08-15', true).start).toBe('2026-08-15');
		expect(currentSupportPeriod('DAY', '2026-08-16', true).start).toBe('2026-08-15');

		const thu = supportPeriodIndex('DAY', '2026-08-13', true);
		const fri = supportPeriodIndex('DAY', '2026-08-14', true);
		const sat = supportPeriodIndex('DAY', '2026-08-15', true);
		const mon = supportPeriodIndex('DAY', '2026-08-17', true);
		expect(fri - thu).toBe(1);
		expect(sat - fri).toBe(1);
		expect(mon - sat).toBe(1);
	});

	it("includeSaturday n'a aucun effet en cadence WEEK/MONTH (période entière, le détail des jours ne compte pas)", () => {
		expect(supportPeriodIndex('WEEK', '2026-08-10', false)).toBe(supportPeriodIndex('WEEK', '2026-08-10', true));
		expect(supportPeriodIndex('MONTH', '2026-08-01', false)).toBe(supportPeriodIndex('MONTH', '2026-08-01', true));
	});
});
