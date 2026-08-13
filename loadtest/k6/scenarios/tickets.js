// Scénario "Tickets" — deux profils dans le même fichier, cf. loadtest/README.md :
//   - `table` (majorité) : GET /tickets?view=table (paginé) + quelques écritures (édition de champ,
//     RAE par activité) — l'usage courant de la page.
//   - `kanban` (VUs fixes, faibles) : GET /tickets?view=kanban, **non paginé** (tout le board) —
//     hypothèse à confirmer : nettement plus lourd que la vue tableau à volume de tickets égal.
//
// Usage :
//   BASE_URL=https://imputo-... SEED_WORKSPACES=5 SEED_USERS_PER_WS=25 \
//     k6 run loadtest/k6/scenarios/tickets.js
//
// Variables d'env : BASE_URL (obligatoire), SEED_WORKSPACES/SEED_USERS_PER_WS (doivent matcher le
// seed effectivement chargé), TABLE_VUS (défaut = workspaces×users), KANBAN_VUS (défaut 10),
// RAMP_UP/HOLD/RAMP_DOWN (défauts 2m/10m/2m).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { login, personaForVU } from '../lib/auth.js';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const WORKSPACES = Number(__ENV.SEED_WORKSPACES || 1);
const USERS_PER_WS = Number(__ENV.SEED_USERS_PER_WS || 5);
const TABLE_VUS = Number(__ENV.TABLE_VUS || WORKSPACES * USERS_PER_WS);
const KANBAN_VUS = Number(__ENV.KANBAN_VUS || 10);
const RAMP_UP = __ENV.RAMP_UP || '2m';
const HOLD = __ENV.HOLD || '10m';
const RAMP_DOWN = __ENV.RAMP_DOWN || '2m';

// Sentinelle du bucket "Autre" (activité non spécifiée), cf. NO_ACTIVITY_ID dans tickets.ts — ce
// n'est pas une vraie ligne `activity`, y écrire échoue en 400 ("Activité introuvable"). À exclure
// avant de choisir une activité au hasard pour la RAE.
const NO_ACTIVITY_ID = '__no_activity__';

const tableDuration = new Trend('tickets_table_duration', true);
const kanbanDuration = new Trend('tickets_kanban_duration', true);
const updateDuration = new Trend('ticket_update_duration', true);
const raeDuration = new Trend('ticket_rae_duration', true);
const writeErrors = new Rate('tickets_write_errors');

export const options = {
	scenarios: {
		tickets_table: {
			executor: 'ramping-vus',
			exec: 'table',
			startVUs: 0,
			stages: [
				{ duration: RAMP_UP, target: TABLE_VUS },
				{ duration: HOLD, target: TABLE_VUS },
				{ duration: RAMP_DOWN, target: 0 }
			]
		},
		tickets_kanban: {
			executor: 'ramping-vus',
			exec: 'kanban',
			startVUs: 0,
			stages: [
				{ duration: RAMP_UP, target: KANBAN_VUS },
				{ duration: HOLD, target: KANBAN_VUS },
				{ duration: RAMP_DOWN, target: 0 }
			]
		}
	},
	thresholds: {
		http_req_failed: ['rate<0.01'],
		tickets_table_duration: ['p(95)<800'],
		// Pas de seuil strict côté kanban : le but de ce scénario est justement de mesurer l'écart
		// avec la vue tableau (hypothèse "non paginé, donc bien plus lourd"), pas de faire échouer
		// le run sur une hypothèse déjà posée dans le plan.
		ticket_update_duration: ['p(95)<400'],
		ticket_rae_duration: ['p(95)<400'],
		tickets_write_errors: ['rate<0.01']
	}
};

function searchTickets() {
	const res = http.get(`${BASE_URL}/api/command/tickets?q=SBX`, { headers: { Origin: BASE_URL } });
	const parsed = res.json();
	return (parsed && parsed.tickets) || [];
}

export function table() {
	const persona = personaForVU(__VU, WORKSPACES, USERS_PER_WS);
	login(BASE_URL, persona.email, persona.password);

	const page = 1 + Math.floor(Math.random() * 3);
	const getRes = http.get(`${BASE_URL}/tickets?view=table&page=${page}`, { headers: { Origin: BASE_URL } });
	check(getRes, { 'GET /tickets table: 200': (r) => r.status === 200 });
	tableDuration.add(getRes.timings.duration);

	const tickets = searchTickets();
	if (tickets.length > 0) {
		const t = tickets[Math.floor(Math.random() * tickets.length)];

		// Édition de champ inline (commentaire — éditable par tout rôle, non destructif sur des
		// tickets synthétiques QA Sandbox).
		const updateRes = http.post(
			`${BASE_URL}/tickets?/update`,
			{ ticketId: t.id, field: 'comment', value: `loadtest ${Date.now()}` },
			{ headers: { Origin: BASE_URL }, redirects: 0 }
		);
		updateDuration.add(updateRes.timings.duration);
		writeErrors.add(updateRes.status !== 200);

		// RAE par activité : nécessite une activité déjà présente sur le ticket (breakdown non
		// vide) — les tickets "top-up" en masse (SEED_TICKETS_PER_WS) n'en ont pas, seuls les
		// tickets curatés avec historique d'imputation en ont. `field: 'estimation'` : seul champ
		// éditable par tout rôle sans dépendre de qui a imputé (cf. canEditActivityField),
		// pour ne pas polluer le taux d'erreur avec des 403 attendus.
		const detailRes = http.get(`${BASE_URL}/api/tickets/${t.id}`, { headers: { Origin: BASE_URL } });
		const detail = detailRes.json();
		const breakdown = ((detail && detail.activityBreakdown) || []).filter((b) => b.activityId !== NO_ACTIVITY_ID);
		if (breakdown.length > 0) {
			const activityId = breakdown[Math.floor(Math.random() * breakdown.length)].activityId;
			const raeRes = http.post(
				`${BASE_URL}/api/tickets/${t.id}/activity-rae`,
				JSON.stringify({ activityId, field: 'estimation', value: Math.round(Math.random() * 20 * 4) / 4 }),
				{ headers: { Origin: BASE_URL, 'Content-Type': 'application/json' } }
			);
			raeDuration.add(raeRes.timings.duration);
			writeErrors.add(raeRes.status !== 200);
		}
	}

	sleep(2 + Math.random() * 3);
}

export function kanban() {
	const persona = personaForVU(__VU, WORKSPACES, USERS_PER_WS);
	login(BASE_URL, persona.email, persona.password);

	const res = http.get(`${BASE_URL}/tickets?view=kanban`, { headers: { Origin: BASE_URL } });
	check(res, { 'GET /tickets kanban: 200': (r) => r.status === 200 });
	kanbanDuration.add(res.timings.duration);

	sleep(3 + Math.random() * 5); // consultation, pas de saisie en continu
}
