import { describe, it, expect } from 'vitest';
import {
	num,
	sum,
	round,
	totalEstimation,
	totalRae,
	ecart,
	raeSuggested,
	avancement
} from './calc';

describe('calc', () => {
	it('num: convertit string/null en nombre', () => {
		expect(num('1.5')).toBe(1.5);
		expect(num(null)).toBe(0);
		expect(num('')).toBe(0);
		expect(num('abc')).toBe(0);
	});

	it('sum: additionne sans artefact flottant', () => {
		expect(sum(['0.25', '0.25', '0.25', '0.25'])).toBe(1);
		expect(sum([0.1, 0.2])).toBe(0.3);
	});

	it('round: 2 décimales', () => {
		expect(round(0.1 + 0.2)).toBe(0.3);
	});

	it('totalEstimation / totalRae: somme Réal + Test', () => {
		expect(totalEstimation('5', '3')).toBe(8);
		expect(totalRae('2', '1')).toBe(3);
		expect(totalEstimation(null, null)).toBe(0);
	});

	it('phase Test désactivée : Test ignoré (Réal uniquement)', () => {
		expect(totalEstimation('5', '3', false)).toBe(5);
		expect(totalRae('2', '1', false)).toBe(2);
	});

	it('ecart: consommé − estimation (positif = dépassement)', () => {
		expect(ecart(10, 8)).toBe(2);
		expect(ecart(5, 8)).toBe(-3);
	});

	it('raeSuggested: max(0, estimation − consommé)', () => {
		expect(raeSuggested(8, 3)).toBe(5);
		expect(raeSuggested(8, 10)).toBe(0);
	});

	it('avancement: borné 0–1, garde-fou division par zéro', () => {
		expect(avancement(10, 0)).toBe(1);
		expect(avancement(10, 10)).toBe(0);
		expect(avancement(10, 4)).toBe(0.6);
		expect(avancement(0, 0)).toBe(0); // pas de division par zéro
		expect(avancement(10, 20)).toBe(0); // borné bas
		expect(avancement(10, -5)).toBe(1); // borné haut
	});
});
