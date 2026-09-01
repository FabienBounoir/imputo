import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { currentMoodPeriod, todayInParis } from '$lib/utils/date';
import { getMoodConfig, getMyVote, getMyStreak, getPeriodParticipation, submitVote } from '$lib/server/services/mood';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ locals }) => {
	const ws = locals.workspace!;
	if (!ws.moodEnabled) redirect(303, '/imputation');

	const config = await getMoodConfig(ws.workspaceId);
	const { start, end } = currentMoodPeriod(config.periodKind, config.startWeekday, todayInParis());
	const [myVote, streak, participation] = await Promise.all([
		getMyVote(ws.workspaceId, locals.user!.id, start),
		getMyStreak(ws.workspaceId, locals.user!.id, config.periodKind, start),
		getPeriodParticipation(ws.workspaceId, start)
	]);

	return { periodStart: start, periodEnd: end, myVote, streak, participation };
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
			// Pas `message` : c'est le commentaire libre de l'utilisateur, hors de propos pour du debug.
			logger.error('mood_vote_failed', e, { workspaceId: ws.workspaceId, periodStart: start, score });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	}
};
