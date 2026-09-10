// Logique pure du Snake caché dans la grille des absences (absences/+page.svelte) : extraite ici
// pour être testable sans monter le composant Svelte (même parti pris que memoryGame.ts).

export type Point = { x: number; y: number };

/** Un pouvoir par couleur d'absence — le bleu est réservé au serpent lui-même. */
export const FOOD_TYPES = ['CONGE_VALIDE', 'FORMATION', 'CONGE_PREVISIONNEL'] as const;
export type FoodType = (typeof FOOD_TYPES)[number];

/**
 * Tirage pondéré, pas uniforme : à 1 chance sur 3 chacun, les deux pouvoirs tombaient sans arrêt et
 * la partie devenait illisible. Le classique (allonge) domine, les pouvoirs redeviennent des
 * surprises — et le téléport, le plus déroutant des trois puisqu'il déplace tout le serpent d'un
 * coup, est le plus rare.
 */
export const FOOD_WEIGHTS: Record<FoodType, number> = {
	CONGE_VALIDE: 7,
	FORMATION: 2,
	CONGE_PREVISIONNEL: 1
};

export function pickFoodType(rng: () => number = Math.random): FoodType {
	const total = FOOD_TYPES.reduce((n, t) => n + FOOD_WEIGHTS[t], 0);
	let r = rng() * total;
	for (const t of FOOD_TYPES) {
		r -= FOOD_WEIGHTS[t];
		if (r < 0) return t;
	}
	return 'CONGE_VALIDE';
}

/** Cases libres exigées devant la tête après téléportation — de quoi voir le bord et réagir. */
export const TELEPORT_RUNWAY = 3;

/**
 * Nouvelle position du serpent après un téléport : même forme, translatée derrière une tête tirée
 * au hasard, les segments qui débordent réapparaissant de l'autre côté (comme Pac-Man).
 *
 * L'atterrissage n'est PAS pris au premier tirage venu : avant, le serpent pouvait réapparaître le
 * nez contre un bord et mourir au tick suivant sans qu'on ait pu réagir — le pouvoir se vivait
 * comme une punition. On tire donc plusieurs candidats et on garde le premier vraiment jouable.
 *
 * Renvoie `null` si aucun candidat ne convient (petit plateau, serpent très long) : l'appelant
 * laisse alors le serpent où il est, ce qui vaut mieux que de le tuer.
 */
export function teleportedBody(
	snake: Point[],
	dir: Point,
	cols: number,
	rows: number,
	food: Point | null = null,
	rng: () => number = Math.random,
	attempts = 40
): Point[] | null {
	// Sur un plateau étroit, exiger 3 cases devant serait impossible : on réduit la marge à ce que
	// l'axe courant permet.
	const axis = dir.x !== 0 ? cols : rows;
	const runway = Math.min(TELEPORT_RUNWAY, axis - 1);

	for (let i = 0; i < attempts; i++) {
		const head = { x: Math.floor(rng() * cols), y: Math.floor(rng() * rows) };
		const ahead = { x: head.x + dir.x * runway, y: head.y + dir.y * runway };
		if (ahead.x < 0 || ahead.y < 0 || ahead.x >= cols || ahead.y >= rows) continue;

		const body = snake.map((_, k) => ({
			x: (((head.x - k * dir.x) % cols) + cols) % cols,
			y: (((head.y - k * dir.y) % rows) + rows) % rows
		}));
		// Un serpent assez long pour faire le tour du plateau se replierait sur lui-même après le
		// modulo : ce serait une mort immédiate au tick suivant.
		if (new Set(body.map((b) => `${b.x},${b.y}`)).size !== body.length) continue;
		// Atterrir sur la nourriture la ferait avaler sans l'avoir visée.
		if (food && body.some((b) => b.x === food.x && b.y === food.y)) continue;

		return body;
	}
	return null;
}
