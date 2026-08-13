// Scénario "Export" — PAS un test de débit : `/export` (src/lib/server/excel/export.ts) fait
// 11 requêtes + construit 9 feuilles Excel à chaque appel, et `?sheets=` ne fait que supprimer des
// feuilles *après* construction (ne réduit ni requêtes ni CPU) — l'hypothèse du plan est un risque
// de **concurrence** (plusieurs exports en même temps) plus qu'un plafond de débit classique.
//
// Donc : paliers à VUs fixes et faibles (1 puis 5 puis 10 exports concurrents, cf. STAGE_DURATION),
// pas de montée continue — le but est de voir où la latence/mémoire décroche entre les paliers, pas
// de maximiser le débit.
//
// Usage :
//   BASE_URL=https://imputo-... SEED_WORKSPACES=5 SEED_USERS_PER_WS=25 \
//     k6 run loadtest/k6/scenarios/export.js
//
// Variables d'env : BASE_URL (obligatoire), SEED_WORKSPACES/SEED_USERS_PER_WS (doivent matcher le
// seed effectivement chargé), STAGE_SECONDS (défaut 120, durée de chacun des 3 paliers 1/5/10 VUs).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { login, personaForVU } from '../lib/auth.js';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const WORKSPACES = Number(__ENV.SEED_WORKSPACES || 1);
const USERS_PER_WS = Number(__ENV.SEED_USERS_PER_WS || 5);
const STAGE_SECONDS = Number(__ENV.STAGE_SECONDS || 120);

export const exportDuration = new Trend('export_duration', true);

export const options = {
	scenarios: {
		export_1_concurrent: {
			executor: 'constant-vus',
			exec: 'exportOnce',
			vus: 1,
			duration: `${STAGE_SECONDS}s`,
			startTime: '0s'
		},
		export_5_concurrent: {
			executor: 'constant-vus',
			exec: 'exportOnce',
			vus: 5,
			duration: `${STAGE_SECONDS}s`,
			startTime: `${STAGE_SECONDS}s`
		},
		export_10_concurrent: {
			executor: 'constant-vus',
			exec: 'exportOnce',
			vus: 10,
			duration: `${STAGE_SECONDS}s`,
			startTime: `${2 * STAGE_SECONDS}s`
		}
	}
	// Pas de threshold sur export_duration : ce scénario sert à observer une éventuelle dégradation
	// entre paliers, pas à faire échouer un seuil déjà su comme le point le plus lourd de l'app.
};

/** Exporté pour être réutilisé tel quel par mixed-day.js (composite journée réaliste). */
export function exportOnce() {
	const persona = personaForVU(__VU, WORKSPACES, USERS_PER_WS);
	login(BASE_URL, persona.email, persona.password);

	const res = http.get(`${BASE_URL}/export`, { headers: { Origin: BASE_URL } });
	check(res, { 'GET /export: 200': (r) => r.status === 200 });
	exportDuration.add(res.timings.duration);

	sleep(5 + Math.random() * 10); // un export n'est pas répété en boucle par un même utilisateur
}
