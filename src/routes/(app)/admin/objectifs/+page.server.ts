import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { logger } from '$lib/server/logger';
import { getRefData, listTickets } from '$lib/server/services/tickets';
import { isManagerOrAdmin } from '$lib/server/services/workspaces';
import {
	listObjectivesForWorkspace,
	listVacationsForWeek,
	addObjective,
	removeObjective,
	moveObjective,
	setVacation,
	setObjectiveDone,
	type ObjectiveKind
} from '$lib/server/services/weeklyObjectives';
import { mondayOf, parseISODate, toISODate, isoWeek, formatRange, addDays, todayInParis } from '$lib/utils/date';

export const load: PageServerLoad = async ({ locals, url }) => {
	const ws = locals.workspace!;
	// Ouvert à toute l'équipe (lecture seule pour un membre, cf. canManage) — seul le réglage
	// d'espace ferme la page.
	if (!ws.objectivesEnabled) redirect(303, '/imputation');

	const wParam = url.searchParams.get('w');
	// Défaut = semaine courante : c'est celle qu'on regarde tous les jours. Préparer la suivante ne
	// concerne que le vendredi, et se fait via le bouton "Préparer S+1" du bandeau.
	const currentMonday = mondayOf(parseISODate(todayInParis()));
	const monday = wParam ? mondayOf(parseISODate(wParam)) : currentMonday;
	const mondayISO = toISODate(monday);

	const [ref, tickets, objectives, vacations] = await Promise.all([
		getRefData(ws.workspaceId),
		listTickets(ws.workspaceId),
		listObjectivesForWorkspace(ws.workspaceId, mondayISO),
		listVacationsForWeek(ws.workspaceId, mondayISO)
	]);

	// Membres "factice" (arrangements entre projets en clôture, pas de vraies personnes) : exclus
	// d'ici uniquement pour l'instant, cf. schema.ts membership.factice — ils restent normalement
	// imputables et visibles partout ailleurs.
	const members = ref.members.filter((m) => !m.factice);
	const nextMonday = addDays(monday, 7);

	return {
		members,
		tickets: tickets.map((t) => ({ id: t.id, key: t.key, title: t.title })),
		activities: ref.activities,
		objectives,
		vacations: [...vacations],
		canManage: isManagerOrAdmin(locals.role),
		selfId: locals.user!.id,
		weekNumber: isoWeek(monday),
		weekLabel: formatRange(monday),
		weekMondayISO: mondayISO,
		prevWeek: toISODate(addDays(monday, -7)),
		nextWeek: toISODate(nextMonday),
		nextWeekNumber: isoWeek(nextMonday),
		// Sert au bouton "Préparer S+1" (inutile quand on y est déjà) et au bandeau de semaine passée.
		currentWeekMondayISO: toISODate(currentMonday),
		isPastWeek: mondayISO < toISODate(currentMonday)
	};
};

/** Rien ne passe quand l'espace a désactivé les objectifs, y compris un POST direct. */
function disabled(locals: App.Locals) {
	return !locals.workspace?.objectivesEnabled;
}

export const actions: Actions = {
	addObjective: async ({ request, locals }) => {
		if (disabled(locals)) return fail(403, { error: 'Objectifs désactivés sur cet espace.' });
		if (!isManagerOrAdmin(locals.role)) return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const userId = String(f.get('userId') ?? '');
		const weekMondayISO = String(f.get('weekMondayISO') ?? '');
		const kind = (f.get('kind') === 'CUSTOM' ? 'CUSTOM' : 'TICKET') as ObjectiveKind;
		const ticketId = (f.get('ticketId') as string) || undefined;
		const label = (f.get('label') as string) || undefined;
		const activityId = (f.get('activityId') as string) || undefined;
		if (!userId || !weekMondayISO) return fail(400, { error: 'Données invalides.' });
		try {
			await addObjective(ws.workspaceId, locals.user!.id, { userId, weekMondayISO, kind, ticketId, label, activityId });
		} catch (e) {
			logger.error('objective_add_failed', e, { workspaceId: ws.workspaceId, userId, weekMondayISO });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { objOk: true };
	},

	removeObjective: async ({ request, locals }) => {
		if (disabled(locals)) return fail(403, { error: 'Objectifs désactivés sur cet espace.' });
		if (!isManagerOrAdmin(locals.role)) return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		try {
			await removeObjective(ws.workspaceId, String(f.get('id')));
		} catch (e) {
			logger.error('objective_remove_failed', e, { workspaceId: ws.workspaceId, id: String(f.get('id')) });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { objOk: true };
	},

	moveObjective: async ({ request, locals }) => {
		if (disabled(locals)) return fail(403, { error: 'Objectifs désactivés sur cet espace.' });
		if (!isManagerOrAdmin(locals.role)) return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const dir = f.get('dir') === 'up' ? 'up' : 'down';
		try {
			await moveObjective(ws.workspaceId, String(f.get('id')), dir);
		} catch (e) {
			logger.error('objective_move_failed', e, { workspaceId: ws.workspaceId, id: String(f.get('id')), dir });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { objOk: true };
	},

	// Seule action ouverte aux membres : chacun coche les siennes, un manager peut cocher pour tout
	// le monde. Le partage entre les deux est fait dans setObjectiveDone, pas ici — la case est
	// affichée sur les objectifs de toute l'équipe, l'UI seule ne peut pas servir de garde.
	toggleDone: async ({ request, locals }) => {
		if (disabled(locals)) return fail(403, { error: 'Objectifs désactivés sur cet espace.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		const done = f.get('done') === 'true';
		if (!id) return fail(400, { error: 'Données invalides.' });
		const ok = await setObjectiveDone(
			ws.workspaceId,
			id,
			{ userId: locals.user!.id, isManager: isManagerOrAdmin(locals.role) },
			done
		);
		if (!ok) return fail(403, { error: "Cet objectif n'est pas le vôtre." });
		return { doneOk: true };
	},

	toggleVacation: async ({ request, locals }) => {
		if (disabled(locals)) return fail(403, { error: 'Objectifs désactivés sur cet espace.' });
		if (!isManagerOrAdmin(locals.role)) return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const userId = String(f.get('userId') ?? '');
		const weekMondayISO = String(f.get('weekMondayISO') ?? '');
		const onVacation = f.get('onVacation') === 'true';
		if (!userId || !weekMondayISO) return fail(400, { error: 'Données invalides.' });
		try {
			await setVacation(ws.workspaceId, userId, weekMondayISO, onVacation);
		} catch (e) {
			logger.error('objective_toggle_vacation_failed', e, { workspaceId: ws.workspaceId, userId, weekMondayISO });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { objOk: true };
	}
};
