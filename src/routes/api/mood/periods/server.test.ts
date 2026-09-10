import { describe, it, expect } from 'vitest';
import { GET } from './+server';
import { makeWorkspace, addMember, grantCapability } from '$lib/server/services/test-helpers';
import { fakeLocals } from '$lib/server/test-helpers/http';
import { submitVote } from '$lib/server/services/mood';

const call = async (locals: unknown, search: string) =>
	GET({ locals, url: new URL(`http://localhost/api/mood/periods${search}`) } as never);

/** 25 plages hebdomadaires d'une voix chacune, de la plus ancienne à la plus récente. */
async function seedPeriods(workspaceId: string, userId: string, n = 25) {
	const starts: string[] = [];
	for (let i = 0; i < n; i++) {
		const d = new Date(Date.UTC(2026, 0, 5 + i * 7));
		const start = d.toISOString().slice(0, 10);
		const end = new Date(d.getTime() + 4 * 86400000).toISOString().slice(0, 10);
		starts.push(start);
		await submitVote(workspaceId, userId, start, end, 3, `msg-${i}`);
	}
	return starts.sort().reverse();
}

describe('GET /api/mood/periods', () => {
	it('rejette un appel non authentifié', async () => {
		await expect(call({ workspace: null, user: null }, '?before=2026-01-01')).rejects.toMatchObject({ status: 401 });
	});

	it('rejette un membre sans droit de lecture — les messages ne doivent pas fuiter', async () => {
		const { workspaceId } = await makeWorkspace('mood-api-role');
		const { userId: membreId } = await addMember(workspaceId, 'USER', 'mood-api-user');
		await expect(call(await fakeLocals(membreId), '?before=2026-06-01')).rejects.toMatchObject({ status: 403 });
	});

	it('accepte un non-admin porteur de la capacité canViewMoodResults', async () => {
		const { workspaceId, userId: adminId } = await makeWorkspace('mood-api-cap');
		const { userId: lecteurId } = await addMember(workspaceId, 'USER', 'mood-api-reader');
		await grantCapability(workspaceId, lecteurId, 'canViewMoodResults');
		await seedPeriods(workspaceId, adminId, 3);

		const res = await call(await fakeLocals(lecteurId), '?before=2026-12-31');
		expect((await res.json()).periods.length).toBeGreaterThan(0);
	});

	it('exige un curseur au bon format — pas d’appel sans borne', async () => {
		const { userId } = await makeWorkspace('mood-api-cursor');
		const locals = await fakeLocals(userId);
		for (const before of ['', 'hier', '2026-1-1', "2026-01-01' or 1=1"]) {
			await expect(call(locals, `?before=${encodeURIComponent(before)}`), before).rejects.toMatchObject({ status: 400 });
		}
	});

	it('le curseur est strict : la plage servie de curseur n’est jamais renvoyée deux fois', async () => {
		const { workspaceId, userId } = await makeWorkspace('mood-api-page');
		const desc = await seedPeriods(workspaceId, userId);
		const locals = await fakeLocals(userId);

		const page2 = await (await call(locals, `?before=${desc[19]}`)).json();
		expect(page2.periods).toHaveLength(5);
		expect(page2.hasMore).toBe(false);
		expect(page2.periods.map((p: { periodStart: string }) => p.periodStart)).toEqual(desc.slice(20));
		expect(page2.periods.some((p: { periodStart: string }) => p.periodStart === desc[19])).toBe(false);
	});

	it('un curseur plus ancien que tout l’historique renvoie une page vide', async () => {
		const { workspaceId, userId } = await makeWorkspace('mood-api-empty');
		await seedPeriods(workspaceId, userId, 3);

		const res = await (await call(await fakeLocals(userId), '?before=2020-01-01')).json();
		expect(res).toEqual({ periods: [], hasMore: false });
	});
});
