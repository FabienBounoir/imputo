import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Portable deploy target: `vercel` for Vercel, `node` (default) for Docker / Kubernetes.
const adapter = process.env.BUILD_ADAPTER === 'vercel' ? adapterVercel() : adapterNode();

export default defineConfig({
	define: {
		// Tag Git / short SHA injecté au build par le Dockerfile (voir ARG APP_VERSION),
		// affiché dans l'UI pour identifier la version déployée.
		__APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? 'development')
	},
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter
		})
	],
	// @ts-expect-error `test` est ajouté par vitest (qui réutilise la config vite).
	test: {
		include: ['src/**/*.{test,spec}.ts'],
		setupFiles: ['./vitest-setup.ts'],
		// Tests d'intégration sur une seule vraie DB partagée : certains services (ex. le cron de
		// notifications) opèrent sur TOUS les workspaces sans filtrage, donc les faire tourner en
		// parallèle sur plusieurs fichiers fait planter ceux qui suppriment/créent des workspaces
		// pendant qu'un autre les parcourt globalement (FK violation). Plus lent, mais fiable.
		fileParallelism: false
	}
});
