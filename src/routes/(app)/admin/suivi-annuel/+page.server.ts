import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getAnnualTrackingView, setProd, setRaeOverride, advanceCursor } from '$lib/server/services/sspAnnualTracking';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.role !== 'ADMIN') redirect(303, '/imputation');
	const view = await getAnnualTrackingView(locals.workspace!.workspaceId);
	return { view };
};

export const actions: Actions = {
	setProd: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const f = await request.formData();
		const raw = String(f.get('value') ?? '').trim();
		try {
			await setProd(
				locals.workspace!.workspaceId,
				String(f.get('sspId')),
				String(f.get('month')),
				raw === '' ? null : Number(raw)
			);
		} catch (e) {
			logger.error('suivi_annuel_set_prod_failed', e, {
				workspaceId: locals.workspace!.workspaceId,
				sspId: String(f.get('sspId')),
				month: String(f.get('month'))
			});
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	setRaeOverride: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const f = await request.formData();
		const raw = String(f.get('value') ?? '').trim();
		try {
			await setRaeOverride(
				locals.workspace!.workspaceId,
				String(f.get('sspId')),
				String(f.get('month')),
				raw === '' ? null : Number(raw)
			);
		} catch (e) {
			logger.error('suivi_annuel_set_rae_override_failed', e, {
				workspaceId: locals.workspace!.workspaceId,
				sspId: String(f.get('sspId')),
				month: String(f.get('month'))
			});
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	nextMonth: async ({ locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		await advanceCursor(locals.workspace!.workspaceId);
		redirect(303, '/admin/suivi-annuel');
	}
};
