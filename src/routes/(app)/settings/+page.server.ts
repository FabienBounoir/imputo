import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db, user } from '$lib/server/db';
import { config } from '$lib/server/config';
import { parseNotifPrefs } from '$lib/server/services/notifications';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const [u] = await db
		.select({ notifPrefs: user.notifPrefs })
		.from(user)
		.where(eq(user.id, locals.user.id));
	return {
		vapidConfigured: Boolean(config.vapidPublic),
		vapidPublicKey: config.vapidPublic,
		prefs: parseNotifPrefs(u?.notifPrefs ?? null)
	};
};
