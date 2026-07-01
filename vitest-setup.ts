import { readFileSync } from 'node:fs';

// Charge .env dans process.env pour les tests d'intégration (le code lit $env/dynamic/private → process.env).
try {
	for (const line of readFileSync('.env', 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
} catch {
	/* pas de .env */
}
