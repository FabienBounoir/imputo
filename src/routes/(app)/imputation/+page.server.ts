import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { logger } from '$lib/server/logger';
import {
	getTimesheet,
	getTeamTimesheet,
	setCell,
	deleteRow,
	reassignActivity,
	pinRow,
	listPinnedRows,
	getRecentTicketIds
} from '$lib/server/services/imputation';
import { getRefData, listTicketSummaries } from '$lib/server/services/tickets';
import { getMembership, isManagerOrAdmin } from '$lib/server/services/workspaces';
import { hasLeadScope, listPerimeterCollaborators } from '$lib/server/services/perimeters';
import { listObjectivesForUserWeeks, vacationWeeks } from '$lib/server/services/weeklyObjectives';
import { listAbsencesForRange, buildAbsenceGrid } from '$lib/server/services/absences';
import { resolvePeriodPrefs } from '$lib/server/services/imputationPrefs';
import { num } from '$lib/server/services/calc';
import { buildPeriod, parseGranularity, parsePeriodMode, todayInParis } from '$lib/utils/date';

export const load: PageServerLoad = async ({ locals, url, cookies }) => {
	const user = locals.user!;
	const ws = locals.workspace;
	if (!ws) redirect(303, '/register');
	const isAdmin = locals.role === 'ADMIN';
	const ctx = locals.perimeterCtx;
	// Un CP (ou son backup) consulte la feuille des collaborateurs de SES périmètres : c'est le
	// pendant direct de « des collaborateurs interviennent sur son périmètre ». `null` = aucune
	// restriction de population (admin, ou capacité de lecture accordée indépendamment du rôle).
	const leadCollaboratorIds =
		isAdmin || locals.canViewImputations || !hasLeadScope(ctx)
			? null
			: new Set(await listPerimeterCollaborators(ws.workspaceId, [...ctx.leadPerimeterIds]));
	// canViewOthers : peut consulter la feuille d'un tiers via ?u= (admin, capacité de lecture, ou
	// CP sur sa population) — n'accorde aucun droit d'édition, cf. resolveSubjectId.
	const canViewOthers = isAdmin || locals.canViewImputations || leadCollaboratorIds !== null;

	const { granularity, mode } = resolvePeriodPrefs(
		cookies,
		ws.workspaceId,
		url.searchParams.get('g'),
		url.searchParams.get('mode')
	);
	// `?w=` reste l'ancre (compat des favoris) ; `todayInParis()` et non `new Date()`, sinon la page
	// s'ouvre sur la veille entre minuit et 2 h heure de Paris.
	const period = buildPeriod(granularity, mode, url.searchParams.get('w') ?? todayInParis());
	const weekMondays = period.weeks.map((w) => w.mondayISO);

	const ref = await getRefData(ws.workspaceId, user.sortActivitiesAlpha);
	// Membres "factice" (arrangements entre projets en clôture, pas de vraies personnes, cf.
	// schema.ts membership.factice) : invisibles pour tout rôle non-ADMIN — sélecteur de membre,
	// vue "Toute l'équipe", et accès direct via ?u= (sinon contournable en tapant l'URL).
	// Un CP ne voit que sa population dans le sélecteur — et le filtre vaut aussi pour l'accès direct
	// par ?u=, sinon il suffirait de taper l'URL d'un membre d'un autre périmètre.
	const inLeadScope = (id: string) => !leadCollaboratorIds || id === user.id || leadCollaboratorIds.has(id);
	const visibleMembers = (isAdmin ? ref.members : ref.members.filter((m) => !m.factice)).filter((m) =>
		inLeadScope(m.id)
	);

	// Un admin, ou une personne avec la capacité canViewImputations, peut consulter l'imputation
	// d'un autre membre via ?u=<userId> — en lecture seule sauf pour l'admin (cf. resolveSubjectId).
	const uParam = url.searchParams.get('u');
	const viewingTeam = canViewOthers && uParam === 'team';
	let viewedId = user.id;
	let viewedName = user.displayName;
	if (canViewOthers && uParam && uParam !== user.id && uParam !== 'team') {
		const m = visibleMembers.find((x) => x.id === uParam);
		if (m) {
			viewedId = m.id;
			viewedName = m.displayName;
		}
	}
	const viewingOther = !viewingTeam && viewedId !== user.id;
	const readOnly = viewingOther && !isAdmin;

	const [sheet, tickets, membership, recentTicketIds, weeklyObjectives, vacations, periodAbsences, team, pinnedRows] =
		await Promise.all([
			getTimesheet(ws.workspaceId, viewedId, period.days),
			listTicketSummaries(ws.workspaceId),
			getMembership(ws.workspaceId, viewedId),
			getRecentTicketIds(ws.workspaceId, viewedId),
			listObjectivesForUserWeeks(ws.workspaceId, viewedId, weekMondays),
			vacationWeeks(ws.workspaceId, viewedId, weekMondays),
			listAbsencesForRange(ws.workspaceId, period.firstDay, period.lastDay),
			viewingTeam ? getTeamTimesheet(ws.workspaceId, period.days) : Promise.resolve(null),
			listPinnedRows(ws.workspaceId, viewedId, period.firstDay, period.lastDay)
		]);
	// Congés/formation/hors-projet du membre affiché sur la période — remonté depuis la page Absences
	// pour voir d'un coup d'œil, sans y aller, pourquoi une case n'a pas d'imputation attendue.
	const absences = buildAbsenceGrid(
		periodAbsences.filter((a) => a.subjectId === viewedId),
		period.days
	)[viewedId] ?? {};

	// getTeamTimesheet construit ses lignes depuis les imputations elles-mêmes (pas depuis
	// membership), donc un membre factice y apparaît dès qu'il a des heures saisies — sans lien avec
	// `factice` dans son type. On retire juste les lignes concernées pour un non-admin, sans toucher
	// aux totaux (mêmes heures réelles, juste la ventilation par personne qui reste masquée).
	const facticeIds = isAdmin ? null : new Set(ref.members.filter((m) => m.factice).map((m) => m.id));
	const visibleTeam =
		team && (facticeIds || leadCollaboratorIds)
			? {
					...team,
					members: team.members.filter(
						(m) => !facticeIds?.has(m.userId) && inLeadScope(m.userId)
					)
				}
			: team;

	return {
		sheet,
		period,
		activities: ref.activities,
		categories: ref.categories,
		versions: ref.versions,
		ssps: ref.ssps,
		// Nécessaires pour la modal d'édition de ticket (même modal que Tickets & chiffrage,
		// cf. TicketEditModal.svelte) : `ref` est déjà chargé ci-dessus, ceci n'ajoute aucune requête.
		states: ref.states,
		// Sert à savoir s'il y a plusieurs périmètres à distinguer (pastilles, sections, filtre de
		// la palette d'ajout) — dans un espace mono-périmètre l'écran ne change pas.
		perimeters: ref.perimeters,
		projects: ref.projects,
		sprints: ref.sprints,
		ticketGroups: ref.ticketGroups,
		// "Assigné à" (TicketEditModal) : ouvert à tout membre, pas gaté par canViewOthers comme
		// `members` ci-dessous (qui sert à un autre usage) — même règle que Tickets & chiffrage.
		assignableMembers: ref.members.filter((m) => !m.factice),
		testPhase: ws.testPhase,
		// Sert au message du cadenas sur une ligne issue d'un objectif (cf. imputation/+page.svelte) —
		// seuls manager/admin peuvent retirer un objectif depuis /admin/objectifs, un simple membre doit
		// leur demander plutôt que de tenter de le faire lui-même.
		canManageObjectives: isManagerOrAdmin(locals.role),
		tickets,
		recentTicketIds,
		pinnedRows,
		weeklyObjectives,
		vacationWeeks: vacations,
		absences,
		capacity: num(membership?.capacityPerDay ?? '1'),
		imputationStep: num(ws.imputationStep),
		isAdmin,
		// Édition clé / suppression de ticket (TicketEditModal) : créateur de l'espace (super admin) ou ADMIN.
		isOwner: user.id === ws.createdByUserId || isAdmin,
		canViewOthers,
		members: canViewOthers ? visibleMembers : [],
		selfId: user.id,
		viewedId,
		viewedName,
		viewingOther,
		viewingTeam,
		team: visibleTeam,
		readOnly
	};
};

/**
 * Utilisateur réellement visé par l'action : soi-même par défaut, ou un membre de l'espace si on
 * est admin — jamais de confiance dans un `targetUserId` client sans revérifier le rôle ici, seul
 * point de passage commun à `setCell` et `deleteRow`.
 */
async function resolveSubjectId(
	workspaceId: string,
	selfId: string,
	role: string | null | undefined,
	targetUserId: string
): Promise<string | null> {
	if (!targetUserId || targetUserId === selfId) return selfId;
	if (role !== 'ADMIN') return null;
	const m = await getMembership(workspaceId, targetUserId);
	return m ? targetUserId : null;
}

export const actions: Actions = {
	setCell: async ({ request, locals }) => {
		const ws = locals.workspace;
		if (!ws || !locals.user) return fail(401, { error: 'Non authentifié.' });
		const f = await request.formData();
		const targetType = String(f.get('targetType')) as 'TICKET' | 'CATEGORY' | 'OBJECTIVE';
		const targetId = String(f.get('targetId'));
		const activityId = (f.get('activityId') as string) || null;
		const day = String(f.get('day'));
		const amount = Number(f.get('amount'));
		// Objectif TICKET source de la ligne (distingue deux objectifs sur le même ticket) — n'a de sens
		// que pour targetType==='TICKET', ignoré sinon.
		const objectiveId = targetType === 'TICKET' ? (f.get('objectiveId') as string) || null : null;

		if (!['TICKET', 'CATEGORY', 'OBJECTIVE'].includes(targetType) || !targetId || !day)
			return fail(400, { error: 'Données invalides.' });

		const subjectId = await resolveSubjectId(
			ws.workspaceId,
			locals.user.id,
			locals.role,
			String(f.get('targetUserId') ?? '')
		);
		if (!subjectId) return fail(403, { error: 'Accès refusé.' });

		try {
			await setCell(ws.workspaceId, subjectId, {
				targetType,
				targetId,
				activityId,
				day,
				amount: Number.isFinite(amount) ? amount : 0,
				objectiveId
			});
		} catch (e) {
			logger.error('imputation_set_cell_failed', e, { workspaceId: ws.workspaceId, subjectId, targetType, targetId, day });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	deleteRow: async ({ request, locals }) => {
		const ws = locals.workspace;
		if (!ws || !locals.user) return fail(401, { error: 'Non authentifié.' });
		const f = await request.formData();
		const targetType = String(f.get('targetType')) as 'TICKET' | 'CATEGORY' | 'OBJECTIVE';
		const targetId = String(f.get('targetId'));
		const activityId = (f.get('activityId') as string) || null;
		const anchor = String(f.get('anchor') ?? '');
		const objectiveId = targetType === 'TICKET' ? (f.get('objectiveId') as string) || null : null;

		if (!['TICKET', 'CATEGORY', 'OBJECTIVE'].includes(targetType) || !targetId || !anchor)
			return fail(400, { error: 'Données invalides.' });

		const subjectId = await resolveSubjectId(
			ws.workspaceId,
			locals.user.id,
			locals.role,
			String(f.get('targetUserId') ?? '')
		);
		if (!subjectId) return fail(403, { error: 'Accès refusé.' });

		// La plage supprimée est recalculée ici : `fetch('?/deleteRow')` perd la query string, et
		// accepter des bornes brutes du client laisserait effacer une période arbitraire.
		const period = buildPeriod(
			parseGranularity(f.get('g') as string) ?? 'WEEK',
			parsePeriodMode(f.get('mode') as string) ?? 'FIXED',
			anchor
		);

		try {
			await deleteRow(ws.workspaceId, subjectId, {
				targetType,
				targetId,
				activityId,
				fromISO: period.firstDay,
				toISO: period.lastDay,
				objectiveId
			});
		} catch (e) {
			logger.error('imputation_delete_row_failed', e, { workspaceId: ws.workspaceId, subjectId, targetType, targetId });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	pinRow: async ({ request, locals }) => {
		const ws = locals.workspace;
		if (!ws || !locals.user) return fail(401, { error: 'Non authentifié.' });
		const f = await request.formData();
		const targetType = String(f.get('targetType')) as 'TICKET' | 'CATEGORY' | 'OBJECTIVE';
		const targetId = String(f.get('targetId'));
		const activityId = (f.get('activityId') as string) || null;
		const anchor = String(f.get('anchor') ?? '');
		const objectiveId = targetType === 'TICKET' ? (f.get('objectiveId') as string) || null : null;

		if (!['TICKET', 'CATEGORY', 'OBJECTIVE'].includes(targetType) || !targetId || !anchor)
			return fail(400, { error: 'Données invalides.' });

		const subjectId = await resolveSubjectId(
			ws.workspaceId,
			locals.user.id,
			locals.role,
			String(f.get('targetUserId') ?? '')
		);
		if (!subjectId) return fail(403, { error: 'Accès refusé.' });

		// Même reconstruction serveur de la période que deleteRow/reassignActivity : c'est elle qui
		// scope l'épingle (cf. pinRow) à la période affichée au clic sur "+ Ajouter".
		const period = buildPeriod(
			parseGranularity(f.get('g') as string) ?? 'WEEK',
			parsePeriodMode(f.get('mode') as string) ?? 'FIXED',
			anchor
		);

		try {
			await pinRow(ws.workspaceId, subjectId, {
				targetType,
				targetId,
				activityId,
				firstDay: period.firstDay,
				lastDay: period.lastDay,
				objectiveId
			});
		} catch (e) {
			logger.error('imputation_pin_row_failed', e, { workspaceId: ws.workspaceId, subjectId, targetType, targetId });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	reassignActivity: async ({ request, locals }) => {
		const ws = locals.workspace;
		if (!ws || !locals.user) return fail(401, { error: 'Non authentifié.' });
		const f = await request.formData();
		const targetType = String(f.get('targetType')) as 'TICKET' | 'CATEGORY' | 'OBJECTIVE';
		const targetId = String(f.get('targetId'));
		const fromActivityId = (f.get('fromActivityId') as string) || null;
		const toActivityId = (f.get('toActivityId') as string) || null;
		const anchor = String(f.get('anchor') ?? '');
		const objectiveId = targetType === 'TICKET' ? (f.get('objectiveId') as string) || null : null;

		if (!['TICKET', 'CATEGORY', 'OBJECTIVE'].includes(targetType) || !targetId || !anchor)
			return fail(400, { error: 'Données invalides.' });

		const subjectId = await resolveSubjectId(
			ws.workspaceId,
			locals.user.id,
			locals.role,
			String(f.get('targetUserId') ?? '')
		);
		if (!subjectId) return fail(403, { error: 'Accès refusé.' });

		// Mêmes bornes de période reconstruites côté serveur que deleteRow — jamais reçues du client.
		const period = buildPeriod(
			parseGranularity(f.get('g') as string) ?? 'WEEK',
			parsePeriodMode(f.get('mode') as string) ?? 'FIXED',
			anchor
		);

		try {
			await reassignActivity(ws.workspaceId, subjectId, {
				targetType,
				targetId,
				fromActivityId,
				toActivityId,
				fromISO: period.firstDay,
				toISO: period.lastDay,
				objectiveId
			});
		} catch (e) {
			logger.error('imputation_reassign_activity_failed', e, {
				workspaceId: ws.workspaceId,
				subjectId,
				targetType,
				targetId,
				fromActivityId,
				toActivityId
			});
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	}
};
