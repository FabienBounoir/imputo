import { describe, it, expect } from 'vitest';
import { db, activity, ticket, ticketGroup, ticketGroupMember, timeEntry, weeklyObjective } from '$lib/server/db';
import { makeWorkspace, addMember } from './test-helpers';
import { getActivitySynthesisView } from './activitySynthesis';
import { toISODate } from '$lib/utils/date';

describe('getActivitySynthesisView (intégration DB)', () => {
	it('somme par activité et par personne, tâche custom incluse, sans doublon quand un ticket est dans 2 groupes', async () => {
		const ws = await makeWorkspace('synth');
		const bob = await addMember(ws.workspaceId, 'USER', 'synth-bob');
		const today = toISODate(new Date());
		const thisMonth = `${today.slice(0, 7)}-01`;

		const [act] = await db.insert(activity).values({ workspaceId: ws.workspaceId, label: 'Activité synthèse test' }).returning();
		const [t] = await db.insert(ticket).values({ workspaceId: ws.workspaceId, key: 'SYN-1', title: 'T' }).returning({ id: ticket.id });
		const [obj] = await db
			.insert(weeklyObjective)
			.values({ workspaceId: ws.workspaceId, userId: ws.userId, weekMonday: today, kind: 'CUSTOM', label: 'Tâche libre', createdByUserId: ws.userId })
			.returning({ id: weeklyObjective.id });
		await db.insert(timeEntry).values([
			{ workspaceId: ws.workspaceId, userId: ws.userId, targetType: 'TICKET', ticketId: t.id, activityId: act.id, day: today, amount: '2' },
			{ workspaceId: ws.workspaceId, userId: bob.userId, targetType: 'TICKET', ticketId: t.id, activityId: act.id, day: today, amount: '1' },
			// Tâche custom : pas de ticket, mais une activité — doit compter dans la somme.
			{ workspaceId: ws.workspaceId, userId: ws.userId, targetType: 'OBJECTIVE', objectiveId: obj.id, activityId: act.id, day: today, amount: '0.5' }
		]);
		const [g1, g2] = await db
			.insert(ticketGroup)
			.values([
				{ workspaceId: ws.workspaceId, label: 'G1' },
				{ workspaceId: ws.workspaceId, label: 'G2' }
			])
			.returning({ id: ticketGroup.id });
		await db.insert(ticketGroupMember).values([
			{ groupId: g1.id, ticketId: t.id },
			{ groupId: g2.id, ticketId: t.id }
		]);

		const all = await getActivitySynthesisView(ws.workspaceId, {});
		const row = all.rows.find((r) => r.activityId === act.id)!;
		expect(row.total).toBe(3.5);
		const cell = row.cells.find((c) => c.month === thisMonth)!;
		expect(cell.byUser.map((u) => u.total).sort()).toEqual([1, 2.5]);

		// Filtre groupe : le ticket est dans 2 groupes, mais filtrer sur l'un ne doit pas doubler la somme,
		// et la tâche custom (sans ticket) sort du périmètre.
		const filtered = await getActivitySynthesisView(ws.workspaceId, { groupId: g1.id });
		expect(filtered.rows.find((r) => r.activityId === act.id)!.total).toBe(3);
	});
});
