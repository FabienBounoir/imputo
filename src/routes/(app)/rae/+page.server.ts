import type { PageServerLoad } from './$types';
import { config } from '$lib/server/config';
import { listStaleRaePairs } from '$lib/server/services/tickets';

// Pas d'entrée de menu : on arrive ici par la pastille « RAE à revoir » (SidebarPills) ou la notif.
export const load: PageServerLoad = async ({ locals }) => ({
	pairs: await listStaleRaePairs({ workspaceId: locals.workspace!.workspaceId, userId: locals.user!.id }),
	staleDays: config.raeStaleDays
});
