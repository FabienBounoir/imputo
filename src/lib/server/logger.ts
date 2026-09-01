import pino from 'pino';
import { AsyncLocalStorage } from 'node:async_hooks';

// Contexte par requête (requestId) propagé implicitement à travers toute la chaîne async d'une
// requête HTTP — services/routes n'ont pas besoin de le faire suivre explicitement en paramètre.
// hooks.server.ts ouvre le contexte une fois par requête (voir requestContext.run) ; hors requête
// (scripts CLI, boot) le store est simplement absent, mixin() omet requestId sans erreur.
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

// Env-free (process.env direct, pas $env/dynamic/private) : ce module doit pouvoir être importé
// aussi bien par SvelteKit que par les scripts CLI/CronJob (jira-sync.ts) qui tournent sous tsx
// brut sans résolution des alias $env — même contrainte que db/connection.ts et jiraSync.ts.
const pinoLogger = pino(
	{
		level: process.env.LOG_LEVEL ?? 'info',
		base: undefined, // pas de pid/hostname : bruit inutile dans un pod, déjà identifié par k8s
		redact: {
			paths: ['*.password', '*.token', '*.authorization', '*.cookie', '*.secret', '*.patEncrypted'],
			censor: '[redacted]'
		},
		mixin() {
			const store = requestContext.getStore();
			return store ? { requestId: store.requestId } : {};
		}
	},
	// LOKI_URL absent (dev local, CLI scripts, envs sans imputo-logs joignable) : reste sur le seul
	// stdout, chemin synchrone par défaut de pino — pas de worker thread à payer pour rien.
	process.env.LOKI_URL
		? pino.transport({
				targets: [
					{ target: 'pino/file', level: 'debug', options: { destination: 1 } },
					{
						target: 'pino-loki',
						level: 'debug',
						options: {
							host: process.env.LOKI_URL,
							batching: true,
							interval: 5,
							// namespace du pod = env (imputo vs imputo-preprod), via Downward API — jamais une
							// valeur à synchroniser à la main entre environnements (voir deployment.yaml).
							labels: { app: 'imputo', env: process.env.POD_NAMESPACE ?? 'unknown' }
						}
					}
				]
			})
		: undefined
);

type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, message: string, meta?: Record<string, unknown>) {
	pinoLogger[level](meta ?? {}, message);
}

export const logger = {
	debug: (message: string, meta?: Record<string, unknown>) => write('debug', message, meta),
	info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
	warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
	error: (message: string, err?: unknown, meta?: Record<string, unknown>) =>
		write('error', message, {
			...meta,
			error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err
		})
};
