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
import { todayInParis } from '$lib/utils/date';
import { logger } from '$lib/server/logger';

const CALENDAR_WEEKS = 6;

export const load: PageServerLoad = async ({ locals }) => {
	const ws = locals.workspace!;
	if (!ws.supportEnabled) redirect(303, '/imputation');

	const canManage = locals.role === 'ADMIN' || locals.role === 'MANAGER';
	const [current, calendar, members] = await Promise.all([
		getCurrentDuty(ws.workspaceId),
		listDutyCalendar(ws.workspaceId, CALENDAR_WEEKS),
		canManage ? listRotationMembers(ws.workspaceId) : Promise.resolve([])
	]);

	return { current, calendar, members, canManage, todayISO: todayInParis() };
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
			logger.error('support_override_failed', e, { workspaceId: ws.workspaceId, periodStart, userId });
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
	}
};
