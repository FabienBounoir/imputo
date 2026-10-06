import { error, json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { config } from '$lib/server/config';
import { logger } from '$lib/server/logger';

// Comparaison en temps constant (longueurs différentes = faux, timingSafeEqual lèverait sinon).
function safeEqual(a: string | null, b: string): boolean {
	if (a === null) return false;
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

function authorized(request: Request, url: URL): boolean {
	if (!config.cronSecret) return false;
	if (safeEqual(request.headers.get('authorization'), `Bearer ${config.cronSecret}`)) return true;
	// ponytail: ?secret= finit dans les logs d'accès du routeur — retirer quand tous les appelants passent par le header.
	return safeEqual(url.searchParams.get('secret'), config.cronSecret);
}

/** Point d'entrée commun aux jobs cron HTTP (cleanup/notify/snapshot/wrapped/support-duty) : ce
 *  sont les seuls déclencheurs externes et non supervisés de l'app (scheduler K8s/Vercel), donc
 *  le seul endroit où un log structuré fait la différence entre "ça tourne" et "ça tourne dans
 *  le silence" — une tentative avec un secret invalide ou un run qui échoue ne remontait nulle part. */
export async function runCronJob(
	name: string,
	request: Request,
	url: URL,
	fn: () => Promise<Record<string, unknown>>
) {
	if (!authorized(request, url)) {
		logger.warn('cron_unauthorized', { job: name, path: url.pathname });
		error(401, 'Unauthorized');
	}
	const start = Date.now();
	try {
		const result = await fn();
		logger.info('cron_completed', { job: name, durationMs: Date.now() - start, ...result });
		return json({ ok: true, ...result });
	} catch (err) {
		logger.error('cron_failed', err, { job: name, durationMs: Date.now() - start });
		throw err;
	}
}
