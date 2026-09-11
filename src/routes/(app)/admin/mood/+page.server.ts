import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getMoodConfig, listMoodPeriodStats, listMoodResultsPage, resetPeriodVotes } from '$lib/server/services/mood';
import { currentMoodPeriod, todayInParis } from '$lib/utils/date';

export const load: PageServerLoad = async ({ locals }) => {
	const isAdmin = locals.role === 'ADMIN';
	// canViewMoodResults : capacité de lecture accordable indépendamment du rôle — la réinitialisation
	// (action ci-dessous) reste strictement réservée à l'ADMIN.
	if (!isAdmin && !locals.canViewMoodResults) redirect(303, '/imputation');
	const ws = locals.workspace!;
	// Deux jeux distincts, et c'est voulu :
	// - `stats` couvre TOUT l'historique, sans les messages (quelques nombres par plage) : la courbe
	//   de tendance, le camembert global, la meilleure/moins bonne plage et l'export CSV doivent
	//   porter sur tout, pas sur la seule page affichée — sinon ces chiffres changeraient au scroll.
	// - `page` ne contient que les 20 plages les plus récentes AVEC leurs messages, qui sont la
	//   partie lourde. Les suivantes arrivent au scroll via /api/mood/periods.
	const [stats, page, config] = await Promise.all([
		listMoodPeriodStats(ws.workspaceId),
		listMoodResultsPage(ws.workspaceId),
		getMoodConfig(ws.workspaceId)
	]);
	const currentPeriodStart = currentMoodPeriod(config.periodKind, config.startWeekday, todayInParis()).start;
	return { stats, periods: page.periods, hasMore: page.hasMore, currentPeriodStart, isAdmin };
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
