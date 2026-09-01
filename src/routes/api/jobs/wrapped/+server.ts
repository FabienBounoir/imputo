import type { RequestHandler } from './$types';
import { runCronJob } from '$lib/server/cronJob';
import { runWrapped } from '$lib/server/services/wrapped';
import { todayInParis } from '$lib/utils/date';

// Déclenché par un scheduler externe (Vercel Cron / CronJob Kubernetes / cron système), 1×/jour,
// comme jobs/snapshot. No-op hors fenêtre du wrapped (cf. runWrapped) — pas de schedule à part.
const run: RequestHandler = ({ request, url }) => {
	// ?workspaceId=... pour ne (re)générer que le wrapped d'un espace précis (QA/rattrapage ciblé)
	// sans repasser sur tous les autres — cf. runWrapped qui accepte déjà ce filtre.
	const workspaceId = url.searchParams.get('workspaceId') ?? undefined;
	return runCronJob('wrapped', request, url, () => runWrapped(todayInParis(), workspaceId));
};

export const POST = run;
export const GET = run; // pratique pour Vercel Cron (GET)
