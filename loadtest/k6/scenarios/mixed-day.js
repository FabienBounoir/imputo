// Scénario "Journée mixte" — composite pondéré simulant une vraie journée d'usage, en réutilisant
// tel quel les fonctions des autres scénarios (pas de duplication de logique) : ~60% imputation
// (individuel + vue équipe), 20% tickets (tableau + kanban), 15% dashboard, 5% export — répartition
// actée dans le plan. C'est le chiffre à retenir pour "l'app tient une journée de charge réelle".
//
// Usage :
//   BASE_URL=https://imputo-... SEED_WORKSPACES=5 SEED_USERS_PER_WS=25 MIXED_VUS=130 \
//     k6 run loadtest/k6/scenarios/mixed-day.js
//
// Variables d'env : BASE_URL (obligatoire), SEED_WORKSPACES/SEED_USERS_PER_WS (doivent matcher le
// seed effectivement chargé), MIXED_VUS (défaut = workspaces×users, cohérent avec l'audit initial),
// RAMP_UP/HOLD/RAMP_DOWN (défauts 2m/10m/2m).
import { individual as imputationIndividual, team as imputationTeam } from './imputation.js';
import { table as ticketsTable, kanban as ticketsKanban } from './tickets.js';
import { dashboard as dashboardVisit } from './dashboard.js';
import { exportOnce } from './export.js';

const WORKSPACES = Number(__ENV.SEED_WORKSPACES || 1);
const USERS_PER_WS = Number(__ENV.SEED_USERS_PER_WS || 5);
const MIXED_VUS = Number(__ENV.MIXED_VUS || WORKSPACES * USERS_PER_WS);
const RAMP_UP = __ENV.RAMP_UP || '2m';
const HOLD = __ENV.HOLD || '10m';
const RAMP_DOWN = __ENV.RAMP_DOWN || '2m';

/** Part de MIXED_VUS pour une tranche donnée (minimum 1 pour rester visible à faible échelle). */
const share = (pct) => Math.max(1, Math.round((MIXED_VUS * pct) / 100));

function stages(target) {
	return [
		{ duration: RAMP_UP, target },
		{ duration: HOLD, target },
		{ duration: RAMP_DOWN, target: 0 }
	];
}

export const options = {
	scenarios: {
		mixed_imputation_individual: {
			executor: 'ramping-vus',
			exec: 'imputationIndividual',
			startVUs: 0,
			stages: stages(share(54))
		},
		mixed_imputation_team: {
			executor: 'ramping-vus',
			exec: 'imputationTeam',
			startVUs: 0,
			stages: stages(share(6))
		},
		mixed_tickets_table: {
			executor: 'ramping-vus',
			exec: 'ticketsTable',
			startVUs: 0,
			stages: stages(share(15))
		},
		mixed_tickets_kanban: {
			executor: 'ramping-vus',
			exec: 'ticketsKanban',
			startVUs: 0,
			stages: stages(share(5))
		},
		mixed_dashboard: {
			executor: 'ramping-vus',
			exec: 'dashboardVisit',
			startVUs: 0,
			stages: stages(share(15))
		},
		mixed_export: {
			executor: 'ramping-vus',
			exec: 'exportOnce',
			startVUs: 0,
			stages: stages(share(5))
		}
	},
	thresholds: {
		http_req_failed: ['rate<0.01']
		// Pas de seuil par requête ici (get_imputation_duration, tickets_table_duration, ...) : k6 ne
		// reprend les `thresholds` que du fichier d'entrée, pas ceux des modules importés — mais les
		// métriques Trend/Rate custom, elles, sont bien alimentées quel que soit le scénario qui les
		// déclenche (mêmes objets importés). Se référer au résumé de chaque métrique dans les
		// TOTAL RESULTS pour juger, plutôt qu'à des seuils redéclarés en double ici.
	}
};

export { imputationIndividual, imputationTeam, ticketsTable, ticketsKanban, dashboardVisit, exportOnce };
