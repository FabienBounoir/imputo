import { describe, expect, it } from 'vitest';
import { BADGES, BADGE_HOW, tierFor, nextStep } from './badges';

describe('tierFor', () => {
	const th = [5, 20, 50, 120, 250];

	it('rend 0 tant que le premier seuil n’est pas atteint', () => {
		expect(tierFor(0, th)).toBe(0);
		expect(tierFor(4, th)).toBe(0);
	});

	it('monte d’un palier pile sur le seuil', () => {
		expect(tierFor(5, th)).toBe(1);
		expect(tierFor(19, th)).toBe(1);
		expect(tierFor(20, th)).toBe(2);
	});

	it('plafonne au dernier palier', () => {
		expect(tierFor(250, th)).toBe(5);
		expect(tierFor(99999, th)).toBe(5);
	});
});

describe('nextStep', () => {
	const th = [5, 20, 50, 120, 250];

	it('annonce le palier suivant et ce qu’il reste', () => {
		expect(nextStep(0, th)).toEqual({ tier: 1, target: 5, remaining: 5 });
		expect(nextStep(18, th)).toEqual({ tier: 2, target: 20, remaining: 2 });
	});

	it('rend null une fois le dernier palier atteint', () => {
		expect(nextStep(250, th)).toBeNull();
		expect(nextStep(400, th)).toBeNull();
	});
});

describe('catalogue', () => {
	it('a des ids uniques', () => {
		const ids = BADGES.map((b) => b.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	// Le typage ne peut pas l'assurer (Record<string, string> accepte les trous) : un badge sans
	// consigne s'afficherait verrouillé sans dire comment le décrocher, soit une carte muette.
	it('a une consigne d’obtention pour chaque badge', () => {
		for (const b of BADGES) {
			expect(BADGE_HOW[b.id], `consigne manquante pour ${b.id}`).toBeTruthy();
		}
	});

	it('a cinq seuils strictement croissants et cinq noms par badge', () => {
		for (const b of BADGES) {
			expect(b.thresholds).toHaveLength(5);
			expect(b.tierNames).toHaveLength(5);
			for (let i = 1; i < b.thresholds.length; i++) {
				expect(b.thresholds[i]).toBeGreaterThan(b.thresholds[i - 1]);
			}
		}
	});
});
