import { describe, it, expect } from 'vitest';
import { plural, tier, wrappedCopy, type WrappedCopyInput } from './wrappedCopy';

const base: WrappedCopyInput = {
	totalHours: 0,
	productivePct: 0,
	topTicket: null,
	streakDays: 0,
	moodAvg: null,
	supportCount: 0,
	duo: null
};

describe('tier', () => {
	const steps: [number, string][] = [
		[0, 'bas'],
		[10, 'moyen'],
		[20, 'haut']
	];

	it('prend la dernière entrée atteinte, bornes incluses', () => {
		expect(tier(0, steps)).toBe('bas');
		expect(tier(9, steps)).toBe('bas');
		expect(tier(10, steps)).toBe('moyen');
		expect(tier(19, steps)).toBe('moyen');
		expect(tier(20, steps)).toBe('haut');
		expect(tier(9999, steps)).toBe('haut');
	});

	it('retombe sur le plancher sous le premier seuil plutôt que de rendre undefined', () => {
		expect(tier(-5, steps)).toBe('bas');
	});
});

describe('plural', () => {
	it('garde le singulier à 0 et à 1, comme en français', () => {
		expect(plural(0, 'jour', 'jours')).toBe('jour');
		expect(plural(1, 'jour', 'jours')).toBe('jour');
		expect(plural(2, 'jour', 'jours')).toBe('jours');
		expect(plural(140, 'jour', 'jours')).toBe('jours');
	});
});

describe('wrappedCopy', () => {
	it('ne dit pas la même chose à 2 jours de série et à 200', () => {
		const petit = wrappedCopy({ ...base, streakDays: 2 }, 2026).streak;
		const gros = wrappedCopy({ ...base, streakDays: 200 }, 2026).streak;
		expect(petit).not.toBe(gros);
	});

	it("n'emploie pas le registre enjoué pour une mauvaise humeur moyenne", () => {
		expect(wrappedCopy({ ...base, moodAvg: 1.8 }, 2026).mood).toBe('Une année qui a pesé.');
		expect(wrappedCopy({ ...base, moodAvg: 4.7 }, 2026).mood).not.toBe('Une année qui a pesé.');
	});

	it('injecte bien l\'année dans le titre du volume', () => {
		expect(wrappedCopy({ ...base, totalHours: 300 }, 2026).volumeTitle).toContain('2026');
	});

	it('tient les données absentes (aucun ticket, aucun duo)', () => {
		const copy = wrappedCopy(base, 2026);
		for (const value of Object.values(copy)) expect(value).toBeTruthy();
	});
});
