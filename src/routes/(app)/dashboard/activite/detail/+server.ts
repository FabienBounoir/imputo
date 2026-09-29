import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getActivitySynthesisDetail, isUuid, type SynthesisBucket } from '$lib/server/services/activitySynthesis';
import { listFacticeMemberIds } from '$lib/server/services/accounts';

/**
 * Détail d'une ligne de la Synthèse par activité, chargé au clic (modale) plutôt qu'embarqué dans
 * la page : ?bucket=<activityId|ABSENCE|NONE> & (user=<userId> | task=<TYPE:id>), plus les mêmes
 * filtres que la page (project, sprint, version, ssp, group). Mêmes droits que la page : tout
 * membre, factices exclus pour un non-ADMIN.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');
	const q = url.searchParams;

	const rawBucket = q.get('bucket') ?? '';
	const bucket: SynthesisBucket | null =
		rawBucket === 'ABSENCE' || rawBucket === 'NONE'
			? { kind: rawBucket }
			: isUuid(rawBucket)
				? { kind: 'ACTIVITY', activityId: rawBucket }
				: null;
	const userId = q.get('user');
	const taskId = q.get('task');
	if (!bucket || (!userId && !taskId) || (userId && !isUuid(userId))) error(400, 'Paramètres invalides.');

	// Un id mal formé ferait planter la requête (cast uuid côté Postgres) : ignoré comme sur la page.
	const uuidParam = (k: string) => {
		const v = q.get(k);
		return v && isUuid(v) ? v : undefined;
	};
	const filters = {
		projectId: uuidParam('project'),
		sprintId: uuidParam('sprint'),
		versionId: uuidParam('version'),
		sspId: uuidParam('ssp'),
		groupId: uuidParam('group')
	};
	const excludeUserIds = locals.role === 'ADMIN' ? undefined : await listFacticeMemberIds(ws.workspaceId);

	const detail = await getActivitySynthesisDetail(
		ws.workspaceId,
		filters,
		excludeUserIds,
		bucket,
		userId ? { userId } : { taskId: taskId! }
	);
	if (!detail) error(400, 'Tâche invalide.');
	return json(detail);
};
