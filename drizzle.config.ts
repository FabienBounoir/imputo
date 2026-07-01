import { defineConfig } from 'drizzle-kit';
import { readFileSync } from 'node:fs';

// drizzle-kit runs outside SvelteKit, so load .env manually (no extra dependency).
if (!process.env.DATABASE_URL) {
	try {
		for (const line of readFileSync('.env', 'utf8').split('\n')) {
			const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
			if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
	} catch {
		/* no .env file */
	}
}

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: { url: process.env.DATABASE_URL! }
});
