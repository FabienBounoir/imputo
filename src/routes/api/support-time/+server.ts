import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isSupportTimeTrackingEnabled, createTimeEntry } from '$lib/server/services/supportTime';
import { parseDuration } from '$lib/supportDuration';

/** Saisie rapide de temps support (raccourci Shift+T, cf. SupportTimePalette.svelte) — un point
 * d'API générique, pas une action de page : accessible depuis n'importe quelle route de l'appli. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');
	if (!(await isSupportTimeTrackingEnabled(ws.workspaceId))) error(403, 'Suivi du temps désactivé sur cet espace.');

	const body = await request.json().catch(() => null);
	const ticketRef = typeof body?.ticketRef === 'string' ? body.ticketRef.trim() : '';
	const durationRaw = typeof body?.duration === 'string' ? body.duration : '';
	if (!ticketRef) return json({ error: 'Identifiant de ticket requis.' }, { status: 400 });
	const minutes = parseDuration(durationRaw);
	if (minutes === null || minutes <= 0) return json({ error: 'Durée invalide.' }, { status: 400 });

	try {
		await createTimeEntry(ws.workspaceId, locals.user.id, { ticketRef, minutes });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Erreur.' }, { status: 400 });
	}
	return json({ ok: true });
};
