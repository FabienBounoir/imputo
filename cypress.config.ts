import { defineConfig } from 'cypress';

export default defineConfig({
	e2e: {
		baseUrl: 'http://localhost:5173',
		// ponytail: retry en CI seulement — le premier hit d'une route en dev (Vite compile à la
		// demande) peut dépasser le defaultCommandTimeout (4s) sur un runner CI lent/partagé,
		// sans que ce soit un vrai bug. Pas de retry en `open` (mode local interactif).
		retries: { runMode: 1, openMode: 0 }
	}
});
