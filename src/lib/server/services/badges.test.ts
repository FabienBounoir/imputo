import { describe, expect, it } from 'vitest';
import { longestWorkdayRun } from './badges';

// 2026-09-07 = lundi, 2026-09-11 = vendredi, 2026-09-12/13 = week-end.
describe('longestWorkdayRun', () => {
	it('rend 0 sans aucun jour', () => {
		expect(longestWorkdayRun([])).toBe(0);
	});

	it('compte une semaine pleine', () => {
		expect(longestWorkdayRun(['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'])).toBe(5);
	});

	it('ne casse pas la série sur un week-end', () => {
		// vendredi + lundi suivant : le samedi et le dimanche ne sont pas des jours ouvrés.
		expect(longestWorkdayRun(['2026-09-11', '2026-09-14'])).toBe(2);
	});

	it('remet à zéro sur un jour ouvré manquant', () => {
		// mardi manquant : deux séries de 1 et 2, la meilleure vaut 2.
		expect(longestWorkdayRun(['2026-09-07', '2026-09-09', '2026-09-10'])).toBe(2);
	});

	it('ignore les doublons', () => {
		expect(longestWorkdayRun(['2026-09-07', '2026-09-07', '2026-09-08'])).toBe(2);
	});

	it('ne compte pas un week-end saisi comme un jour de série', () => {
		// samedi seul : aucun jour ouvré, donc aucune série.
		expect(longestWorkdayRun(['2026-09-12'])).toBe(0);
	});
});
