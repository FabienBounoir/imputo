import pino from 'pino';

// Env-free (process.env direct, pas $env/dynamic/private) : ce module doit pouvoir être importé
// aussi bien par SvelteKit que par les scripts CLI/CronJob (jira-sync.ts) qui tournent sous tsx
// brut sans résolution des alias $env — même contrainte que db/connection.ts et jiraSync.ts.
const pinoLogger = pino({
	level: process.env.LOG_LEVEL ?? 'info',
	base: undefined, // pas de pid/hostname : bruit inutile dans un pod, déjà identifié par k8s
	redact: {
		paths: ['*.password', '*.token', '*.authorization', '*.cookie', '*.secret', '*.patEncrypted'],
		censor: '[redacted]'
	}
});

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
