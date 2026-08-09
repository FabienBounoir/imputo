import { describe, it, expect } from 'vitest';
import {
	submitVote,
	getMyVote,
	getMyStreak,
	resetPeriodVotes,
	getMoodConfig,
	setMoodEnabled,
	setMoodPeriodConfig,
	listMoodResults,
	countVotes,
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

describe('listMoodResults / countVotes / getPeriodParticipation', () => {
	it('agrège les votes par plage sans jamais exposer userId', async () => {
		const { workspaceId, userId: u1 } = await makeWorkspace();
		const { userId: u2 } = await addMember(workspaceId, 'USER', 'voter2');

		await submitVote(workspaceId, u1, PERIOD, PERIOD_END, 4, 'top');
		await submitVote(workspaceId, u2, PERIOD, PERIOD_END, 2, null);

		expect(await countVotes(workspaceId)).toBe(2);
		expect(await getPeriodParticipation(workspaceId, PERIOD)).toEqual({ voted: 2, total: 2 });

		const results = await listMoodResults(workspaceId);
		const period = results.find((r) => r.periodStart === PERIOD);
		expect(period?.voteCount).toBe(2);
		expect(period?.avgScore).toBe(3);
		expect(period?.distribution).toEqual({ 1: 0, 2: 1, 3: 0, 4: 1, 5: 0 });
		expect(period?.messages).toEqual(['top']);
		expect(Object.keys(period ?? {})).not.toContain('userId');
	});
});
