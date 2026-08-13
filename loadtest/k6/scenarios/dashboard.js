// Scénario "Dashboard" — pages de lecture seule (`getDashboard`/`getSprintDashboard`, cf.
// loadtest/README.md pour l'hypothèse "listTickets() non paginé, y compris sprintDashboard qui
// charge tout puis filtre en mémoire pour un seul sprint"). VUs faibles : ce sont des pages
// consultées ponctuellement, pas saisies en continu.
//
// Chaque itération visite les 3 pages du dashboard (comme un manager qui fait le tour), sans `id`
// explicite : `/dashboard/sprint` et `/dashboard/version` retombent sur le sprint/version le plus
// récemment créé par défaut (cf. resolveSelection dans dashboardPrefs.ts) — pas besoin de
// découvrir les IDs pour ce scénario.
//
// Usage :
//   BASE_URL=https://imputo-... SEED_WORKSPACES=5 SEED_USERS_PER_WS=25 \
//     k6 run loadtest/k6/scenarios/dashboard.js
//
// Variables d'env : BASE_URL (obligatoire), SEED_WORKSPACES/SEED_USERS_PER_WS (doivent matcher le
// seed effectivement chargé), DASHBOARD_VUS (défaut 10), RAMP_UP/HOLD/RAMP_DOWN (défauts 2m/10m/2m).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { login, personaForVU } from '../lib/auth.js';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const WORKSPACES = Number(__ENV.SEED_WORKSPACES || 1);
const USERS_PER_WS = Number(__ENV.SEED_USERS_PER_WS || 5);
const DASHBOARD_VUS = Number(__ENV.DASHBOARD_VUS || 10);
const RAMP_UP = __ENV.RAMP_UP || '2m';
const HOLD = __ENV.HOLD || '10m';
const RAMP_DOWN = __ENV.RAMP_DOWN || '2m';

const overviewDuration = new Trend('dashboard_overview_duration', true);
const sprintDuration = new Trend('dashboard_sprint_duration', true);
const versionDuration = new Trend('dashboard_version_duration', true);

export const options = {
	scenarios: {
		dashboard: {
			executor: 'ramping-vus',
			exec: 'dashboard',
			startVUs: 0,
			stages: [
				{ duration: RAMP_UP, target: DASHBOARD_VUS },
				{ duration: HOLD, target: DASHBOARD_VUS },
				{ duration: RAMP_DOWN, target: 0 }
			]
		}
	},
	thresholds: {
		http_req_failed: ['rate<0.01'],
		dashboard_overview_duration: ['p(95)<800'],
		dashboard_sprint_duration: ['p(95)<800'],
		dashboard_version_duration: ['p(95)<800']
	}
};

export function dashboard() {
	const persona = personaForVU(__VU, WORKSPACES, USERS_PER_WS);
	login(BASE_URL, persona.email, persona.password);

	const overviewRes = http.get(`${BASE_URL}/dashboard`, { headers: { Origin: BASE_URL } });
	check(overviewRes, { 'GET /dashboard: 200': (r) => r.status === 200 });
	overviewDuration.add(overviewRes.timings.duration);
	sleep(1 + Math.random() * 2);

	const sprintRes = http.get(`${BASE_URL}/dashboard/sprint`, { headers: { Origin: BASE_URL } });
	check(sprintRes, { 'GET /dashboard/sprint: 200': (r) => r.status === 200 });
	sprintDuration.add(sprintRes.timings.duration);
	sleep(1 + Math.random() * 2);

	const versionRes = http.get(`${BASE_URL}/dashboard/version`, { headers: { Origin: BASE_URL } });
	check(versionRes, { 'GET /dashboard/version: 200': (r) => r.status === 200 });
	versionDuration.add(versionRes.timings.duration);

	sleep(3 + Math.random() * 5);
}
