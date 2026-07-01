import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { runNotifications } from '$lib/server/services/notifications';

// Déclenché par un scheduler externe (Vercel Cron / CronJob K8s), protégé par CRON_SECRET.
// ?kind=morning|evening|weekly
function authorized(request: Request, url: URL): boolean {
	if (!config.cronSecret) return false;
	if (request.headers.get('authorization') === `Bearer ${config.cronSecret}`) return true;
	return url.searchParams.get('secret') === config.cronSecret;
}

const run: RequestHandler = async ({ request, url }) => {
	if (!authorized(request, url)) error(401, 'Unauthorized');
	const kind = url.searchParams.get('kind');
	if (kind !== 'morning' && kind !== 'evening' && kind !== 'weekly')
		error(400, 'kind invalide (morning|evening|weekly)');
	const result = await runNotifications(kind);
	return json({ ok: true, ...result });
};

export const POST = run;
export const GET = run;
