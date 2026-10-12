import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const DB_TIMEOUT_MS = 2000;

// Pas d'auth. Sondé depuis l'extérieur (Grafana, via la vraie Route publique) pour couvrir
// DNS/TLS/routeur, ce que la sonde interne OpenShift ne teste pas — et la base : en septembre, une
// base preprod éteinte quatre jours n'a déclenché aucune alerte, l'app répondait toujours.
// Ne JAMAIS y pointer la livenessProbe du pod : une panne Postgres redémarrerait l'app en boucle
// (les sondes du pod visent `/`, cf. openshift/deployment.yaml). Filtré des logs "request" dans
// hooks.server.ts.
export const GET: RequestHandler = async () => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			db.execute(sql`select 1`),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(`select 1 sans réponse après ${DB_TIMEOUT_MS} ms`)), DB_TIMEOUT_MS);
			})
		]);
		return json({ status: 'ok' });
	} catch (e) {
		logger.error('health_db_failed', e);
		return json({ status: 'db_down' }, { status: 503 });
	} finally {
		clearTimeout(timer);
	}
};
