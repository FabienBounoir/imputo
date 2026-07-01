import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	// Aucun espace actif (compte désactivé ou retiré) : écran dédié plutôt qu'un 500.
	if (!locals.workspace) redirect(303, '/no-access');
	return {
		user: locals.user,
		workspace: locals.workspace,
		memberships: locals.memberships,
		role: locals.role
	};
};
