import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getMoodConfig, listMoodResults, resetPeriodVotes } from '$lib/server/services/mood';
import { currentMoodPeriod, todayInParis } from '$lib/utils/date';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.role !== 'ADMIN') redirect(303, '/imputation');
	const ws = locals.workspace!;
	const [periods, config] = await Promise.all([listMoodResults(ws.workspaceId), getMoodConfig(ws.workspaceId)]);
	const currentPeriodStart = currentMoodPeriod(config.periodKind, config.startWeekday, todayInParis()).start;
	return { periods, currentPeriodStart };
};

export const actions: Actions = {
	resetCurrentPeriod: async ({ locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const config = await getMoodConfig(ws.workspaceId);
		const { start } = currentMoodPeriod(config.periodKind, config.startWeekday, todayInParis());
		await resetPeriodVotes(ws.workspaceId, start);
		return { resetOk: true };
	}
};
