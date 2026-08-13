import type { PageServerLoad } from './$types';
import { listRefs } from '$lib/server/services/referentials';
import { getSprintDashboard } from '$lib/server/services/sprintDashboard';
import { resolveSelection } from '$lib/server/services/dashboardPrefs';

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
	const dashboard = selectedId
		? await getSprintDashboard(ws.workspaceId, selectedId, ws.testPhase, isAdmin, locals.user!.sortActivitiesAlpha)
		: null;
	return { dashboard, options, selectedId };
};
