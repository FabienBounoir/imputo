import http from 'k6/http';
import { check } from 'k6';

// Les 5 personas nommées générées par seed.ts (buildPersonas) — au-delà, comptes synthétiques
// `userN` / `loadtest123`. Dupliqué ici volontairement (pas de fichier JSON intermédiaire à
// maintenir entre le seed et k6, cf. loadtest/README.md) : même formule des deux côtés.
const BASE_PERSONAS = [
	{ slot: 'alice', password: 'alice123' },
	{ slot: 'bob', password: 'bob123' },
	{ slot: 'chloe', password: 'chloe123' },
	{ slot: 'david', password: 'david123' },
	{ slot: 'manon', password: 'manon123' }
];

/**
 * Reconstruit l'email/mot de passe d'une persona seedée à partir du numéro de VU k6 (1-based) et
 * de l'échelle demandée (SEED_WORKSPACES × SEED_USERS_PER_WS) — répartit les VUs sur les
 * workspaces générés dans l'ordre, en boucle si plus de VUs que de personas disponibles.
 */
export function personaForVU(vuId, workspaces, usersPerWorkspace) {
	const total = Math.max(1, workspaces * usersPerWorkspace);
	const globalIndex = (vuId - 1) % total;
	const wsIndex = Math.floor(globalIndex / usersPerWorkspace);
	const userIndex = globalIndex % usersPerWorkspace;
	const wsSuffix = workspaces > 1 ? `+ws${wsIndex + 1}` : '';
	const base = BASE_PERSONAS[userIndex];
	const slot = base ? base.slot : `user${userIndex + 1}`;
	const password = base ? base.password : 'loadtest123';
	return { email: `${slot}${wsSuffix}@sandbox.test`, password, wsIndex };
}

/**
 * POST /login (action par défaut, champs `email`/`password`). SvelteKit répond en 200/JSON
 * (`{"type":"redirect",...}`) plutôt qu'en 303 brut selon la requête — peu importe : on vérifie
 * juste que le cookie de session (`imputo_session`) a bien été posé, k6 le rejoue ensuite
 * automatiquement sur toutes les requêtes suivantes de ce VU (cookie-jar par VU).
 * L'en-tête `Origin` doit matcher `baseUrl` exactement — protection CSRF intégrée de SvelteKit,
 * cf. le commentaire `ORIGIN` dans docker-compose.yml.
 */
export function login(baseUrl, email, password) {
	const res = http.post(`${baseUrl}/login`, { email, password }, { headers: { Origin: baseUrl }, redirects: 0 });
	const ok = check(res, { 'login: cookie de session reçu': () => !!res.cookies.imputo_session });
	if (!ok) throw new Error(`Échec du login pour ${email} (status ${res.status}): ${res.body}`);
	return res;
}
