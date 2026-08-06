import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getRefData } from '$lib/server/services/tickets';
import { isManagerOrAdmin } from '$lib/server/services/workspaces';
import {
	listAbsencesForUser,
	listAbsencesForRange,
	createAbsenceFor,
	deleteAbsence,
	buildAbsenceGrid,
	listExternalMembers,
	addExternalMember,
	archiveExternalMember,
	type AbsenceSubject
} from '$lib/server/services/absences';
import {
	ABSENCE_TYPES,
	ABSENCE_PERIODS,
	absenceRangeBounds,
	parseAbsenceSpan,
	groupDaysByMonth,
	type AbsenceType,
	type AbsencePeriod
} from '$lib/absenceTypes';
import { monthBounds, formatMonthLabel, addMonths, toISODate, parseISODate, addDays, todayInParis } from '$lib/utils/date';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!;
	const ws = locals.workspace;
	if (!ws) redirect(303, '/register');

	const span = parseAbsenceSpan(url.searchParams.get('span'));
	const anchorISO = monthBounds(url.searchParams.get('m') ?? todayInParis()).start;
	const range = absenceRangeBounds(anchorISO, span);

	const days: string[] = [];
	for (let d = parseISODate(range.start); toISODate(d) <= range.end; d = addDays(d, 1)) days.push(toISODate(d));

	// Regroupe les jours par mois pour l'en-tête de la synthèse (utile dès que la plage dépasse un mois).
	const monthGroups = groupDaysByMonth(days);

	const [ref, myAbsences, teamAbsences, externalMembers] = await Promise.all([
		getRefData(ws.workspaceId),
		listAbsencesForUser(ws.workspaceId, user.id),
		listAbsencesForRange(ws.workspaceId, range.start, range.end),
		listExternalMembers(ws.workspaceId)
	]);

	// Une seule liste pour la synthèse équipe (réels + externes) — `external` pilote la teinte de ligne.
	const rows = [
		...ref.members.map((m) => ({ id: m.id, displayName: m.displayName, external: false as const })),
		...externalMembers.map((m) => ({ id: m.id, displayName: m.displayName, external: true as const }))
	];

	return {
		rows,
		externalMembers,
		days,
		monthGroups,
		grid: buildAbsenceGrid(teamAbsences, days),
		myAbsences,
		rangeLabel: span === 1 ? formatMonthLabel(range.start) : `${formatMonthLabel(range.start)} → ${formatMonthLabel(range.end)}`,
		anchorISO,
		span,
		prevAnchor: addMonths(anchorISO, -span),
		nextAnchor: addMonths(anchorISO, span),
		todayISO: todayInParis(),
		canManageOthers: isManagerOrAdmin(locals.role)
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const ws = locals.workspace;
		if (!ws || !locals.user) return fail(401, { error: 'Non authentifié.' });
		const f = await request.formData();
		const startDate = String(f.get('startDate') ?? '');
		const endDate = String(f.get('endDate') ?? startDate);
		const type = String(f.get('type') ?? '') as AbsenceType;
		const period = (String(f.get('period') ?? 'FULL') || 'FULL') as AbsencePeriod;
		const subjectRaw = String(f.get('subject') ?? 'me');

		if (!startDate || !endDate || !ABSENCE_TYPES.includes(type) || !ABSENCE_PERIODS.includes(period))
			return fail(400, { error: 'Données invalides.' });

		// Un membre externe ne peut être ciblé que par un admin/manager — sinon on retombe sur soi-même.
		const subject: AbsenceSubject =
			subjectRaw.startsWith('ext:') && isManagerOrAdmin(locals.role)
				? { externalMemberId: subjectRaw.slice(4) }
				: { userId: locals.user.id };

		try {
			await createAbsenceFor(ws.workspaceId, subject, { startDate, endDate, type, period });
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	remove: async ({ request, locals }) => {
		const ws = locals.workspace;
		if (!ws || !locals.user) return fail(401, { error: 'Non authentifié.' });
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		if (!id) return fail(400, { error: 'Données invalides.' });
		await deleteAbsence(ws.workspaceId, locals.user.id, id, isManagerOrAdmin(locals.role));
		return { ok: true };
	},

	addExternal: async ({ request, locals }) => {
		const ws = locals.workspace;
		if (!ws || !locals.user) return fail(401, { error: 'Non authentifié.' });
		if (!isManagerOrAdmin(locals.role)) return fail(403, { error: 'Réservé aux admins.' });
		const f = await request.formData();
		try {
			await addExternalMember(ws.workspaceId, String(f.get('displayName') ?? ''));
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	removeExternal: async ({ request, locals }) => {
		const ws = locals.workspace;
		if (!ws || !locals.user) return fail(401, { error: 'Non authentifié.' });
		if (!isManagerOrAdmin(locals.role)) return fail(403, { error: 'Réservé aux admins.' });
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		if (!id) return fail(400, { error: 'Données invalides.' });
		await archiveExternalMember(ws.workspaceId, id);
		return { ok: true };
	}
};
