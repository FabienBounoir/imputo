// Logique pure du jeu des paires caché dans le planning (support/+page.svelte) : extraite ici
// pour être testable sans monter le composant Svelte (pas d'infra de test de composants dans ce repo).

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

/** total cases → seeds appariées + mélangées ; une case reste '' (hors-jeu) si total est impair. */
export function buildDeck(total: number, makeSeed: () => string = () => crypto.randomUUID(), rng: () => number = Math.random): string[] {
	const pairCount = Math.floor(total / 2);
	const seeds = Array.from({ length: pairCount }, () => makeSeed());
	const pool = shuffle([...seeds, ...seeds], rng);
	return Array.from({ length: total }, (_, i) => pool[i] ?? '');
}

export type GameState = {
	cardSeeds: string[];
	matched: Set<number>;
	openIndexes: number[];
	moves: number;
};

export type PickResult = 'ignored' | 'opened' | 'match' | 'mismatch';

/** Retourne l'état résultant d'un clic sur la case i, sans effet de bord (le timeout de mismatch
 * reste à la charge de l'appelant, cf. clearOpen). */
export function evaluatePick(state: GameState, i: number): { state: GameState; result: PickResult } {
	if (!state.cardSeeds[i] || state.matched.has(i) || state.openIndexes.includes(i)) {
		return { state, result: 'ignored' };
	}
	const openIndexes = [...state.openIndexes, i];
	if (openIndexes.length < 2) {
		return { state: { ...state, openIndexes }, result: 'opened' };
	}

	const [a, b] = openIndexes;
	const moves = state.moves + 1;
	if (state.cardSeeds[a] === state.cardSeeds[b]) {
		const matched = new Set(state.matched).add(a).add(b);
		return { state: { ...state, matched, openIndexes: [], moves }, result: 'match' };
	}
	return { state: { ...state, openIndexes, moves }, result: 'mismatch' };
}

export function clearOpen(state: GameState): GameState {
	return { ...state, openIndexes: [] };
}

export function isWon(state: GameState): boolean {
	const inPlay = state.cardSeeds.filter(Boolean).length;
	return inPlay > 0 && state.matched.size === inPlay;
}
