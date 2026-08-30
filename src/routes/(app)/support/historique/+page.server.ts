import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSupportTimeStats, listTimeEntriesPage, listPeopleWithEntries } from '$lib/server/services/supportTime';
import { todayInParis } from '$lib/utils/date';

const isISODate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const PAGE_SIZE = 50;

/**
 * Vue admin complète du temps support : agrégats (SQL, jamais chargés en mémoire) + détail paginé
 * par curseur. Défaut = mois en cours plutôt que "tout" — sur plusieurs années de saisies, un
 * historique non borné ne doit jamais être le comportement silencieux par défaut, et le mois reste
 * la période la plus légère à charger.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const ws = locals.workspace!;
	if (locals.role !== 'ADMIN' || !ws.supportTimeTrackingEnabled) redirect(303, '/support');

	const today = todayInParis();
	const qFrom = url.searchParams.get('from');
	const qTo = url.searchParams.get('to');
	const preset = url.searchParams.get('preset') ?? 'month';
	const from = isISODate(qFrom) ? qFrom : preset === 'all' ? undefined : preset === 'year' ? `${today.slice(0, 4)}-01-01` : `${today.slice(0, 7)}-01`;
	const to = isISODate(qTo) ? qTo : preset === 'all' ? undefined : today;
	const userId = url.searchParams.get('userId') || undefined;
	const filter = { from, to, userId };

	const [stats, firstPage, people] = await Promise.all([
		// "Par ticket" n'a de sens qu'à l'export (période bornée, choix explicite de l'admin) — sur
		// des années de saisies, cette répartition n'a pas de plafond naturel comme les personnes,
		// donc pas question de la calculer pour un simple affichage à l'écran.
		getSupportTimeStats(ws.workspaceId, filter, { includeByTicket: false }),
		listTimeEntriesPage(ws.workspaceId, filter, { limit: PAGE_SIZE }),
		listPeopleWithEntries(ws.workspaceId)
	]);

	return {
		stats,
		entries: firstPage.entries,
		nextCursor: firstPage.nextCursor,
		people,
		filter: { from: from ?? '', to: to ?? '', userId: userId ?? '' },
		preset
	};
};
