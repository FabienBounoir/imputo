import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { runNotifications } from '$lib/server/services/notifications';

// Déclenché par un scheduler externe (Vercel Cron / CronJob K8s), protégé par CRON_SECRET.
// ?kind=morning|evening|weekly|mood-deadline&slot=0900 (slot optionnel : relance du jour pour morning/evening)
function authorized(request: Request, url: URL): boolean {
	if (!config.cronSecret) return false;
	if (request.headers.get('authorization') === `Bearer ${config.cronSecret}`) return true;
	return url.searchParams.get('secret') === config.cronSecret;
}

const KINDS = ['morning', 'evening', 'weekly', 'mood-deadline'] as const;

const run: RequestHandler = async ({ request, url }) => {
	if (!authorized(request, url)) error(401, 'Unauthorized');
	const kind = url.searchParams.get('kind');
	if (!KINDS.includes(kind as (typeof KINDS)[number]))
		error(400, `kind invalide (${KINDS.join('|')})`);
	const slot = url.searchParams.get('slot') ?? '';
	const result = await runNotifications(kind as (typeof KINDS)[number], slot);
	return json({ ok: true, ...result });
};

export const POST = run;
export const GET = run;
