import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { currentMoodPeriod, todayInParis } from '$lib/utils/date';
import { getMoodConfig, getMyVote, submitVote } from '$lib/server/services/mood';

export const load: PageServerLoad = async ({ locals }) => {
	const ws = locals.workspace!;
	if (!ws.moodEnabled) redirect(303, '/imputation');

	const config = await getMoodConfig(ws.workspaceId);
	const { start, end } = currentMoodPeriod(config.periodKind, config.startWeekday, todayInParis());
	const myVote = await getMyVote(ws.workspaceId, locals.user!.id, start);

	return { periodStart: start, periodEnd: end, myVote };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const ws = locals.workspace!;
		if (!ws.moodEnabled) return fail(403, { error: 'Team mood désactivé.' });

		const config = await getMoodConfig(ws.workspaceId);
		const { start, end } = currentMoodPeriod(config.periodKind, config.startWeekday, todayInParis());

		const f = await request.formData();
		const score = Number(f.get('score'));
		const message = String(f.get('message') ?? '');

		try {
			await submitVote(ws.workspaceId, locals.user!.id, start, end, score, message);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	}
};
