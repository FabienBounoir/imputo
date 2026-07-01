import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user,
		workspace: locals.workspace,
		memberships: locals.memberships,
		role: locals.role
	};
};
