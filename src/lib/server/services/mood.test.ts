import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, user } from '$lib/server/db';
import {
	submitVote,
	getMyVote,
	getMyStreak,
	resetPeriodVotes,
	getMoodConfig,
	setMoodEnabled,
	setMoodPeriodConfig,
	listMoodResultsPage,
	listMoodPeriodStats,
	getPeriodParticipation
} from './mood';
import { makeWorkspace, addMember } from './test-helpers';

const PERIOD = '2026-06-22'; // lundi
const PERIOD_END = '2026-06-28';
const PREV_PERIOD = '2026-06-15';

describe('getMoodConfig / setMoodEnabled / setMoodPeriodConfig', () => {
	it('config par défaut désactivée, puis modifiable', async () => {
		const { workspaceId } = await makeWorkspace();
		const initial = await getMoodConfig(workspaceId);
		expect(initial.enabled).toBe(false);

		await setMoodEnabled(workspaceId, true);
		await setMoodPeriodConfig(workspaceId, 'WEEK_2', 3);

		const updated = await getMoodConfig(workspaceId);
		expect(updated.enabled).toBe(true);
		expect(updated.periodKind).toBe('WEEK_2');
		expect(updated.startWeekday).toBe(3);
	});

	it('rejette un jour de départ hors 0-6', async () => {
		const { workspaceId } = await makeWorkspace();
		await expect(setMoodPeriodConfig(workspaceId, 'WEEK_1', 7)).rejects.toThrow('Jour de départ invalide.');
		await expect(setMoodPeriodConfig(workspaceId, 'WEEK_1', -1)).rejects.toThrow('Jour de départ invalide.');
	});
});

describe('submitVote / getMyVote', () => {
	it('enregistre un vote puis le retrouve', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		await submitVote(workspaceId, userId, PERIOD, PERIOD_END, 4, '  Bonne semaine  ');

		const vote = await getMyVote(workspaceId, userId, PERIOD);
		expect(vote).toEqual({ score: 4, message: 'Bonne semaine' });
	});

	it('un second vote sur la même plage écrase le premier (upsert)', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		await submitVote(workspaceId, userId, PERIOD, PERIOD_END, 2, null);
		await submitVote(workspaceId, userId, PERIOD, PERIOD_END, 5, 'mieux');

		const vote = await getMyVote(workspaceId, userId, PERIOD);
		expect(vote).toEqual({ score: 5, message: 'mieux' });
	});

	it('rejette une note hors 1-5', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		await expect(submitVote(workspaceId, userId, PERIOD, PERIOD_END, 0, null)).rejects.toThrow('Note invalide');
		await expect(submitVote(workspaceId, userId, PERIOD, PERIOD_END, 6, null)).rejects.toThrow('Note invalide');
	});
});

describe('getMyStreak', () => {
	it('compte les plages consécutives votées jusqu’à la courante', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		await submitVote(workspaceId, userId, PREV_PERIOD, '2026-06-21', 3, null);
		await submitVote(workspaceId, userId, PERIOD, PERIOD_END, 4, null);

		expect(await getMyStreak(workspaceId, userId, 'WEEK_1', PERIOD)).toBe(2);
	});

	it('0 si la plage courante n’a pas de vote et la précédente non plus', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		expect(await getMyStreak(workspaceId, userId, 'WEEK_1', PERIOD)).toBe(0);
	});
});

describe('resetPeriodVotes', () => {
	it('supprime tous les votes de la plage', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		await submitVote(workspaceId, userId, PERIOD, PERIOD_END, 3, null);
		await resetPeriodVotes(workspaceId, PERIOD);
		expect(await getMyVote(workspaceId, userId, PERIOD)).toBeNull();
	});
});

describe('listMoodResultsPage / listMoodPeriodStats / getPeriodParticipation', () => {
	it('agrège les votes par plage sans jamais exposer userId', async () => {
		const { workspaceId, userId: u1 } = await makeWorkspace();
		const { userId: u2 } = await addMember(workspaceId, 'USER', 'voter2');
		// addMember() invite sans finaliser (passwordHash null) : ce test veut un membre réellement
		// actif, pas un member en attente — cf. le test dédié plus bas pour ce cas-là.
		await db.update(user).set({ passwordHash: 'x' }).where(eq(user.id, u2));

		await submitVote(workspaceId, u1, PERIOD, PERIOD_END, 4, 'top');
		await submitVote(workspaceId, u2, PERIOD, PERIOD_END, 2, null);

		expect(await getPeriodParticipation(workspaceId, PERIOD)).toEqual({ voted: 2, total: 2 });

		const { periods } = await listMoodResultsPage(workspaceId);
		const period = periods.find((r) => r.periodStart === PERIOD);
		expect(period?.voteCount).toBe(2);
		expect(period?.avgScore).toBe(3);
		expect(period?.distribution).toEqual({ 1: 0, 2: 1, 3: 0, 4: 1, 5: 0 });
		expect(period?.messages).toEqual(['top']);
		expect(Object.keys(period ?? {})).not.toContain('userId');

		// L'agrégat SQL de listMoodPeriodStats doit donner exactement les mêmes chiffres que la
		// réduction en mémoire de la page — sinon la courbe et le camembert contrediraient la liste.
		const stats = (await listMoodPeriodStats(workspaceId)).find((r) => r.periodStart === PERIOD);
		expect(stats?.voteCount).toBe(2);
		expect(stats?.avgScore).toBe(3);
		expect(stats?.distribution).toEqual({ 1: 0, 2: 1, 3: 0, 4: 1, 5: 0 });
		// Les messages sont volontairement absents de l'agrégat : c'est eux qui pèsent.
		expect(Object.keys(stats ?? {})).not.toContain('messages');
		expect(Object.keys(stats ?? {})).not.toContain('userId');
	});

	it('pagine par plage : 20 puis le reste, curseur `before`, sans recouvrement', async () => {
		const { workspaceId, userId } = await makeWorkspace();
		// 25 plages hebdomadaires distinctes, une voix chacune.
		const starts: string[] = [];
		for (let i = 0; i < 25; i++) {
			const d = new Date(Date.UTC(2026, 0, 5 + i * 7));
			const start = d.toISOString().slice(0, 10);
			const end = new Date(d.getTime() + 4 * 86400000).toISOString().slice(0, 10);
			starts.push(start);
			await submitVote(workspaceId, userId, start, end, 3, null);
		}
		const attenduDesc = [...starts].sort().reverse();

		const p1 = await listMoodResultsPage(workspaceId);
		expect(p1.periods).toHaveLength(20);
		expect(p1.hasMore).toBe(true);
		expect(p1.periods.map((p) => p.periodStart)).toEqual(attenduDesc.slice(0, 20));

		const p2 = await listMoodResultsPage(workspaceId, { before: p1.periods[19].periodStart });
		expect(p2.periods).toHaveLength(5);
		expect(p2.hasMore).toBe(false);
		expect(p2.periods.map((p) => p.periodStart)).toEqual(attenduDesc.slice(20));

		// Aucune plage servie deux fois : c'est ce que garantit le curseur strict (`<`).
		const vues = new Set([...p1.periods, ...p2.periods].map((p) => p.periodStart));
		expect(vues.size).toBe(25);

		// Les statistiques, elles, couvrent tout l'historique — pas seulement la première page.
		expect(await listMoodPeriodStats(workspaceId)).toHaveLength(25);
	});

	it('exclut les membres en attente (invitation non finalisée) du total', async () => {
		const { workspaceId, userId: u1 } = await makeWorkspace();
		await addMember(workspaceId, 'USER', 'pending1'); // jamais activé, passwordHash reste null

		await submitVote(workspaceId, u1, PERIOD, PERIOD_END, 4, null);

		expect(await getPeriodParticipation(workspaceId, PERIOD)).toEqual({ voted: 1, total: 1 });
	});
});
