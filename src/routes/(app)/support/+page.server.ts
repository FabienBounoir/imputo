import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getCurrentDuty,
	listDutyCalendar,
	listRotationMembers,
	setOverride,
	clearOverride,
	skipCurrentTurn
} from '$lib/server/services/support';
import { notifySupportDutyChanged } from '$lib/server/services/notifications';
import { listOwnTimeEntries, updateTimeEntry } from '$lib/server/services/supportTime';
import { parseDuration } from '$lib/supportDuration';
import { todayInParis } from '$lib/utils/date';

const CALENDAR_WEEKS = 6;

export const load: PageServerLoad = async ({ locals }) => {
	const ws = locals.workspace!;
	// Deux fonctionnalités indépendantes sur cette page (rotation / temps support) : n'y rediriger
	// que si aucune des deux n'est activée, sinon un espace avec juste le suivi du temps perdrait
	// tout accès à son historique.
	if (!ws.supportEnabled && !ws.supportTimeTrackingEnabled) redirect(303, '/imputation');

	const canManage = locals.role === 'ADMIN' || locals.role === 'MANAGER';
	const isAdmin = locals.role === 'ADMIN';
	const [current, calendar, members, ownTimeEntries] = await Promise.all([
		ws.supportEnabled ? getCurrentDuty(ws.workspaceId) : Promise.resolve(null),
		ws.supportEnabled ? listDutyCalendar(ws.workspaceId, CALENDAR_WEEKS) : Promise.resolve([]),
		ws.supportEnabled && canManage ? listRotationMembers(ws.workspaceId) : Promise.resolve([]),
		ws.supportTimeTrackingEnabled ? listOwnTimeEntries(ws.workspaceId, locals.user!.id, 20) : Promise.resolve([])
	]);

	return {
		current,
		calendar,
		members,
		canManage,
		todayISO: todayInParis(),
		timeTrackingEnabled: ws.supportTimeTrackingEnabled,
		ownTimeEntries,
		// L'historique complet (toutes périodes, filtrable, stats) vit sur sa propre page
		// /support/historique — juste un bouton d'accès ici, pas de données à charger pour ça.
		canViewHistory: isAdmin && ws.supportTimeTrackingEnabled
	};
};

export const actions: Actions = {
	override: async ({ request, locals }) => {
		const ws = locals.workspace!;
		if (locals.role !== 'ADMIN' && locals.role !== 'MANAGER') return fail(403, { error: 'Réservé aux admins/managers.' });
		const f = await request.formData();
		const periodStart = String(f.get('periodStart') ?? '');
		const userId = String(f.get('userId') ?? '');
		try {
			await setOverride(ws.workspaceId, periodStart, userId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		await notifySupportDutyChanged(ws.workspaceId, ws.workspaceName, periodStart);
		return { ok: true };
	},

	clearOverride: async ({ request, locals }) => {
		const ws = locals.workspace!;
		if (locals.role !== 'ADMIN' && locals.role !== 'MANAGER') return fail(403, { error: 'Réservé aux admins/managers.' });
		const periodStart = String((await request.formData()).get('periodStart') ?? '');
		await clearOverride(ws.workspaceId, periodStart);
		await notifySupportDutyChanged(ws.workspaceId, ws.workspaceName, periodStart);
		return { ok: true };
	},

	skip: async ({ request, locals }) => {
		const ws = locals.workspace!;
		if (locals.role !== 'ADMIN' && locals.role !== 'MANAGER') return fail(403, { error: 'Réservé aux admins/managers.' });
		const periodStart = String((await request.formData()).get('periodStart') ?? '');
		await skipCurrentTurn(ws.workspaceId, periodStart);
		await notifySupportDutyChanged(ws.workspaceId, ws.workspaceName, periodStart);
		return { ok: true };
	},

	/** Corrige une saisie de temps — la sienne uniquement, même pour un admin (cf. supportTime.ts). */
	editTimeEntry: async ({ request, locals }) => {
		const ws = locals.workspace!;
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		const ticketRef = String(f.get('ticketRef') ?? '');
		const durationRaw = String(f.get('duration') ?? '');
		const day = String(f.get('day') ?? '');
		const minutes = parseDuration(durationRaw);
		if (minutes === null || minutes <= 0)
			return fail(400, { timeError: 'Durée invalide — ex. 1h, 45m, 1h30m, 2 (= 2h).' });
		try {
			await updateTimeEntry(ws.workspaceId, locals.user!.id, id, { ticketRef, minutes, day });
		} catch (e) {
			return fail(400, { timeError: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { timeOk: true };
	}
};
