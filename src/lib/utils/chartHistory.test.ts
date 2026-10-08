import { describe, it, expect } from 'vitest';
import { compressPlateaus } from './chartHistory';

const pt = (date: string, consumed: number, rae: number) => ({ date, consumed, rae });

describe('compressPlateaus', () => {
	it('garde le 1er jour, chaque changement (conso OU RAE) et le dernier jour, avec la fin du plateau', () => {
		const h = [
			pt('01', 0, 5),
			pt('02', 0, 5), // figé
			pt('03', 1, 5), // conso bouge
			pt('04', 1, 5), // figé
			pt('05', 1, 4), // RAE bouge
			pt('06', 1, 4), // figé
			pt('07', 1, 4) // dernier : gardé même figé
		];
		expect(compressPlateaus(h).map((p) => [p.date, p.until])).toEqual([
			['01', '02'],
			['03', '04'],
			['05', '06'],
			['07', '07']
		]);
	});

	it('séries vides ou d’un seul point', () => {
		expect(compressPlateaus([])).toEqual([]);
		expect(compressPlateaus([pt('01', 1, 1)])).toEqual([{ ...pt('01', 1, 1), until: '01' }]);
	});
});
