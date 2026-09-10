import { describe, it, expect } from 'vitest';
import { pickFoodType, teleportedBody, FOOD_WEIGHTS, TELEPORT_RUNWAY, type Point } from './snakeGame';

/** rng déterministe : rend la suite fournie, puis boucle dessus. */
const seq = (...vals: number[]) => {
	let i = 0;
	return () => vals[i++ % vals.length];
};

describe('pickFoodType', () => {
	it('respecte les poids : le classique domine, le téléport est le plus rare', () => {
		const total = FOOD_WEIGHTS.CONGE_VALIDE + FOOD_WEIGHTS.FORMATION + FOOD_WEIGHTS.CONGE_PREVISIONNEL;
		// Balayage régulier de [0,1[ : la part de chaque type doit coller à son poids.
		const n = 10_000;
		let k = 0;
		const rng = () => k++ / n;
		const counts = { CONGE_VALIDE: 0, FORMATION: 0, CONGE_PREVISIONNEL: 0 };
		for (let i = 0; i < n; i++) counts[pickFoodType(rng)]++;

		for (const [type, weight] of Object.entries(FOOD_WEIGHTS)) {
			const part = counts[type as keyof typeof counts] / n;
			expect(part, type).toBeCloseTo(weight / total, 2);
		}
		// L'intention de la correction : le jaune (téléport) est le plus rare des trois.
		expect(counts.CONGE_PREVISIONNEL).toBeLessThan(counts.FORMATION);
		expect(counts.FORMATION).toBeLessThan(counts.CONGE_VALIDE);
	});
});

describe('teleportedBody', () => {
	const dirDroite: Point = { x: 1, y: 0 };

	it('refuse un atterrissage collé au bord, dans le sens de la marche', () => {
		// rng qui vise d'abord la colonne la plus à droite (mort au tick suivant), puis le centre.
		const rng = seq(0.99, 0.5, 0.4, 0.5);
		const body = teleportedBody([{ x: 0, y: 0 }], dirDroite, 20, 10, null, rng);
		expect(body).not.toBeNull();
		expect(body![0].x + TELEPORT_RUNWAY).toBeLessThan(20);
	});

	it('laisse toujours au moins TELEPORT_RUNWAY cases devant la tête', () => {
		for (let i = 0; i < 200; i++) {
			const body = teleportedBody([{ x: 5, y: 5 }], dirDroite, 20, 10);
			expect(body).not.toBeNull();
			expect(body![0].x + TELEPORT_RUNWAY).toBeLessThan(20);
		}
	});

	it('ne renvoie jamais un corps qui se recouvre lui-même', () => {
		// Serpent plus long que la largeur du plateau : sans garde, le modulo le replierait sur lui.
		const snake: Point[] = Array.from({ length: 12 }, (_, i) => ({ x: i, y: 0 }));
		for (let i = 0; i < 100; i++) {
			const body = teleportedBody(snake, dirDroite, 8, 8);
			if (!body) continue;
			expect(new Set(body.map((b) => `${b.x},${b.y}`)).size).toBe(body.length);
		}
	});

	it('n’atterrit pas sur la nourriture — elle serait avalée sans avoir été visée', () => {
		const food = { x: 10, y: 5 };
		for (let i = 0; i < 200; i++) {
			const body = teleportedBody([{ x: 1, y: 1 }], dirDroite, 20, 10, food);
			if (!body) continue;
			expect(body.some((b) => b.x === food.x && b.y === food.y)).toBe(false);
		}
	});

	it('renvoie null quand aucun placement n’est possible', () => {
		// Serpent de 10 segments sur un plateau de 9 cases : aucun corps sans recouvrement n'existe.
		const tropLong: Point[] = Array.from({ length: 10 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) }));
		expect(teleportedBody(tropLong, dirDroite, 3, 3)).toBeNull();
	});

	it('sur un plateau dégénéré, la marge se réduit sans bloquer le téléport', () => {
		// Une seule colonne parcourue horizontalement : plus aucune piste à garantir. Refuser de
		// téléporter n'y changerait rien — le serpent sort au tick suivant de toute façon —, donc on
		// place quand même plutôt que de traiter ce cas comme un échec.
		expect(teleportedBody([{ x: 0, y: 0 }], dirDroite, 1, 5)).not.toBeNull();
	});
});
