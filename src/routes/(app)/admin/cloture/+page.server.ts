import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { logger } from '$lib/server/logger';
import {
	getClosingView,
	openClosing,
	setComplement,
	setPlanned,
	setWorkdays,
	addClosingSsp,
	removeClosingSsp,
	integrate
} from '$lib/server/services/monthlyClosing';
import { monthOptions } from '$lib/utils/date';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.role !== 'ADMIN') redirect(303, '/imputation');
	const ws = locals.workspace!;
	const months = monthOptions(new Date());
	const param = url.searchParams.get('month');
	// Défaut = mois courant : la clôture se prépare pendant le mois, pas après.
	const month = months.some((o) => o.value === param) ? param! : months[0].value;
	const seqParam = Number(url.searchParams.get('seq'));
	const view = await getClosingView(
		ws.workspaceId,
		month,
		Number.isInteger(seqParam) && seqParam > 0 ? seqParam : undefined
	);
	return { view, months };
};

export const actions: Actions = {
	open: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const f = await request.formData();
		const month = String(f.get('month'));
		try {
			await openClosing(locals.workspace!.workspaceId, month);
		} catch (e) {
			logger.error('cloture_open_failed', e, { workspaceId: locals.workspace!.workspaceId, month });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		// Redirection (et pas un simple retour) pour deux raisons : sans `seq` dans l'URL le load
		// sélectionne la passe ouverte, donc on atterrit sur celle qu'on vient de créer au lieu de
		// rester sur l'ancienne ; et un POST natif (page pas encore hydratée) atterrit sur
		// `?/open`, ce qui perdrait le mois affiché. Hors du try : redirect() lève.
		redirect(303, `/admin/cloture?month=${month}`);
	},

	setComplement: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const f = await request.formData();
		try {
			await setComplement(
				locals.workspace!.workspaceId,
				String(f.get('closingId')),
				String(f.get('userId')),
				String(f.get('sspId')),
				Number(f.get('amount'))
			);
		} catch (e) {
			logger.error('cloture_set_complement_failed', e, {
				workspaceId: locals.workspace!.workspaceId,
				closingId: String(f.get('closingId'))
			});
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	setPlanned: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const f = await request.formData();
		const raw = String(f.get('value') ?? '').trim();
		try {
			await setPlanned(
				locals.workspace!.workspaceId,
				String(f.get('closingId')),
				String(f.get('userId')),
				// Champ vidé = retour au calcul automatique, pas un prévu à zéro.
				raw === '' ? null : Number(raw)
			);
		} catch (e) {
			logger.error('cloture_set_planned_failed', e, {
				workspaceId: locals.workspace!.workspaceId,
				closingId: String(f.get('closingId'))
			});
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	setWorkdays: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const f = await request.formData();
		const raw = String(f.get('value') ?? '').trim();
		try {
			await setWorkdays(
				locals.workspace!.workspaceId,
				String(f.get('closingId')),
				// Champ vidé = retour au calcul automatique, pas zéro jour ouvré.
				raw === '' ? null : Number(raw)
			);
		} catch (e) {
			logger.error('cloture_set_workdays_failed', e, {
				workspaceId: locals.workspace!.workspaceId,
				closingId: String(f.get('closingId'))
			});
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	addSsp: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const f = await request.formData();
		try {
			await addClosingSsp(
				locals.workspace!.workspaceId,
				String(f.get('closingId')),
				String(f.get('sspId'))
			);
		} catch (e) {
			logger.error('cloture_add_ssp_failed', e, {
				workspaceId: locals.workspace!.workspaceId,
				closingId: String(f.get('closingId'))
			});
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	removeSsp: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const f = await request.formData();
		try {
			await removeClosingSsp(
				locals.workspace!.workspaceId,
				String(f.get('closingId')),
				String(f.get('sspId'))
			);
		} catch (e) {
			logger.error('cloture_remove_ssp_failed', e, {
				workspaceId: locals.workspace!.workspaceId,
				closingId: String(f.get('closingId'))
			});
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	integrate: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const f = await request.formData();
		const month = String(f.get('month'));
		const closingId = String(f.get('closingId'));
		try {
			await integrate(locals.workspace!.workspaceId, closingId, locals.user!.id);
		} catch (e) {
			logger.error('cloture_integrate_failed', e, { workspaceId: locals.workspace!.workspaceId, closingId, month });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		logger.info('cloture_integrated', { workspaceId: locals.workspace!.workspaceId, closingId, month, byUserId: locals.user!.id });
		// Plus aucune passe ouverte après l'intégration : sans `seq`, le load retombe sur la plus
		// récente, celle qu'on vient de figer. Même motif que `open` ci-dessus.
		redirect(303, `/admin/cloture?month=${month}`);
	}
};
