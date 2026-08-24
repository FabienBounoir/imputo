import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getRefData } from '$lib/server/services/tickets';
import { isManagerOrAdmin } from '$lib/server/services/workspaces';
import { notifyAbsencePending, notifyAbsenceValidated } from '$lib/server/services/notifications';
import { getSchoolHolidays } from '$lib/server/services/schoolHolidays';
import {
	listAbsencesForUser,
	listAbsencesForRange,
	listPendingAbsences,
	createAbsenceFor,
	createHalfDayRangeFor,
	deleteAbsence,
	updateAbsence,
	validateAbsence,
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

	const isAdmin = locals.role === 'ADMIN';
	const canManageOthers = isManagerOrAdmin(locals.role);
	const [ref, myAbsences, teamAbsences, externalMembers, pendingAbsences, schoolHolidays] = await Promise.all([
		getRefData(ws.workspaceId),
		listAbsencesForUser(ws.workspaceId, user.id),
		listAbsencesForRange(ws.workspaceId, range.start, range.end),
		listExternalMembers(ws.workspaceId),
		canManageOthers ? listPendingAbsences(ws.workspaceId) : Promise.resolve([]),
		getSchoolHolidays(range.start, range.end)
	]);

	// Membres "factice" (arrangements entre projets en clôture, pas de vraies personnes, cf.
	// schema.ts membership.factice) : entièrement masqués pour tout rôle non-ADMIN — `rows` alimente
	// aussi bien la grille équipe que le sélecteur "Pour qui ?", donc un seul filtre ici suffit.
	const visibleMembers = isAdmin ? ref.members : ref.members.filter((m) => !m.factice);

	// Une seule liste pour la synthèse équipe (réels + externes) — `external` pilote la teinte de ligne.
	const rows = [
		...visibleMembers.map((m) => ({ id: m.id, displayName: m.displayName, external: false as const })),
		...externalMembers.map((m) => ({ id: m.id, displayName: m.displayName, external: true as const }))
	];
	// Sa propre ligne en premier (retour utilisateur : plus facile à retrouver dans la grille équipe).
	const selfIdx = rows.findIndex((r) => r.id === user.id);
	if (selfIdx > 0) rows.unshift(...rows.splice(selfIdx, 1));

	return {
		rows,
		externalMembers,
		days,
		monthGroups,
		grid: buildAbsenceGrid(teamAbsences, days),
		schoolHolidays,
		myAbsences,
		pendingAbsences,
		rangeLabel: span === 1 ? formatMonthLabel(range.start) : `${formatMonthLabel(range.start)} → ${formatMonthLabel(range.end)}`,
		anchorISO,
		span,
		prevAnchor: addMonths(anchorISO, -span),
		nextAnchor: addMonths(anchorISO, span),
		todayISO: todayInParis(),
		canManageOthers,
		selfId: user.id,
		// Arrivée depuis "Mon imputation" (clic sur une case verrouillée par une absence, cf.
		// ?highlight= sur imputation/+page.svelte) : id à surligner dans "Mes absences".
		highlightId: url.searchParams.get('highlight') ?? undefined
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
		// Un congé ne se déclare qu'en prévisionnel ; seul un admin/manager peut le valider (action `validate`).
		if (type === 'CONGE_VALIDE' && !isManagerOrAdmin(locals.role)) return fail(403, { error: 'Réservé aux admins/managers.' });

		// Un autre membre (interne ou externe) ne peut être ciblé que par un admin/manager — sinon on retombe sur soi-même.
		const subject: AbsenceSubject = !isManagerOrAdmin(locals.role)
			? { userId: locals.user.id }
			: subjectRaw.startsWith('ext:')
				? { externalMemberId: subjectRaw.slice(4) }
				: subjectRaw.startsWith('user:')
					? { userId: subjectRaw.slice(5) }
					: { userId: locals.user.id };

		try {
			// Demi-journée sur plusieurs jours (retour utilisateur : "faut faire 1/1" sinon) — une ligne
			// par jour, période conservée sur chacune, le tout dans une seule transaction (cf.
			// createHalfDayRangeFor : createAbsenceFor forcerait sinon FULL sur toute la plage, la
			// demi-journée n'ayant de sens que pour un seul jour).
			const absenceId =
				period !== 'FULL' && startDate !== endDate
					? (await createHalfDayRangeFor(ws.workspaceId, subject, { startDate, endDate, type, period }))[0]
					: await createAbsenceFor(ws.workspaceId, subject, { startDate, endDate, type, period });
			// Prévisionnel = en attente de validation : les admins doivent en être notifiés pour aller le traiter.
			if (type === 'CONGE_PREVISIONNEL') {
				await notifyAbsencePending(
					ws.workspaceId,
					ws.workspaceName,
					locals.user.id,
					locals.user.displayName,
					startDate,
					endDate,
					absenceId
				);
			}
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	update: async ({ request, locals }) => {
		const ws = locals.workspace;
		if (!ws || !locals.user) return fail(401, { error: 'Non authentifié.' });
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		const startDate = String(f.get('startDate') ?? '');
		const endDate = String(f.get('endDate') ?? startDate);
		const type = String(f.get('type') ?? '') as AbsenceType;
		const period = (String(f.get('period') ?? 'FULL') || 'FULL') as AbsencePeriod;

		if (!id || !startDate || !endDate || !ABSENCE_TYPES.includes(type) || !ABSENCE_PERIODS.includes(period))
			return fail(400, { error: 'Données invalides.' });
		if (type === 'CONGE_VALIDE' && !isManagerOrAdmin(locals.role)) return fail(403, { error: 'Réservé aux admins/managers.' });

		try {
			await updateAbsence(ws.workspaceId, locals.user.id, isManagerOrAdmin(locals.role), id, { startDate, endDate, type, period });
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	/** Valide un congé prévisionnel — réservé admin/manager. */
	validate: async ({ request, locals }) => {
		const ws = locals.workspace;
		if (!ws || !locals.user) return fail(401, { error: 'Non authentifié.' });
		if (!isManagerOrAdmin(locals.role)) return fail(403, { error: 'Réservé aux admins/managers.' });
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		if (!id) return fail(400, { error: 'Données invalides.' });
		try {
			const validated = await validateAbsence(ws.workspaceId, id, locals.user.id);
			// Membre externe : personne à notifier (pas de compte réel).
			if (validated.userId) {
				await notifyAbsenceValidated(ws.workspaceId, ws.workspaceName, validated.userId, validated.startDate, validated.endDate, id);
			}
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
