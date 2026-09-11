import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { logger } from '$lib/server/logger';
import { getRefData, listRecentTicketSummaries } from '$lib/server/services/tickets';
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

	const canManage = isManagerOrAdmin(locals.role);
	const prevMonday = addDays(monday, -7);
	const [ref, tickets, objectives, vacations, carryover] = await Promise.all([
		getRefData(ws.workspaceId),
		// Liste d'AMORCE seulement : les 20 tickets les plus récents, pas tout le catalogue. Dès qu'on
		// tape, la palette interroge /api/command/tickets côté serveur (cf. ObjectivePalette) — sans
		// quoi la page grossirait indéfiniment avec le backlog. La garde `canManage` reste : seule la
		// palette d'attribution s'en sert, et un membre n'y a pas accès.
		canManage ? listRecentTicketSummaries(ws.workspaceId) : Promise.resolve([]),
		listObjectivesForWorkspace(ws.workspaceId, mondayISO),
		listVacationsForWeek(ws.workspaceId, mondayISO),
		// Non cochés la semaine d'avant (celle affichée moins 7 j) : proposés en tête de palette pour
		// être reportés d'une touche. Même garde que `tickets`, seule la palette s'en sert.
		canManage
			? listObjectivesForWorkspace(ws.workspaceId, toISODate(prevMonday)).then((rows) => rows.filter((o) => !o.doneAt))
			: Promise.resolve([])
	]);

	// Membres "factice" (arrangements entre projets en clôture, pas de vraies personnes) : exclus
	// d'ici uniquement pour l'instant, cf. schema.ts membership.factice — ils restent normalement
	// imputables et visibles partout ailleurs.
	const members = ref.members.filter((m) => !m.factice);
	// "La semaine à préparer" est toujours la suivante par rapport à AUJOURD'HUI, pas par rapport à
	// la semaine affichée : depuis une semaine passée, le raccourci doit ramener à celle qu'on a
	// réellement à remplir, pas à la suivante de celle qu'on consulte.
	const prepMonday = addDays(currentMonday, 7);

	return {
		members,
		tickets,
		activities: ref.activities,
		objectives,
		carryover,
		vacations: [...vacations],
		canManage,
		selfId: locals.user!.id,
		weekNumber: isoWeek(monday),
		weekLabel: formatRange(monday),
		weekMondayISO: mondayISO,
		prevWeek: toISODate(prevMonday),
		prevWeekNumber: isoWeek(prevMonday),
		nextWeek: toISODate(addDays(monday, 7)),
		// Cible du bouton "Préparer S+1" : affiché tant qu'on est avant cette semaine-là (donc sur la
		// courante et sur toutes les passées), masqué une fois qu'on y est ou au-delà.
		prepWeekMondayISO: toISODate(prepMonday),
		prepWeekNumber: isoWeek(prepMonday)
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
