import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Env-free factory so the app (SvelteKit) and CLI scripts (seed) share one db layer.
export function createDb(url: string) {
	const client = postgres(url, { max: 10 });
	return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
