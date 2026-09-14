import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { db, user } from '$lib/server/db';
import { config } from '$lib/server/config';
import { logger } from '$lib/server/logger';
import { parseNotifPrefs } from '$lib/server/services/notifications';
import {
	setAccentPref,
	setSortActivitiesAlphaPref,
	setRememberTicketFiltersPref,
	setRememberTicketSearchPref,
	setCompactTicketActivityPref,
	setMotivationBannerPref,
	changePassword
} from '$lib/server/services/accounts';
import { changePasswordSchema } from '$lib/server/validation/auth';
import { BADGES, BADGE_HOW, nextStep } from '$lib/badges';
import { computeAll, markSeen } from '$lib/server/services/badges';

const accentPrefSchema = z.object({
	mode: z.enum(['WORKSPACE', 'CUSTOM', 'RGB', 'DISCO']),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur invalide (hex)')
});

// Forme envoyée à la page. Déclarée ici parce que `badges` est construit dans un try/catch et doit
// être typé avant d'être rempli — l'inférence ne suffit plus une fois la valeur initialisée à [].
type BadgeView = {
	id: string;
	name: string;
	unit: string;
	/** Comment le décrocher — affiché même (surtout) quand le badge est encore verrouillé. */
	how: string;
	thresholds: readonly number[];
	tierNames: readonly string[];
	value: number;
	tier: number;
	/** Date du dernier palier franchi — affichée sur la fiche du badge. */
	tierAt: Date | null;
	next: ReturnType<typeof nextStep>;
	toAnnounce: boolean;
};

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const [u] = await db
		.select({
			notifPrefs: user.notifPrefs,
			rememberTicketFilters: user.rememberTicketFilters,
			rememberTicketSearch: user.rememberTicketSearch,
			compactTicketActivity: user.compactTicketActivity
		})
		.from(user)
		.where(eq(user.id, locals.user.id));
	// Recalcul à chaque ouverture des réglages : les compteurs se déduisent de l'historique, il n'y a
	// donc rien à maintenir ailleurs (pas de hook à poser sur chaque écriture d'imputation).
	//
	// Isolé dans un try/catch, et sauté sans espace actif : les badges sont décoratifs, ils n'ont
	// aucune raison d'emporter TOUTE la page Réglages — sans ça, un compteur qui plante coupe aussi
	// l'accès aux notifications, au thème et au changement de mot de passe. L'onglet s'affiche alors
	// vide plutôt que de rendre la page inaccessible.
	let badges: BadgeView[] = [];
	try {
		if (locals.workspace) {
			const states = await computeAll(locals.workspace.workspaceId, locals.user.id, locals.role === 'ADMIN');
			const byId = new Map(states.map((s) => [s.badgeId, s]));
			badges = BADGES.filter((b) => !b.adminOnly || locals.role === 'ADMIN').flatMap((b) => {
				const s = byId.get(b.id);
				if (!s) return [];
				return [
					{
						id: b.id,
						name: b.name,
						unit: b.unit,
						how: BADGE_HOW[b.id] ?? '',
						thresholds: b.thresholds,
						tierNames: b.tierNames,
						value: s.value,
						tier: s.tier,
						tierAt: s.tierAt,
						next: nextStep(s.value, b.thresholds),
						// Palier gagné mais jamais montré : c'est lui qui déclenche l'animation à l'ouverture.
						toAnnounce: s.tier > s.seenTier
					}
				];
			});
		}
	} catch (err) {
		logger.error('badges_compute_failed', err, { userId: locals.user.id });
	}

	return {
		badges,
		vapidConfigured: Boolean(config.vapidPublic),
		vapidPublicKey: config.vapidPublic,
		prefs: parseNotifPrefs(u?.notifPrefs ?? null),
		accentMode: locals.user.accentMode,
		accentColor: locals.user.accentColor,
		sortActivitiesAlpha: locals.user.sortActivitiesAlpha,
		rememberTicketFilters: u?.rememberTicketFilters ?? true,
		rememberTicketSearch: u?.rememberTicketSearch ?? true,
		compactTicketActivity: u?.compactTicketActivity ?? true,
		motivationBanner: locals.user.motivationBanner,
		role: locals.role
	};
};

export const actions: Actions = {
	accentPref: async ({ request, locals }) => {
		if (!locals.user) return fail(401);
		const parsed = accentPrefSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		await setAccentPref(locals.user.id, parsed.data.mode, parsed.data.color);
		return { accentPrefOk: true };
	},

	sortActivitiesAlphaPref: async ({ request, locals }) => {
		if (!locals.user) return fail(401);
		const f = await request.formData();
		await setSortActivitiesAlphaPref(locals.user.id, f.get('value') === 'true');
		return { sortActivitiesAlphaOk: true };
	},

	rememberTicketFiltersPref: async ({ request, locals }) => {
		if (!locals.user) return fail(401);
		const f = await request.formData();
		await setRememberTicketFiltersPref(locals.user.id, f.get('value') === 'true');
		return { rememberTicketFiltersOk: true };
	},

	rememberTicketSearchPref: async ({ request, locals }) => {
		if (!locals.user) return fail(401);
		const f = await request.formData();
		await setRememberTicketSearchPref(locals.user.id, f.get('value') === 'true');
		return { rememberTicketSearchOk: true };
	},

	compactActivityPref: async ({ request, locals }) => {
		if (!locals.user) return fail(401);
		const f = await request.formData();
		await setCompactTicketActivityPref(locals.user.id, f.get('value') === 'true');
		return { compactActivityOk: true };
	},

	motivationBannerPref: async ({ request, locals }) => {
		if (!locals.user) return fail(401);
		const f = await request.formData();
		await setMotivationBannerPref(locals.user.id, f.get('value') === 'true');
		return { motivationBannerOk: true };
	},

	// Appelée une fois l'animation jouée : sans ça, elle rejouerait à chaque ouverture des réglages.
	seenBadges: async ({ request, locals }) => {
		if (!locals.user) return fail(401);
		const f = await request.formData();
		const ids = f.getAll('badgeId').map(String).filter(Boolean);
		await markSeen(locals.workspace!.workspaceId, locals.user.id, ids);
		return { badgesSeen: true };
	},

	changePassword: async ({ request, locals }) => {
		if (!locals.user) return fail(401);
		const parsed = changePasswordSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { pwError: parsed.error.issues[0].message });
		const ok = await changePassword(locals.user.id, parsed.data.currentPassword, parsed.data.password);
		if (!ok) return fail(400, { pwError: 'Mot de passe actuel incorrect.' });
		return { pwOk: true };
	}
};
