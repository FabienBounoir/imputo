import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { GET } from './+server';
import { db, activity, membership, ticket, timeEntry } from '$lib/server/db';
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals } from '$lib/server/test-helpers/http';
import { toISODate } from '$lib/utils/date';

const call = async (locals: unknown, search: string) =>
	GET({ locals, url: new URL(`http://localhost/dashboard/activite/detail?${search}`) } as never);

describe('GET /dashboard/activite/detail', () => {
	it('refuse les paramètres invalides (400) et une requête sans espace (401)', async () => {
		const { userId } = await makeWorkspace('synthdetail');
		const locals = await fakeLocals(userId);
		const uuid = '00000000-0000-4000-8000-000000000000';

		for (const search of [
			`bucket=Dev&user=${userId}`, // bucket ni uuid ni ABSENCE/NONE
			'bucket=NONE', // ni user ni task
			'bucket=NONE&user=pas-un-uuid',
			'bucket=NONE&task=TICKET:pas-un-uuid',
			`bucket=NONE&task=AUTRE:${uuid}`
		]) {
			await expect(call(locals, search), search).rejects.toMatchObject({ status: 400 });
		}
		await expect(call({ ...locals, workspace: null }, `bucket=NONE&user=${userId}`)).rejects.toMatchObject({ status: 401 });
	});

	it("renvoie le détail d'une personne et d'une tâche ; ignore un filtre mal formé ; factices masqués pour un USER", async () => {
		const { userId: adminId, workspaceId } = await makeWorkspace('synthdetail');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'synthdetail-user');
		const { userId: facticeId } = await addMember(workspaceId, 'USER', 'synthdetail-factice');
		await db
			.update(membership)
			.set({ factice: true })
			.where(and(eq(membership.workspaceId, workspaceId), eq(membership.userId, facticeId)));
		const [act] = await db.select({ id: activity.id }).from(activity).where(eq(activity.workspaceId, workspaceId)).limit(1);
		const [t] = await db.insert(ticket).values({ workspaceId, key: 'DET-1', title: 'Détail' }).returning({ id: ticket.id });
		const today = toISODate(new Date());
		await db.insert(timeEntry).values([
			{ workspaceId, userId: memberId, targetType: 'TICKET', ticketId: t.id, activityId: act.id, day: today, amount: '1.5' },
			{ workspaceId, userId: facticeId, targetType: 'TICKET', ticketId: t.id, activityId: act.id, day: today, amount: '3' }
		]);

		const asUser = await fakeLocals(memberId);
		const tasks = await (await call(asUser, `bucket=${act.id}&user=${memberId}&project=pas-un-uuid`)).json();
		expect(tasks.windowMonths).toHaveLength(12);
		expect(tasks.lines).toMatchObject([{ id: `TICKET:${t.id}`, ticketKey: 'DET-1', label: 'Détail', total: 1.5 }]);

		const people = await (await call(asUser, `bucket=${act.id}&task=TICKET:${t.id}`)).json();
		expect(people.lines.map((l: { userId: string }) => l.userId)).toEqual([memberId]);

		const asAdmin = await fakeLocals(adminId);
		const all = await (await call(asAdmin, `bucket=${act.id}&task=TICKET:${t.id}`)).json();
		expect(all.lines.map((l: { userId: string; total: number }) => [l.userId, l.total])).toEqual([
			[facticeId, 3],
			[memberId, 1.5]
		]);
	});
});
