import { describe, it, expect } from 'vitest';
import { buildDeck, evaluatePick, clearOpen, isWon, type GameState } from './memoryGame';

describe('buildDeck', () => {
	it('apparie chaque seed exactement deux fois', () => {
		let n = 0;
		const deck = buildDeck(6, () => `s${n++}`);
		expect(deck).toHaveLength(6);
		const counts = new Map<string, number>();
		for (const seed of deck) counts.set(seed, (counts.get(seed) ?? 0) + 1);
		expect(counts.size).toBe(3);
		for (const count of counts.values()) expect(count).toBe(2);
	});

	it("laisse une case '' hors-jeu quand le total est impair", () => {
		let n = 0;
		const deck = buildDeck(5, () => `s${n++}`);
		expect(deck).toHaveLength(5);
		expect(deck.filter((s) => s === '')).toHaveLength(1);
		expect(deck.filter(Boolean)).toHaveLength(4);
	});
});

describe('evaluatePick', () => {
	const base: GameState = { cardSeeds: ['a', 'b', 'a', 'b'], matched: new Set(), openIndexes: [], moves: 0 };

	it('ouvre une première carte sans incrémenter les coups', () => {
		const { state, result } = evaluatePick(base, 0);
		expect(result).toBe('opened');
		expect(state.openIndexes).toEqual([0]);
		expect(state.moves).toBe(0);
	});

	it('détecte une paire et la marque comme matched', () => {
		const opened = evaluatePick(base, 0).state;
		const { state, result } = evaluatePick(opened, 2);
		expect(result).toBe('match');
		expect(state.matched.has(0)).toBe(true);
		expect(state.matched.has(2)).toBe(true);
		expect(state.openIndexes).toEqual([]);
		expect(state.moves).toBe(1);
	});

	it('détecte un mismatch et garde les deux cartes ouvertes pour affichage', () => {
		const opened = evaluatePick(base, 0).state;
		const { state, result } = evaluatePick(opened, 1);
		expect(result).toBe('mismatch');
		expect(state.openIndexes).toEqual([0, 1]);
		expect(state.matched.size).toBe(0);
		expect(state.moves).toBe(1);
	});

	it('ignore une case hors-jeu (seed vide) ou déjà matched', () => {
		const withEmpty: GameState = { cardSeeds: ['a', '', 'a'], matched: new Set(), openIndexes: [], moves: 0 };
		expect(evaluatePick(withEmpty, 1).result).toBe('ignored');

		const withMatched: GameState = { cardSeeds: ['a', 'a'], matched: new Set([0]), openIndexes: [], moves: 0 };
		expect(evaluatePick(withMatched, 0).result).toBe('ignored');
	});
});

describe('clearOpen', () => {
	it('vide openIndexes sans toucher au reste', () => {
		const state: GameState = { cardSeeds: ['a', 'b'], matched: new Set([0]), openIndexes: [0, 1], moves: 2 };
		expect(clearOpen(state)).toEqual({ cardSeeds: ['a', 'b'], matched: new Set([0]), openIndexes: [], moves: 2 });
	});
});

describe('isWon', () => {
	it('faux tant que toutes les paires en jeu ne sont pas matched', () => {
		const state: GameState = { cardSeeds: ['a', 'a', 'b', 'b'], matched: new Set([0, 1]), openIndexes: [], moves: 0 };
		expect(isWon(state)).toBe(false);
	});

	it('vrai quand toutes les cases en jeu sont matched (le reste éventuel hors-jeu ignoré)', () => {
		const state: GameState = { cardSeeds: ['a', 'a', ''], matched: new Set([0, 1]), openIndexes: [], moves: 0 };
		expect(isWon(state)).toBe(true);
	});

	it("faux sur un plateau vide (jeu pas démarré)", () => {
		expect(isWon({ cardSeeds: [], matched: new Set(), openIndexes: [], moves: 0 })).toBe(false);
	});
});
