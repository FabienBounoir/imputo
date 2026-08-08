import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getTimesheet, setCell, deleteRow, getRecentTicketIds } from '$lib/server/services/imputation';
import { getRefData, listTickets } from '$lib/server/services/tickets';
import { getMembership } from '$lib/server/services/workspaces';
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

	const ref = await getRefData(ws.workspaceId);

	// Un admin peut consulter l'imputation d'un autre membre via ?u=<userId>.
	const uParam = url.searchParams.get('u');
	let viewedId = user.id;
	let viewedName = user.displayName;
	if (isAdmin && uParam && uParam !== user.id) {
		const m = ref.members.find((x) => x.id === uParam);
		if (m) {
			viewedId = m.id;
			viewedName = m.displayName;
		}
	}
	const readOnly = viewedId !== user.id;

	const [sheet, tickets, membership, recentTicketIds, weeklyObjectives, vacations, periodAbsences] = await Promise.all([
		getTimesheet(ws.workspaceId, viewedId, period.days),
		listTickets(ws.workspaceId),
		getMembership(ws.workspaceId, viewedId),
		getRecentTicketIds(ws.workspaceId, viewedId),
		listObjectivesForUserWeeks(ws.workspaceId, viewedId, weekMondays),
		vacationWeeks(ws.workspaceId, viewedId, weekMondays),
		listAbsencesForRange(ws.workspaceId, period.firstDay, period.lastDay)
	]);
	// Congés/formation/hors-projet du membre affiché sur la période — remonté depuis la page Absences
	// pour voir d'un coup d'œil, sans y aller, pourquoi une case n'a pas d'imputation attendue.
	const absences = buildAbsenceGrid(
		periodAbsences.filter((a) => a.subjectId === viewedId),
		period.days
	)[viewedId] ?? {};

	return {
		sheet,
		period,
		activities: ref.activities,
		categories: ref.categories,
		versions: ref.versions,
		tickets: tickets.map((t) => ({
			id: t.id,
			key: t.key,
			title: t.title,
			sprintId: t.sprintId,
			versionId: t.versionId,
			sprintName: t.sprintName
		})),
		recentTicketIds,
		weeklyObjectives,
		vacationWeeks: vacations,
		absences,
		capacity: num(membership?.capacityPerDay ?? '1'),
		imputationStep: num(ws.imputationStep),
		isAdmin,
		members: isAdmin ? ref.members : [],
		selfId: user.id,
		viewedId,
		viewedName,
		readOnly
	};
};

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

		if (!['TICKET', 'CATEGORY', 'OBJECTIVE'].includes(targetType) || !targetId || !day)
			return fail(400, { error: 'Données invalides.' });

		try {
			await setCell(ws.workspaceId, locals.user.id, {
				targetType,
				targetId,
				activityId,
				day,
				amount: Number.isFinite(amount) ? amount : 0
			});
		} catch (e) {
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

		if (!['TICKET', 'CATEGORY', 'OBJECTIVE'].includes(targetType) || !targetId || !anchor)
			return fail(400, { error: 'Données invalides.' });

		// La plage supprimée est recalculée ici : `fetch('?/deleteRow')` perd la query string, et
		// accepter des bornes brutes du client laisserait effacer une période arbitraire.
		const period = buildPeriod(
			parseGranularity(f.get('g') as string) ?? 'WEEK',
			parsePeriodMode(f.get('mode') as string) ?? 'FIXED',
			anchor
		);

		try {
			await deleteRow(ws.workspaceId, locals.user.id, {
				targetType,
				targetId,
				activityId,
				fromISO: period.firstDay,
				toISO: period.lastDay
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	}
};
