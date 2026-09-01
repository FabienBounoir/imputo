import type { RequestHandler } from './$types';
import { runCronJob } from '$lib/server/cronJob';
import { runCleanup } from '$lib/server/services/jobs';

// Déclenché par un scheduler externe (Vercel Cron / CronJob Kubernetes / cron système).
const run: RequestHandler = ({ request, url }) => runCronJob('cleanup', request, url, runCleanup);

export const POST = run;
export const GET = run; // pratique pour Vercel Cron (GET)
