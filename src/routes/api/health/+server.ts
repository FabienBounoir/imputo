import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Pas d'auth, pas de dépendance DB — juste "le process répond". Sondé depuis l'extérieur (Grafana,
// via la vraie Route publique) pour couvrir DNS/TLS/routeur, ce que la sonde interne OpenShift
// (readiness/liveness sur le pod) ne teste pas. Filtré des logs "request" dans hooks.server.ts.
export const GET: RequestHandler = () => json({ status: 'ok' });
