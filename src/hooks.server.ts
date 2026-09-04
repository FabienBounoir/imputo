import type { Handle, HandleServerError } from '@sveltejs/kit';
import {
	SESSION_COOKIE,
	validateSession,
	deleteSessionCookie,
	setSessionWorkspace
} from '$lib/server/auth/session';
import { listMembershipsForUser, getDeactivatedWorkspace } from '$lib/server/services/workspaces';
import { loadPerimeterCtx, EMPTY_PERIMETER_CTX } from '$lib/server/services/perimeters';
import { logger, requestContext } from '$lib/server/logger';
import { randomUUID } from 'node:crypto';

// hooks.server.ts n'est chargé qu'une fois au boot : c'est le seul endroit fiable pour
// attraper ce qui échappe complètement à SvelteKit (promesse non attendue, throw hors requête).
process.on('unhandledRejection', (reason) => logger.error('unhandled_rejection', reason));
process.on('uncaughtException', (err) => logger.error('uncaught_exception', err));

export const handle: Handle = (input) =>
	requestContext.run({ requestId: randomUUID() }, () => handleRequest(input));

const handleRequest: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.sessionToken = null;
	event.locals.memberships = [];
	event.locals.workspace = null;
	event.locals.role = null;
	event.locals.canViewImputations = false;
	event.locals.canViewMoodResults = false;
	event.locals.deactivatedWorkspace = null;
	event.locals.perimeterCtx = EMPTY_PERIMETER_CTX;

	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const { session, user } = await validateSession(token);
		if (session && user) {
			event.locals.sessionToken = token;
			event.locals.user = {
				id: user.id,
				displayName: user.displayName,
				email: user.email,
				themePref: user.themePref,
				accentMode: user.accentMode,
				accentColor: user.accentColor,
				sortActivitiesAlpha: user.sortActivitiesAlpha,
				motivationBanner: user.motivationBanner,
				tutorialSeenAt: user.tutorialSeenAt
			};

			const memberships = await listMembershipsForUser(user.id);
			event.locals.memberships = memberships;

			// Détermine l'espace courant (celui de la session, sinon le premier).
			let current = memberships.find((m) => m.workspaceId === session.workspaceId) ?? null;
			if (!current) {
				// L'espace de session n'est pas un espace actif : soit l'utilisateur y a été
				// désactivé (on l'en informe), soit l'espace est obsolète (on bascule).
				const deactivated = session.workspaceId
					? await getDeactivatedWorkspace(session.workspaceId, user.id)
					: null;
				if (deactivated) {
					event.locals.deactivatedWorkspace = deactivated;
				} else if (memberships.length > 0) {
					current = memberships[0];
					await setSessionWorkspace(token, current.workspaceId);
				}
			}
			event.locals.workspace = current;
			event.locals.role = current?.role ?? null;
			event.locals.canViewImputations = current?.canViewImputations ?? false;
			event.locals.canViewMoodResults = current?.canViewMoodResults ?? false;
			// Périmètres pilotés/fréquentés dans l'espace courant. Une requête de plus par requête
			// authentifiée, couverte par perimeter_member_ws_user_idx — au même titre que les
			// memberships ci-dessus, c'est du contexte dont presque tous les écrans ont besoin.
			if (current) {
				event.locals.perimeterCtx = await loadPerimeterCtx(current.workspaceId, user.id, current.role);
			}
		} else {
			deleteSessionCookie(event.cookies);
		}
	}

	const start = Date.now();
	const response = await resolve(event);

	// Sonde OpenShift (readiness/liveness/startup, GET / toutes les 10-20s en continu) : noierait
	// les dashboards business si elle passait par `msg: "request"` (elles filtrent déjà dessus,
	// donc invisibles là), mais on la logge quand même sous `msg: "probe"` — c'est le seul signal
	// qui arrive à intervalle garanti indépendamment du trafic réel, donc la seule base fiable
	// pour une alerte "app silencieuse" (voir openshift/logging/README.md).
	const isProbe = event.request.headers.get('user-agent')?.startsWith('kube-probe');
	// /api/health : sondé depuis l'extérieur par Grafana (plugin Infinity, voir openshift/logging/
	// README.md) pour couvrir DNS/TLS/routeur — la sonde interne OpenShift ci-dessus n'y passe
	// jamais. Le résultat vit dans l'alerte Grafana elle-même (assertion sur le code retour HTTP),
	// pas la peine de le dupliquer dans Loki, on filtre juste pour ne pas polluer "request".
	const isHealthCheck = event.url.pathname === '/api/health';
	if (isProbe) {
		logger.info('probe', { status: response.status });
	} else if (!isHealthCheck) {
		logger.info('request', {
			method: event.request.method,
			path: event.url.pathname,
			status: response.status,
			durationMs: Date.now() - start,
			userId: event.locals.user?.id,
			workspaceId: event.locals.workspace?.workspaceId
		});
	}

	// Permet de retrouver dans les logs les requêtes d'un signalement précis (ex. capture réseau
	// du navigateur) sans dépendre du timestamp — requestId lui-même vient du mixin pino, pas d'ici.
	response.headers.set('X-Request-Id', requestContext.getStore()!.requestId);

	// Headers de sécurité, posés ici plutôt que dans app.html : ça couvre aussi /api,
	// qui ne rend aucun <head>. HSTS est ignoré par le navigateur sur du HTTP simple,
	// donc pas besoin de le conditionner au dev.
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	return response;
};

// Filet de sécurité pour tout ce qui remonte non catché depuis un load/action/endpoint
// (les catch() existants dans les routes gèrent déjà les erreurs métier attendues).
export const handleError: HandleServerError = ({ error, event, status }) => {
	const context = { path: event.url.pathname, method: event.request.method };
	if (status === 404) {
		// Aucune route ne correspond (favicon.ico, bot, vieux lien...) : SvelteKit lève quand même
		// une Error pour ça, mais ce n'est pas un bug applicatif — pas la peine de polluer les
		// dashboards/alertes "erreurs" avec du bruit attendu et permanent.
		logger.warn('route_not_found', context);
	} else {
		logger.error('request_error', error, context);
	}
	return { message: 'Une erreur est survenue.' };
};
