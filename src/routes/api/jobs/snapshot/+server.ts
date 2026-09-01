import type { RequestHandler } from './$types';
import { runCronJob } from '$lib/server/cronJob';
import { runSnapshot } from '$lib/server/services/snapshot';

// Déclenché par un scheduler externe (Vercel Cron / CronJob Kubernetes / cron système), 1×/jour.
const run: RequestHandler = ({ request, url }) => runCronJob('snapshot', request, url, runSnapshot);

export const POST = run;
export const GET = run; // pratique pour Vercel Cron (GET)
