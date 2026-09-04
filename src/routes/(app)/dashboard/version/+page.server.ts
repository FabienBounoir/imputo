import type { PageServerLoad } from './$types';
import { listRefs } from '$lib/server/services/referentials';
import { getSprintDashboard } from '$lib/server/services/sprintDashboard';
import { resolveSelection } from '$lib/server/services/dashboardPrefs';
import { listFacticeMemberIds } from '$lib/server/services/accounts';
import { getRefData } from '$lib/server/services/tickets';
import { isManagerOrAdmin } from '$lib/server/services/workspaces';

export const load: PageServerLoad = async ({ locals, url, cookies }) => {
	const ws = locals.workspace!;
	const versions = await listRefs(ws.workspaceId, 'version');
	const active = versions.filter((v) => !v.archived);
	const options = (active.length > 0 ? active : versions).sort((a, b) => a.name.localeCompare(b.name));
	// Présélection par défaut = la version la plus récemment créée ; le dernier choix de
	// l'utilisateur (cookie, résolu ici côté serveur pour éviter tout flash au premier rendu)
	// prend le pas dessus.
	const selectedId = resolveSelection(cookies, ws.workspaceId, 'version', url.searchParams.get('id'), options);

	const isAdmin = locals.role === 'ADMIN';
	// Membres "factice" (arrangements entre projets en clôture, pas de vraies personnes) : exclus de
	// "Répartition par personne" pour un rôle non-ADMIN — cf. accounts.ts listFacticeMemberIds.
	const excludeUserIds = isAdmin ? undefined : await listFacticeMemberIds(ws.workspaceId);
	// Nécessaires pour le menu clic droit + la modale d'édition complète (TicketEditModal, même
	// modal que Tickets & chiffrage) sur les tickets du dashboard — cf. SprintDashboardPanel.svelte.
	const [ref, dashboard] = await Promise.all([
		getRefData(ws.workspaceId, locals.user!.sortActivitiesAlpha),
		selectedId
			? getSprintDashboard(ws.workspaceId, selectedId, ws.testPhase, locals.perimeterCtx, locals.user!.sortActivitiesAlpha, excludeUserIds)
			: Promise.resolve(null)
	]);
	return {
		dashboard,
		options,
		selectedId,
		states: ref.states,
		projects: ref.projects,
		sprints: ref.sprints,
		versions: ref.versions,
		ssps: ref.ssps,
		ticketGroups: ref.ticketGroups,
		assignableMembers: ref.members.filter((m) => !m.factice),
		testPhase: ws.testPhase,
		canEditEstimation: isManagerOrAdmin(locals.role),
		isAdmin,
		isOwner: locals.user!.id === ws.createdByUserId || isAdmin
	};
};
