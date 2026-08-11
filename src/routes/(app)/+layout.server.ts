import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { countVotes, getMoodConfig, getMyVote } from '$lib/server/services/mood';
import { countPendingAbsences } from '$lib/server/services/absences';
import { getCurrentDuty } from '$lib/server/services/support';
import { currentMoodPeriod, todayInParis, parseISODate } from '$lib/utils/date';

// En dessous de ce seuil de jours restants sur la plage active, on relance visuellement (blink)
// les personnes qui n'ont pas encore voté.
const MOOD_REMINDER_DAYS = 2;

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	// Aucun espace actif (compte désactivé ou retiré) : écran dédié plutôt qu'un 500.
	if (!locals.workspace) redirect(303, '/no-access');

	let moodStatus: { voted: boolean; urgent: boolean } | null = null;
	let moodTotalVotes = 0;
	if (locals.workspace.moodEnabled) {
		const config = await getMoodConfig(locals.workspace.workspaceId);
		const today = todayInParis();
		const { start, end } = currentMoodPeriod(config.periodKind, config.startWeekday, today);
		const myVote = await getMyVote(locals.workspace.workspaceId, locals.user.id, start);
		const daysLeft = Math.round((parseISODate(end).getTime() - parseISODate(today).getTime()) / 86400000);
		moodStatus = { voted: Boolean(myVote), urgent: !myVote && daysLeft <= MOOD_REMINDER_DAYS };
		if (locals.role === 'ADMIN') moodTotalVotes = await countVotes(locals.workspace.workspaceId);
	}

	const canManageOthers = locals.role === 'ADMIN' || locals.role === 'MANAGER';
	const pendingAbsencesCount = canManageOthers ? await countPendingAbsences(locals.workspace.workspaceId) : 0;

	// Nom affiché dans le lien "Support" du menu, pour voir qui est de perm sans ouvrir la page.
	const supportDuty = locals.workspace.supportEnabled ? await getCurrentDuty(locals.workspace.workspaceId) : null;

	return {
		user: locals.user,
		workspace: locals.workspace,
		memberships: locals.memberships,
		role: locals.role,
		canViewMoodResults: locals.canViewMoodResults,
		moodStatus,
		moodTotalVotes,
		pendingAbsencesCount,
		supportDuty
	};
};
