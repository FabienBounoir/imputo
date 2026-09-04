import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { logger } from '$lib/server/logger';
import { getRefData, listTickets } from '$lib/server/services/tickets';
import { isManagerOrAdmin } from '$lib/server/services/workspaces';
import { hasLeadScope, listPerimeterCollaborators } from '$lib/server/services/perimeters';
import {
	listObjectivesForUser,
	listObjectivesForWorkspace,
	listVacationsForWeek,
	addObjective,
	removeObjective,
	moveObjective,
	setVacation,
	getObjectiveOwner,
	type ObjectiveKind
} from '$lib/server/services/weeklyObjectives';
import { mondayOf, parseISODate, toISODate, isoWeek, formatRange, addDays, todayInParis } from '$lib/utils/date';

/**
 * Population que l'appelant a le droit de piloter ici. `null` = tout l'espace (MANAGER/ADMIN,
 * comportement historique) ; un Set = les collaborateurs des périmètres dont il est CP ou backup ;
 * `false` = pas d'accès du tout. Un CP fixe les objectifs de son équipe, pas de celle des autres.
 */
async function objectiveScope(locals: App.Locals): Promise<Set<string> | null | false> {
	if (isManagerOrAdmin(locals.role)) return null;
	const ctx = locals.perimeterCtx;
	if (!hasLeadScope(ctx)) return false;
	return new Set(await listPerimeterCollaborators(locals.workspace!.workspaceId, [...ctx.leadPerimeterIds]));
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const scope = await objectiveScope(locals);
	if (scope === false) redirect(303, '/imputation');
	const ws = locals.workspace!;

	const wParam = url.searchParams.get('w');
	// Défaut = semaine prochaine (routine du vendredi), pas la semaine courante.
	const monday = wParam ? mondayOf(parseISODate(wParam)) : mondayOf(addDays(parseISODate(todayInParis()), 7));
	const mondayISO = toISODate(monday);

	const [ref, tickets, objectivesGlobal, vacations] = await Promise.all([
		getRefData(ws.workspaceId),
		listTickets(ws.workspaceId),
		listObjectivesForWorkspace(ws.workspaceId, mondayISO),
		listVacationsForWeek(ws.workspaceId, mondayISO)
	]);

	// Membres "factice" (arrangements entre projets en clôture, pas de vraies personnes) : exclus
	// d'ici uniquement pour l'instant, cf. schema.ts membership.factice — ils restent normalement
	// imputables et visibles partout ailleurs.
	const members = ref.members.filter((m) => !m.factice && (!scope || scope.has(m.id)));

	const uParam = url.searchParams.get('u');
	const selectedUserId = members.find((m) => m.id === uParam)?.id ?? members[0]?.id ?? '';
	const objectives = selectedUserId ? await listObjectivesForUser(ws.workspaceId, selectedUserId, mondayISO) : [];

	return {
		members,
		tickets: tickets.map((t) => ({ id: t.id, key: t.key, title: t.title })),
		activities: ref.activities,
		selectedUserId,
		objectives,
		// Filtré comme `members` : la vue « toute l'équipe » d'un CP ne doit pas laisser voir les
		// objectifs des collaborateurs des autres périmètres.
		globalObjectives: objectivesGlobal.filter((o) => !scope || scope.has(o.userId)),
		// L'export image reste réservé aux MANAGER/ADMIN : il rend la semaine de TOUT l'espace, sans
		// notion de périmètre (cf. export-image/+server.ts). Un CP pilote ses objectifs sans l'export.
		canExportImage: scope === null,
		vacations: [...vacations],
		selectedOnVacation: vacations.has(selectedUserId),
		weekNumber: isoWeek(monday),
		weekLabel: formatRange(monday),
		weekMondayISO: mondayISO,
		prevWeek: toISODate(addDays(monday, -7)),
		nextWeek: toISODate(addDays(monday, 7))
	};
};

export const actions: Actions = {
	addObjective: async ({ request, locals }) => {
		const scope = await objectiveScope(locals);
		if (scope === false) return fail(403, { error: 'Réservé aux admins et aux CP.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const userId = String(f.get('userId') ?? '');
		const weekMondayISO = String(f.get('weekMondayISO') ?? '');
		const kind = (f.get('kind') === 'CUSTOM' ? 'CUSTOM' : 'TICKET') as ObjectiveKind;
		const ticketId = (f.get('ticketId') as string) || undefined;
		const label = (f.get('label') as string) || undefined;
		const activityId = (f.get('activityId') as string) || undefined;
		if (!userId || !weekMondayISO) return fail(400, { error: 'Données invalides.' });
		if (scope && !scope.has(userId)) return fail(403, { error: 'Cette personne est hors de vos périmètres.' });
		try {
			await addObjective(ws.workspaceId, locals.user!.id, { userId, weekMondayISO, kind, ticketId, label, activityId });
		} catch (e) {
			logger.error('objective_add_failed', e, { workspaceId: ws.workspaceId, userId, weekMondayISO });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { objOk: true };
	},

	removeObjective: async ({ request, locals }) => {
		const scope = await objectiveScope(locals);
		if (scope === false) return fail(403, { error: 'Réservé aux admins et aux CP.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		// L'objectif est désigné par son id : on remonte à son propriétaire pour vérifier la portée,
		// sinon un CP pourrait supprimer l'objectif de n'importe qui en devinant un id.
		if (scope) {
			const owner = await getObjectiveOwner(ws.workspaceId, String(f.get('id')));
			if (!owner || !scope.has(owner)) return fail(403, { error: 'Cet objectif est hors de vos périmètres.' });
		}
		try {
			await removeObjective(ws.workspaceId, String(f.get('id')));
		} catch (e) {
			logger.error('objective_remove_failed', e, { workspaceId: ws.workspaceId, id: String(f.get('id')) });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { objOk: true };
	},

	moveObjective: async ({ request, locals }) => {
		const scope = await objectiveScope(locals);
		if (scope === false) return fail(403, { error: 'Réservé aux admins et aux CP.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const dir = f.get('dir') === 'up' ? 'up' : 'down';
		if (scope) {
			const owner = await getObjectiveOwner(ws.workspaceId, String(f.get('id')));
			if (!owner || !scope.has(owner)) return fail(403, { error: 'Cet objectif est hors de vos périmètres.' });
		}
		try {
			await moveObjective(ws.workspaceId, String(f.get('id')), dir);
		} catch (e) {
			logger.error('objective_move_failed', e, { workspaceId: ws.workspaceId, id: String(f.get('id')), dir });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { objOk: true };
	},

	toggleVacation: async ({ request, locals }) => {
		const scope = await objectiveScope(locals);
		if (scope === false) return fail(403, { error: 'Réservé aux admins et aux CP.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const userId = String(f.get('userId') ?? '');
		const weekMondayISO = String(f.get('weekMondayISO') ?? '');
		const onVacation = f.get('onVacation') === 'true';
		if (!userId || !weekMondayISO) return fail(400, { error: 'Données invalides.' });
		if (scope && !scope.has(userId)) return fail(403, { error: 'Cette personne est hors de vos périmètres.' });
		try {
			await setVacation(ws.workspaceId, userId, weekMondayISO, onVacation);
		} catch (e) {
			logger.error('objective_toggle_vacation_failed', e, { workspaceId: ws.workspaceId, userId, weekMondayISO });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { objOk: true };
	}
};
