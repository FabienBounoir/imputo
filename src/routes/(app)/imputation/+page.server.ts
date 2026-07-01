import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getWeek, setCell } from '$lib/server/services/imputation';
import { getRefData, listTickets } from '$lib/server/services/tickets';
import { getMembership } from '$lib/server/services/workspaces';
import { num } from '$lib/server/services/calc';
import { mondayOf, parseISODate, toISODate, isoWeek, formatRange, addDays } from '$lib/utils/date';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!;
	const ws = locals.workspace;
	if (!ws) redirect(303, '/register');
	const isAdmin = locals.role === 'ADMIN';

	const wParam = url.searchParams.get('w');
	const monday = wParam ? mondayOf(parseISODate(wParam)) : mondayOf(new Date());
	const mondayISO = toISODate(monday);

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

	const [week, tickets, membership] = await Promise.all([
		getWeek(ws.workspaceId, viewedId, mondayISO),
		listTickets(ws.workspaceId),
		getMembership(ws.workspaceId, viewedId)
	]);

	return {
		week,
		activities: ref.activities,
		categories: ref.categories,
		tickets: tickets.map((t) => ({ id: t.id, key: t.key, title: t.title })),
		capacity: num(membership?.capacityPerDay ?? '1'),
		weekNumber: isoWeek(monday),
		weekLabel: formatRange(monday),
		prevWeek: toISODate(addDays(monday, -7)),
		nextWeek: toISODate(addDays(monday, 7)),
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
		const targetType = String(f.get('targetType')) as 'TICKET' | 'CATEGORY';
		const targetId = String(f.get('targetId'));
		const activityId = (f.get('activityId') as string) || null;
		const day = String(f.get('day'));
		const amount = Number(f.get('amount'));

		if (!['TICKET', 'CATEGORY'].includes(targetType) || !targetId || !day)
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
	}
};
