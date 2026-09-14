import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markSeen } from '$lib/server/services/badges';

/**
 * Marque des paliers comme annoncés. Route API et pas action de page : l'animation peut désormais
 * surgir sur n'importe quel écran (le layout la déclenche), or un layout ne peut pas porter
 * d'actions — sans ça, fermer l'animation depuis /imputation n'aurait rien enregistré et elle
 * serait revenue à chaque navigation.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.workspace) error(401, 'Non authentifié');
	const body = await request.json().catch(() => null);
	const ids = Array.isArray(body?.badgeIds) ? body.badgeIds.filter((v: unknown) => typeof v === 'string') : [];
	if (ids.length === 0) return json({ ok: true, marked: 0 });
	await markSeen(locals.workspace.workspaceId, locals.user.id, ids);
	return json({ ok: true, marked: ids.length });
};
