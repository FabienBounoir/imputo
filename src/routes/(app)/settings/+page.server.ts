import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { db, user } from '$lib/server/db';
import { config } from '$lib/server/config';
import { parseNotifPrefs } from '$lib/server/services/notifications';
import { setAccentPref } from '$lib/server/services/accounts';

const accentPrefSchema = z.object({
	mode: z.enum(['WORKSPACE', 'CUSTOM', 'RGB']),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur invalide (hex)')
});

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const [u] = await db
		.select({ notifPrefs: user.notifPrefs })
		.from(user)
		.where(eq(user.id, locals.user.id));
	return {
		vapidConfigured: Boolean(config.vapidPublic),
		vapidPublicKey: config.vapidPublic,
		prefs: parseNotifPrefs(u?.notifPrefs ?? null),
		accentMode: locals.user.accentMode,
		accentColor: locals.user.accentColor
	};
};

export const actions: Actions = {
	accentPref: async ({ request, locals }) => {
		if (!locals.user) return fail(401);
		const parsed = accentPrefSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		await setAccentPref(locals.user.id, parsed.data.mode, parsed.data.color);
		return { accentPrefOk: true };
	}
};
