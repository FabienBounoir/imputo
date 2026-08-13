import { describe, it, expect } from 'vitest';
import {
	num,
	sum,
	round,
	totalEstimation,
	totalRae,
	ecartVsEstime,
	ecartVsBudget,
	resolvedRae,
	resolvedEstimation,
	raeSuggested,
	avancement,
	ppr,
	weeklyCapacity,
	capacityPct
} from './calc';

describe('calc', () => {
	it('num: convertit string/null en nombre', () => {
		expect(num('1.5')).toBe(1.5);
		expect(num(null)).toBe(0);
		expect(num('')).toBe(0);
		expect(num('abc')).toBe(0);
	});

	it('sum: additionne sans artefact flottant', () => {
		expect(sum(['0.25', '0.25', '0.25', '0.25'])).toBe(1);
		expect(sum([0.1, 0.2])).toBe(0.3);
	});

	it('round: 2 décimales', () => {
		expect(round(0.1 + 0.2)).toBe(0.3);
	});

	it('totalEstimation / totalRae: somme Réal + Test', () => {
		expect(totalEstimation('5', '3')).toBe(8);
		expect(totalRae('2', '1')).toBe(3);
		expect(totalEstimation(null, null)).toBe(0);
	});

	it('phase Test désactivée : Test ignoré (Réal uniquement)', () => {
		expect(totalEstimation('5', '3', false)).toBe(5);
		expect(totalRae('2', '1', false)).toBe(2);
	});

	it('ecartVsEstime: RAE réel + consommé − estimé résolu (positif = dépassement projeté)', () => {
		expect(ecartVsEstime(2, 10, 8)).toBe(4);
		expect(ecartVsEstime(0, 5, 8)).toBe(-3);
	});

	it('ecartVsBudget: RAE réel + consommé − budget (même forme que ecartVsEstime)', () => {
		expect(ecartVsBudget(2, 10, 8)).toBe(4);
		expect(ecartVsBudget(0, 5, 8)).toBe(-3);
	});

	it('raeSuggested: max(0, estimation − consommé)', () => {
		expect(raeSuggested(8, 3)).toBe(5);
		expect(raeSuggested(8, 10)).toBe(0);
	});

	it('resolvedRae: fallback ticket.raeReal/raeTest si aucune ligne par activité', () => {
		expect(resolvedRae('5', '2', [])).toEqual({ real: 5, test: 2 });
	});

	it('resolvedRae: somme des lignes par activité quand elles existent (ignore le fallback)', () => {
		expect(
			resolvedRae('5', '2', [
				{ raeReal: '1', raeTest: '0' },
				{ raeReal: '2.5', raeTest: '1' }
			])
		).toEqual({ real: 3.5, test: 1 });
	});

	it('resolvedEstimation: fallback ticket.estimationReal si aucune ligne par activité', () => {
		expect(resolvedEstimation('8', [])).toBe(8);
	});

	it('resolvedEstimation: somme des Estimés par activité quand ils existent (ignore le fallback)', () => {
		expect(resolvedEstimation('8', [{ estimation: '3' }, { estimation: '2.5' }])).toBe(5.5);
	});

	it('weeklyCapacity / capacityPct: capacité hebdo et % utilisé (garde-fou division par zéro)', () => {
		expect(weeklyCapacity('0.8', 5)).toBe(4);
		expect(capacityPct(5, 4)).toBe(1.25);
		expect(capacityPct(5, 0)).toBe(0);
	});

	it('ppr: estimation réelle × ratio d\'espace', () => {
		expect(ppr('10', '0.9')).toBe(9);
		expect(ppr(null, '0.9')).toBe(0);
	});

	it('avancement: borné 0–1, garde-fou division par zéro', () => {
		expect(avancement(10, 0)).toBe(1);
		expect(avancement(10, 10)).toBe(0);
		expect(avancement(10, 4)).toBe(0.6);
		expect(avancement(0, 0)).toBe(0); // pas de division par zéro, pas de consommé
		expect(avancement(10, 20)).toBe(0); // borné bas
		expect(avancement(10, -5)).toBe(1); // borné haut
	});

	it('avancement: sans estimation, 100 % si consommé et RAE nul, sinon 0 %', () => {
		expect(avancement(0, 0, 5)).toBe(1); // travaillé et terminé, jamais chiffré
		expect(avancement(0, 0, 0)).toBe(0); // ticket vraiment pas commencé
		expect(avancement(0, 3, 5)).toBe(0); // RAE restant sans estimation : pas "terminé"
	});
});
