import { describe, it, expect } from 'vitest';
import { countWorkdays, isWorkday, previousWorkday, todayInParis } from './date';

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
