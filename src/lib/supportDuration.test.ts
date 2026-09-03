import { describe, it, expect } from 'vitest';
import { parseDuration, formatDuration } from './supportDuration';

describe('parseDuration', () => {
	it('nombre seul = des heures', () => {
		expect(parseDuration('2')).toBe(120);
		expect(parseDuration('1.5')).toBe(90);
	});
	it('une seule unité', () => {
		expect(parseDuration('45m')).toBe(45);
		expect(parseDuration('1h')).toBe(60);
		expect(parseDuration('2d')).toBe(2 * 8 * 60);
		expect(parseDuration('1w')).toBe(5 * 8 * 60);
	});
	it('unités combinées, avec ou sans espace', () => {
		expect(parseDuration('1h 30m')).toBe(90);
		expect(parseDuration('1h30m')).toBe(90);
		expect(parseDuration('1d 4h')).toBe(8 * 60 + 4 * 60);
	});
	it('insensible à la casse', () => {
		expect(parseDuration('1H 30M')).toBe(90);
	});
	it('rejette le texte invalide ou les résidus non reconnus', () => {
		expect(parseDuration('')).toBeNull();
		expect(parseDuration('abc')).toBeNull();
		expect(parseDuration('1x')).toBeNull();
		expect(parseDuration('1h abc')).toBeNull();
	});
});

describe('formatDuration', () => {
	it('choisit la plus grosse unité en premier', () => {
		expect(formatDuration(90)).toBe('1h 30m');
		expect(formatDuration(45)).toBe('45m');
		expect(formatDuration(2 * 8 * 60)).toBe('2d');
		expect(formatDuration(5 * 8 * 60)).toBe('1w');
	});
	it('0 ou négatif -> "0m"', () => {
		expect(formatDuration(0)).toBe('0m');
		expect(formatDuration(-5)).toBe('0m');
	});
});
