import type { PageServerLoad } from './$types';
import { getRefData } from '$lib/server/services/tickets';
import { getActivitySynthesisView } from '$lib/server/services/activitySynthesis';
import { listFacticeMemberIds } from '$lib/server/services/accounts';
import { isManagerOrAdmin } from '$lib/server/services/workspaces';

export const load: PageServerLoad = async ({ locals, url, cookies }) => {
	const ws = locals.workspace!;

	// Derniers filtres mémorisés (cookie scopé par espace, même logique que dashboardPrefs.ts : lu
	// côté serveur pour éviter un flash de données non filtrées). Écrit côté client à chaque
	// changement de filtre (cf. +page.svelte), y compris "Tout effacer" qui le vide : sans ça une
	// URL sans paramètre ne distinguerait pas "je reviens sur la page" de "je viens de tout effacer".
	// L'URL explicite prime.
	const cookieName = `imputo-activite-filters-${ws.workspaceId}`;
	const params = url.search ? url.searchParams : new URLSearchParams(cookies.get(cookieName) ?? '');

	const isAdmin = locals.role === 'ADMIN';
	const excludeUserIds = isAdmin ? undefined : await listFacticeMemberIds(ws.workspaceId);
	const ref = await getRefData(ws.workspaceId);
	// Un id mémorisé peut viser un référentiel supprimé depuis : ignoré plutôt que de filtrer dans le vide.
	const pick = (key: string, options: { id: string }[]) => {
		const v = params.get(key);
		return v && options.some((o) => o.id === v) ? v : undefined;
	};
	const filters = {
		projectId: pick('project', ref.projects),
		sprintId: pick('sprint', ref.sprints),
		versionId: pick('version', ref.versions),
		sspId: pick('ssp', ref.ssps),
		groupId: pick('group', ref.ticketGroups)
	};

	// Ouvert à tous comme Par version / Par sprint : membres "factice" exclus pour un non-ADMIN
	// (cf. accounts.ts listFacticeMemberIds).
	const view = await getActivitySynthesisView(ws.workspaceId, filters, excludeUserIds);

	return {
		ref,
		view,
		filters,
		cookieName,
		// Pour la modale ticket (clic sur une tâche du détail), mêmes droits que Par sprint.
		testPhase: ws.testPhase,
		canEditEstimation: isManagerOrAdmin(locals.role),
		isAdmin,
		isOwner: locals.user!.id === ws.createdByUserId || isAdmin
	};
};
