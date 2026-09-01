import type { RequestHandler } from './$types';
import { runCronJob } from '$lib/server/cronJob';
import { runSupportDutyLog } from '$lib/server/services/support';
import { todayInParis } from '$lib/utils/date';

// Déclenché par un scheduler externe, 1×/jour, comme jobs/wrapped — fige qui est de perm
// aujourd'hui dans supportDutyLog pour que le comptage wrapped (computeSupportCount) lise un
// historique de faits plutôt que de recalculer via la chaîne + offset courant.
const run: RequestHandler = ({ request, url }) => {
	// ?workspaceId=... pour ne journaliser qu'un espace précis.
	const workspaceId = url.searchParams.get('workspaceId') ?? undefined;
	return runCronJob('support-duty', request, url, () => runSupportDutyLog(todayInParis(), workspaceId));
};

export const POST = run;
export const GET = run; // pratique pour Vercel Cron (GET)
