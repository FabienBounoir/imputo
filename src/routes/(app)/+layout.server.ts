import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getPeriodParticipation, getMoodConfig, getMyVote } from '$lib/server/services/mood';
import { countPendingAbsences } from '$lib/server/services/absences';
import { getCurrentDuty } from '$lib/server/services/support';
import { getMyWrapped, isWrappedWindowOpen, wrappedYearFor } from '$lib/server/services/wrapped';
import { getDailyQuotes } from '$lib/server/services/quotes';
import { currentMoodPeriod, todayInParis, parseISODate, lastWorkdayOnOrBefore } from '$lib/utils/date';
import { config } from '$lib/server/config';

// En dessous de ce seuil de jours restants avant l'échéance de vote (dernier jour ouvré de la
// plage), on relance visuellement (blink) les personnes qui n'ont pas encore voté. 0 = blink
// uniquement le jour de l'échéance.
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
		// Échéance = dernier jour ouvré de la plage, comme la notif MOOD_DEADLINE : sur une plage
		// lundi→dimanche, la relance visuelle doit tomber avant le vendredi soir, pas le dimanche.
		const deadline = lastWorkdayOnOrBefore(end);
		const daysLeft = Math.round((parseISODate(deadline).getTime() - parseISODate(today).getTime()) / 86400000);
		moodStatus = { voted: Boolean(myVote), urgent: !myVote && daysLeft <= MOOD_REMINDER_DAYS };
		// Badge du menu = participation de la plage en cours, pas le cumul depuis la création de
		// l'espace (un compteur qui ne redescend jamais ne dit rien de la plage qu'on est en train
		// de remplir).
		if (locals.role === 'ADMIN')
			moodTotalVotes = (await getPeriodParticipation(locals.workspace.workspaceId, start)).voted;
	}

	const canManageOthers = locals.role === 'ADMIN' || locals.role === 'MANAGER';
	const pendingAbsencesCount = canManageOthers ? await countPendingAbsences(locals.workspace.workspaceId) : 0;

	// Nom affiché dans le lien "Support" du menu, pour voir qui est de perm sans ouvrir la page.
	const supportDuty = locals.workspace.supportEnabled ? await getCurrentDuty(locals.workspace.workspaceId) : null;

	// Lien "Wrapped" du menu masqué tant que le snapshot de CETTE personne n'existe pas : la fenêtre
	// (1 déc → 5 jan) est ouverte pour tout le monde, mais le cron peut ne pas être encore passé, ou
	// la personne peut avoir rejoint après coup — inutile d'afficher un lien qui mène à une redirection.
	const wrappedYear = wrappedYearFor(todayInParis());
	const wrappedAvailable =
		isWrappedWindowOpen(todayInParis()) &&
		Boolean(await getMyWrapped(locals.workspace.workspaceId, locals.user.id, wrappedYear));

	// Phrases du jour du bandeau motivation (cache mémoire côté serveur, cf. services/quotes.ts).
	// Volontairement PAS awaité : sur cache manqué (1x/jour/process), le fetch réseau sous-jacent
	// peut prendre jusqu'à 5s (timeout), et ce load tourne sur CHAQUE navigation de CHAQUE page —
	// l'attendre bloquerait tout le rendu pour une bannière annexe. SvelteKit stream la promesse
	// telle quelle ; +layout.svelte l'attend localement avec {#await}, seule la bannière patiente.
	const motivationQuotes = locals.user.motivationBanner ? getDailyQuotes() : Promise.resolve([]);

	return {
		user: locals.user,
		workspace: locals.workspace,
		memberships: locals.memberships,
		role: locals.role,
		canViewMoodResults: locals.canViewMoodResults,
		moodStatus,
		moodTotalVotes,
		pendingAbsencesCount,
		supportDuty,
		wrappedAvailable,
		wrappedYear,
		motivationQuotes,
		vapidPublicKey: config.vapidPublic
	};
};
