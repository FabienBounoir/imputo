import { describe, it, expect } from 'vitest';
import { buildCycle, cycleNext } from './imputationCycle';

describe('buildCycle', () => {
	it('génère le cycle pour un pas de 0.25', () => {
		expect(buildCycle(0.25)).toEqual([0, 0.25, 0.5, 0.75, 1]);
	});

	it('génère le cycle pour un pas de 0.5', () => {
		expect(buildCycle(0.5)).toEqual([0, 0.5, 1]);
	});

	it('un pas de 0.125 (1h/jour) survit sans dériver vers 0.13', () => {
		expect(buildCycle(0.125)).toEqual([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]);
	});

	it('retombe sur 0.25 pour un pas invalide (0 ou négatif)', () => {
		expect(buildCycle(0)).toEqual([0, 0.25, 0.5, 0.75, 1]);
		expect(buildCycle(-1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
	});
});

describe('cycleNext', () => {
	const cycle = [0, 0.25, 0.5, 0.75, 1];

	it('avance à la valeur suivante', () => {
		expect(cycleNext(cycle, 0)).toBe(0.25);
		expect(cycleNext(cycle, 0.75)).toBe(1);
	});

	it('boucle de la dernière valeur vers la première', () => {
		expect(cycleNext(cycle, 1)).toBe(0);
	});

	it('recule (shift+clic) et boucle de la première vers la dernière', () => {
		expect(cycleNext(cycle, 0.5, true)).toBe(0.25);
		expect(cycleNext(cycle, 0, true)).toBe(1);
	});
});
