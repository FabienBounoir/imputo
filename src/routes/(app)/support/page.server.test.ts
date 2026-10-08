import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { load as loadUntyped } from './+page.server';
// Même retypage que dashboard/sprint/page.server.test.ts : load renvoie toujours des données ici.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { db, workspace } from '$lib/server/db';
import { makeWorkspace } from '$lib/server/services/test-helpers';
import { fakeLocals } from '$lib/server/test-helpers/http';
import { createTimeEntry } from '$lib/server/services/supportTime';
import { lastWorkdayOnOrBefore, previousWorkday, todayInParis } from '$lib/utils/date';

async function setFlags(workspaceId: string, flags: { supportEnabled?: boolean; supportTimeTrackingEnabled?: boolean }) {
	await db.update(workspace).set(flags).where(eq(workspace.id, workspaceId));
}

describe('support +page.server load — récap des derniers jours ouvrés', () => {
	it('5 derniers jours ouvrés, du plus récent au plus ancien, avec le temps saisi aujourd’hui', async () => {
		const { userId, workspaceId } = await makeWorkspace('supprecap');
		await setFlags(workspaceId, { supportTimeTrackingEnabled: true });
		await createTimeEntry(workspaceId, userId, { ticketRef: 'INC-42', minutes: 30 });

		const { dailyRecap } = await load({ locals: await fakeLocals(userId) } as never);

		const expected = [lastWorkdayOnOrBefore(todayInParis())];
		while (expected.length < 5) expected.push(previousWorkday(expected[expected.length - 1]));
		expect(dailyRecap.map((d: { day: string }) => d.day)).toEqual(expected);
		// Saisie « maintenant » : comptée sur aujourd'hui seulement si aujourd'hui est ouvré.
		const todayRecap = dailyRecap.find((d: { day: string }) => d.day === todayInParis());
		if (todayRecap) expect(todayRecap).toEqual({ day: todayInParis(), minutes: 30, tickets: 1 });
	});

	it('suivi du temps désactivé (rotation seule) : pas de récap', async () => {
		const { userId, workspaceId } = await makeWorkspace('supprecap');
		await setFlags(workspaceId, { supportEnabled: true });

		const { dailyRecap } = await load({ locals: await fakeLocals(userId) } as never);
		expect(dailyRecap).toEqual([]);
	});
});
