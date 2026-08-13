// Scénario "Mon imputation" — la page la plus utilisée de l'app, cf. loadtest/README.md.
// Deux profils dans le même fichier :
//   - `individual` (par défaut, monte en charge) : GET /imputation + rafale de setCell, comme
//     quelqu'un qui remplit sa semaine.
//   - `team` (VUs fixes, faibles) : GET /imputation?u=team, tape `getTeamTimesheet` — la requête
//     de lecture la plus lourde identifiée (jointure 7 tables non filtrée par utilisateur).
//
// Usage :
//   BASE_URL=https://imputo-... SEED_WORKSPACES=5 SEED_USERS_PER_WS=25 \
//     k6 run loadtest/k6/scenarios/imputation.js
//
// Variables d'env : BASE_URL (obligatoire), SEED_WORKSPACES/SEED_USERS_PER_WS (doivent matcher le
// seed effectivement chargé — cf. `npm run db:seed`), TARGET_VUS (défaut = workspaces×users),
// TEAM_VUS (défaut 5), RAMP_UP/HOLD/RAMP_DOWN (défauts 2m/10m/2m).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { login, personaForVU } from '../lib/auth.js';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const WORKSPACES = Number(__ENV.SEED_WORKSPACES || 1);
const USERS_PER_WS = Number(__ENV.SEED_USERS_PER_WS || 5);
const TARGET_VUS = Number(__ENV.TARGET_VUS || WORKSPACES * USERS_PER_WS);
const TEAM_VUS = Number(__ENV.TEAM_VUS || 5);
const RAMP_UP = __ENV.RAMP_UP || '2m';
const HOLD = __ENV.HOLD || '10m';
const RAMP_DOWN = __ENV.RAMP_DOWN || '2m';

const setCellDuration = new Trend('setcell_duration', true);
const setCellErrors = new Rate('setcell_errors');
const getImputationDuration = new Trend('get_imputation_duration', true);
const getTeamDuration = new Trend('get_team_timesheet_duration', true);

export const options = {
	scenarios: {
		imputation_individual: {
			executor: 'ramping-vus',
			exec: 'individual',
			startVUs: 0,
			stages: [
				{ duration: RAMP_UP, target: TARGET_VUS },
				{ duration: HOLD, target: TARGET_VUS },
				{ duration: RAMP_DOWN, target: 0 }
			]
		},
		imputation_team: {
			executor: 'ramping-vus',
			exec: 'team',
			startVUs: 0,
			stages: [
				{ duration: RAMP_UP, target: TEAM_VUS },
				{ duration: HOLD, target: TEAM_VUS },
				{ duration: RAMP_DOWN, target: 0 }
			]
		}
	},
	thresholds: {
		http_req_failed: ['rate<0.01'],
		get_imputation_duration: ['p(95)<800'],
		get_team_timesheet_duration: ['p(95)<800'],
		setcell_duration: ['p(95)<400'],
		setcell_errors: ['rate<0.01']
	}
};

function recentDays(n) {
	const days = [];
	const now = Date.now();
	for (let i = 0; i < n; i++) days.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
	return days;
}

// Cache par VU (état de module, ré-utilisé d'itération en itération pour le même VU) : pas besoin
// de refaire une recherche de tickets à chaque tour de boucle.
let cachedTickets = null;

function fetchTickets() {
	if (cachedTickets) return cachedTickets;
	const res = http.get(`${BASE_URL}/api/command/tickets?q=SBX`, { headers: { Origin: BASE_URL } });
	const parsed = res.json();
	cachedTickets = (parsed && parsed.tickets) || [];
	return cachedTickets;
}

export function individual() {
	const persona = personaForVU(__VU, WORKSPACES, USERS_PER_WS);
	login(BASE_URL, persona.email, persona.password);

	const getRes = http.get(`${BASE_URL}/imputation`, { headers: { Origin: BASE_URL } });
	check(getRes, { 'GET /imputation: 200': (r) => r.status === 200 });
	getImputationDuration.add(getRes.timings.duration);

	const tickets = fetchTickets();
	if (tickets.length > 0) {
		const days = recentDays(5);
		const amounts = ['0.25', '0.5', '0.75', '1'];
		const nCells = 10 + Math.floor(Math.random() * 11); // 10-20 cellules, cf. plan (action la plus fréquente de l'app)
		for (let i = 0; i < nCells; i++) {
			const ticket = tickets[Math.floor(Math.random() * tickets.length)];
			const body = {
				targetType: 'TICKET',
				targetId: ticket.id,
				day: days[Math.floor(Math.random() * days.length)],
				amount: amounts[Math.floor(Math.random() * amounts.length)]
			};
			const res = http.post(`${BASE_URL}/imputation?/setCell`, body, { headers: { Origin: BASE_URL }, redirects: 0 });
			setCellDuration.add(res.timings.duration);
			setCellErrors.add(res.status !== 200);
			sleep(1 + Math.random() * 2);
		}
	}

	sleep(1);
}

export function team() {
	const persona = personaForVU(__VU, WORKSPACES, USERS_PER_WS);
	login(BASE_URL, persona.email, persona.password);

	const res = http.get(`${BASE_URL}/imputation?u=team`, { headers: { Origin: BASE_URL } });
	check(res, { 'GET /imputation?u=team: 200': (r) => r.status === 200 });
	getTeamDuration.add(res.timings.duration);

	sleep(3 + Math.random() * 5); // consultation ponctuelle, pas une saisie en continu
}
