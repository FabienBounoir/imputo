import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { runSnapshot } from '$lib/server/services/snapshot';

// Déclenché par un scheduler externe (Vercel Cron / CronJob Kubernetes / cron système), 1×/jour.
// Protégé par CRON_SECRET (header `Authorization: Bearer <secret>` ou `?secret=`).
function authorized(request: Request, url: URL): boolean {
	if (!config.cronSecret) return false;
	const header = request.headers.get('authorization');
	if (header === `Bearer ${config.cronSecret}`) return true;
	return url.searchParams.get('secret') === config.cronSecret;
}

const run: RequestHandler = async ({ request, url }) => {
	if (!authorized(request, url)) error(401, 'Unauthorized');
	const result = await runSnapshot();
	return json({ ok: true, ...result });
};

export const POST = run;
export const GET = run; // pratique pour Vercel Cron (GET)
