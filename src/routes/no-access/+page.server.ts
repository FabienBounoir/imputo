import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	// L'utilisateur a (re)gagné un espace actif : on le renvoie dans l'app.
	if (locals.workspace) redirect(303, '/imputation');
	return {
		deactivatedWorkspace: locals.deactivatedWorkspace,
		memberships: locals.memberships
	};
};
