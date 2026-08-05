import { describe, it, expect } from 'vitest';
import {
	countWorkdays,
	countWorkdaysNonHoliday,
	isPublicHolidayFR,
	isWorkday,
	previousWorkday,
	todayInParis,
	formatRange,
	parseISODate,
	currentMoodPeriod
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
