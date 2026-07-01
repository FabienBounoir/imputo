import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Portable deploy target: `vercel` for Vercel, `node` (default) for Docker / Kubernetes.
const adapter = process.env.BUILD_ADAPTER === 'vercel' ? adapterVercel() : adapterNode();

export default defineConfig({
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
		setupFiles: ['./vitest-setup.ts']
	}
});
