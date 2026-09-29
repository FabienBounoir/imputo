import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { load as loadUntyped } from './+page.server';
// Même retypage que dashboard/sprint/page.server.test.ts : load renvoie toujours des données ici.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { db, activity, membership, ticket, timeEntry } from '$lib/server/db';
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals, fakeCookies } from '$lib/server/test-helpers/http';
import { createRef, listRefs } from '$lib/server/services/referentials';
import { toISODate } from '$lib/utils/date';

const url = (search = '') => new URL(`http://localhost/dashboard/activite${search}`);
const cookieName = (workspaceId: string) => `imputo-activite-filters-${workspaceId}`;

describe('dashboard/activite +page.server load', () => {
	it("filtres : l'URL prime, sinon le cookie mémorisé ; un id inconnu (référentiel supprimé) est ignoré", async () => {
		const { userId, workspaceId } = await makeWorkspace('synthpage');
		await createRef(workspaceId, 'project', 'Projet A');
		await createRef(workspaceId, 'project', 'Projet B');
		const [a, b] = (await listRefs(workspaceId, 'project')).sort((x, y) => x.name.localeCompare(y.name));
		const locals = await fakeLocals(userId);
		const cookies = fakeCookies();
		cookies.set(cookieName(workspaceId), `project=${a.id}`);

		const fromCookie = await load({ locals, url: url(), cookies } as never);
		expect(fromCookie.filters.projectId).toBe(a.id);
		expect(fromCookie.cookieName).toBe(cookieName(workspaceId));

		const fromUrl = await load({ locals, url: url(`?project=${b.id}`), cookies } as never);
		expect(fromUrl.filters.projectId).toBe(b.id);

		cookies.set(cookieName(workspaceId), 'project=00000000-0000-4000-8000-000000000000&sprint=pas-un-uuid');
		const stale = await load({ locals, url: url(), cookies } as never);
		expect(stale.filters).toEqual({
			projectId: undefined,
			sprintId: undefined,
			versionId: undefined,
			sspId: undefined,
			groupId: undefined
		});
	});

	it('ouverte à tout membre : un USER voit la page sans les membres factices, un ADMIN les voit', async () => {
		const { userId: adminId, workspaceId } = await makeWorkspace('synthpage');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'synthpage-user');
		const { userId: facticeId } = await addMember(workspaceId, 'USER', 'synthpage-factice');
		await db
			.update(membership)
			.set({ factice: true })
			.where(and(eq(membership.workspaceId, workspaceId), eq(membership.userId, facticeId)));

		const [act] = await db.select({ id: activity.id }).from(activity).where(eq(activity.workspaceId, workspaceId)).limit(1);
		const [t] = await db.insert(ticket).values({ workspaceId, key: 'SP-1', title: 'T' }).returning({ id: ticket.id });
		const today = toISODate(new Date());
		await db.insert(timeEntry).values([
			{ workspaceId, userId: memberId, targetType: 'TICKET', ticketId: t.id, activityId: act.id, day: today, amount: '1' },
			{ workspaceId, userId: facticeId, targetType: 'TICKET', ticketId: t.id, activityId: act.id, day: today, amount: '4' }
		]);
		const total = (r: Record<string, any>) => r.view.rows.find((row: any) => row.activityId === act.id)?.total;

		const asUser = await load({ locals: await fakeLocals(memberId), url: url(), cookies: fakeCookies() } as never);
		expect(total(asUser)).toBe(1);
		expect(asUser.isAdmin).toBe(false);
		expect(asUser.canEditEstimation).toBe(false);

		const asAdmin = await load({ locals: await fakeLocals(adminId), url: url(), cookies: fakeCookies() } as never);
		expect(total(asAdmin)).toBe(5);
		expect(asAdmin.isAdmin).toBe(true);
		expect(asAdmin.isOwner).toBe(true);
	});
});
