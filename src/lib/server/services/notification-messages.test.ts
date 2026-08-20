import { describe, it, expect } from 'vitest';
import { notifMessage, NOTIF_URL, type NotifKind, type NotifCtx } from './notification-messages';

const CTX: { [K in NotifKind]: NotifCtx[K] } = {
	EVENING_MISSING: { missing: 0.5, nothing: false },
	MORNING_YESTERDAY: { day: '2026-08-19', missing: 0.5, nothing: false },
	RAE_STALE: { count: 3, staleDays: 7 },
	WEEKLY_RECAP: { days: ['2026-08-17', '2026-08-19'] },
	MOOD_DEADLINE: {},
	MOOD_RECAP: { avg: 2.8, prevAvg: 3.7, votes: 8 },
	ABSENCE_PENDING: { name: 'Alice', range: '3 → 7 sept. 2026' },
	ABSENCE_VALIDATED: { range: '3 → 7 sept. 2026' }
};
const KINDS = Object.keys(CTX) as NotifKind[];

describe('notifMessage', () => {
	it('rend un titre et un corps non vides pour chaque variante de chaque type', () => {
		for (const kind of KINDS) {
			// 40 graines : assez pour toucher les 4 variantes de chaque type.
			for (let i = 0; i < 40; i++) {
				const { title, body } = notifMessage(kind, CTX[kind], `u${i}:${kind}:2026-08-20`, 'Team Alpha');
				expect(title).toMatch(/ · Team Alpha$/);
				expect(body.length).toBeGreaterThan(10);
				expect(body).not.toMatch(/undefined|NaN/);
			}
		}
	});

	it('tire toujours la même formulation pour une graine donnée, mais varie entre graines', () => {
		const a = notifMessage('EVENING_MISSING', CTX.EVENING_MISSING, 'seed-a', 'W');
		expect(notifMessage('EVENING_MISSING', CTX.EVENING_MISSING, 'seed-a', 'W')).toEqual(a);
		const distinct = new Set(
			Array.from({ length: 40 }, (_, i) => notifMessage('EVENING_MISSING', CTX.EVENING_MISSING, `u${i}`, 'W').title)
		);
		expect(distinct.size).toBeGreaterThan(1);
	});

	it('injecte les données de contexte dans le corps', () => {
		const seeds = Array.from({ length: 40 }, (_, i) => `u${i}`);
		const bodies = (kind: NotifKind) => seeds.map((s) => notifMessage(kind, CTX[kind], s, 'W').body);
		expect(bodies('EVENING_MISSING').every((b) => b.includes('0,5 j'))).toBe(true);
		expect(bodies('MORNING_YESTERDAY').every((b) => b.includes('19 août'))).toBe(true);
		expect(bodies('RAE_STALE').every((b) => b.includes('3 ticket'))).toBe(true);
		expect(bodies('WEEKLY_RECAP').every((b) => b.includes('17, 19 août'))).toBe(true);
		expect(bodies('ABSENCE_PENDING').every((b) => b.includes('3 → 7 sept. 2026'))).toBe(true);
	});

	it('gère le cas « rien de saisi » sans afficher de quantité manquante trompeuse', () => {
		const seeds = Array.from({ length: 40 }, (_, i) => `u${i}`);
		for (const s of seeds) {
			const { body } = notifMessage('EVENING_MISSING', { missing: 1, nothing: true }, s, 'W');
			expect(body).not.toMatch(/\d,?\d* j/);
		}
	});

	it('expose une URL pour chaque type', () => {
		for (const kind of KINDS) expect(NOTIF_URL[kind]).toMatch(/^\//);
	});
});
