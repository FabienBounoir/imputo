import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runCronJob } from '$lib/server/cronJob';
import { runNotifications } from '$lib/server/services/notifications';

// Déclenché par un scheduler externe (Vercel Cron / CronJob K8s), protégé par CRON_SECRET.
// ?kind=morning|evening|weekly|mood-deadline&slot=0900 (slot optionnel : relance du jour pour morning/evening)
const KINDS = ['morning', 'evening', 'weekly', 'mood-deadline'] as const;

const run: RequestHandler = async ({ request, url }) => {
	const kind = url.searchParams.get('kind');
	if (!KINDS.includes(kind as (typeof KINDS)[number]))
		error(400, `kind invalide (${KINDS.join('|')})`);
	const slot = url.searchParams.get('slot') ?? '';
	return runCronJob('notify', request, url, () => runNotifications(kind as (typeof KINDS)[number], slot));
};

export const POST = run;
export const GET = run;
