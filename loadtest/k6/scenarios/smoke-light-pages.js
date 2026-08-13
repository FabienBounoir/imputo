// Scénario "Pages légères" — passage à VUs faibles sur absences/admin/mood/support/settings/
// historique : pas des pages saisies en continu, le but est juste de confirmer qu'aucune ne
// s'effondre et que le coût de base de `hooks.server.ts` (2 requêtes DB — session + memberships —
// sur *chaque* requête, sans cache, cf. le plan) reste correct sous charge globale (à lancer en
// parallèle d'un scénario plus lourd, ou via mixed-day.js qui l'inclut déjà).
//
// `/admin` et `/admin/history` redirigent vers /imputation (303, suivi automatiquement par k6) pour
// un persona non-ADMIN — seule `alice` (userIndex 0 de chaque workspace, cf. buildPersonas) les
// charge réellement ; les autres VUs valident juste que la redirection elle-même reste rapide.
//
// Usage :
//   BASE_URL=https://imputo-... SEED_WORKSPACES=5 SEED_USERS_PER_WS=25 \
//     k6 run loadtest/k6/scenarios/smoke-light-pages.js
//
// Variables d'env : BASE_URL (obligatoire), SEED_WORKSPACES/SEED_USERS_PER_WS (doivent matcher le
// seed effectivement chargé), LIGHT_VUS (défaut 15), RAMP_UP/HOLD/RAMP_DOWN (défauts 1m/8m/1m).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { login, personaForVU } from '../lib/auth.js';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const WORKSPACES = Number(__ENV.SEED_WORKSPACES || 1);
const USERS_PER_WS = Number(__ENV.SEED_USERS_PER_WS || 5);
const LIGHT_VUS = Number(__ENV.LIGHT_VUS || 15);
const RAMP_UP = __ENV.RAMP_UP || '1m';
const HOLD = __ENV.HOLD || '8m';
const RAMP_DOWN = __ENV.RAMP_DOWN || '1m';

const PAGES = ['/absences', '/mood', '/support', '/settings', '/admin', '/admin/history'];

const pageDuration = new Trend('light_page_duration', true);

export const options = {
	scenarios: {
		light_pages: {
			executor: 'ramping-vus',
			exec: 'visit',
			startVUs: 0,
			stages: [
				{ duration: RAMP_UP, target: LIGHT_VUS },
				{ duration: HOLD, target: LIGHT_VUS },
				{ duration: RAMP_DOWN, target: 0 }
			]
		}
	},
	thresholds: {
		http_req_failed: ['rate<0.01'],
		light_page_duration: ['p(95)<800']
	}
};

/** Exporté pour être réutilisé tel quel par mixed-day.js. */
export function visit() {
	const persona = personaForVU(__VU, WORKSPACES, USERS_PER_WS);
	login(BASE_URL, persona.email, persona.password);

	const page = PAGES[Math.floor(Math.random() * PAGES.length)];
	const res = http.get(`${BASE_URL}${page}`, { headers: { Origin: BASE_URL } });
	check(res, { [`GET ${page}: 200`]: (r) => r.status === 200 });
	pageDuration.add(res.timings.duration);

	sleep(3 + Math.random() * 5);
}
