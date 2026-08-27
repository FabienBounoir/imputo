import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { runSupportDutyLog } from '$lib/server/services/support';
import { todayInParis } from '$lib/utils/date';

// Déclenché par un scheduler externe, 1×/jour, comme jobs/wrapped — fige qui est de perm
// aujourd'hui dans supportDutyLog pour que le comptage wrapped (computeSupportCount) lise un
// historique de faits plutôt que de recalculer via la chaîne + offset courant.
// Protégé par CRON_SECRET (header `Authorization: Bearer <secret>` ou `?secret=`).
function authorized(request: Request, url: URL): boolean {
	if (!config.cronSecret) return false;
	const header = request.headers.get('authorization');
	if (header === `Bearer ${config.cronSecret}`) return true;
	return url.searchParams.get('secret') === config.cronSecret;
}

const run: RequestHandler = async ({ request, url }) => {
	if (!authorized(request, url)) error(401, 'Unauthorized');
	// ?workspaceId=... pour ne journaliser qu'un espace précis.
	const workspaceId = url.searchParams.get('workspaceId') ?? undefined;
	const result = await runSupportDutyLog(todayInParis(), workspaceId);
	return json({ ok: true, ...result });
};

export const POST = run;
export const GET = run; // pratique pour Vercel Cron (GET)
