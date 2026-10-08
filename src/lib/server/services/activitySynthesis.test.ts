import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, activity, category, project, ticket, ticketGroup, ticketGroupMember, timeEntry, weeklyObjective } from '$lib/server/db';
import { makeWorkspace, addMember } from './test-helpers';
import { getActivitySynthesisDetail, getActivitySynthesisView } from './activitySynthesis';
import { addMonths, toISODate } from '$lib/utils/date';

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

	it('compte les saisies sans activité sur une ligne dédiée, en dernier, et exclut les userIds demandés', async () => {
		const ws = await makeWorkspace('synth-none');
		const bob = await addMember(ws.workspaceId, 'USER', 'synth-none-bob');
		const today = toISODate(new Date());
		const [act] = await db.insert(activity).values({ workspaceId: ws.workspaceId, label: 'Zzz dernière alpha' }).returning();
		const [t] = await db.insert(ticket).values({ workspaceId: ws.workspaceId, key: 'SYN-2', title: 'T' }).returning({ id: ticket.id });
		// Catégorie système déjà créée avec l'espace (une par type d'absence).
		const [conge] = await db
			.select({ id: category.id, label: category.label })
			.from(category)
			.where(and(eq(category.workspaceId, ws.workspaceId), eq(category.linkedAbsenceType, 'CONGE_VALIDE')));
		await db.insert(timeEntry).values([
			{ workspaceId: ws.workspaceId, userId: ws.userId, targetType: 'TICKET', ticketId: t.id, activityId: act.id, day: today, amount: '1' },
			{ workspaceId: ws.workspaceId, userId: ws.userId, targetType: 'TICKET', ticketId: t.id, day: today, amount: '0.5' },
			{ workspaceId: ws.workspaceId, userId: bob.userId, targetType: 'TICKET', ticketId: t.id, day: today, amount: '2' },
			// Congé (catégorie liée à une absence) : sans activité par nature, ligne dédiée et pas « à corriger ».
			{ workspaceId: ws.workspaceId, userId: bob.userId, targetType: 'CATEGORY', categoryId: conge.id, day: today, amount: '1.5' }
		]);

		const all = await getActivitySynthesisView(ws.workspaceId, {});
		expect(all.rows.map((r) => [r.kind, r.activityId, r.label, r.total])).toEqual([
			['ACTIVITY', act.id, 'Zzz dernière alpha', 1],
			['ABSENCE', null, 'Absences', 1.5],
			['NONE', null, 'Sans activité', 2.5]
		]);

		// Détail par tâche : le ticket SYN-2 porte les 2,5 j sans activité (2 personnes, une seule tâche).
		const noneCell = all.rows.find((r) => r.kind === 'NONE')!.cells.find((c) => c.total > 0)!;
		expect(noneCell.byTask).toEqual([{ taskId: `TICKET:${t.id}`, label: 'T', ticketId: t.id, ticketKey: 'SYN-2', total: 2.5 }]);

		// Détail au clic : Bob sur « Sans activité » → ses tâches ; le ticket SYN-2 → ses contributeurs.
		const bobTasks = await getActivitySynthesisDetail(ws.workspaceId, {}, undefined, { kind: 'NONE' }, { userId: bob.userId });
		expect(bobTasks!.lines.map((l) => [l.id, l.ticketKey, l.total])).toEqual([[`TICKET:${t.id}`, 'SYN-2', 2]]);
		const contributors = await getActivitySynthesisDetail(ws.workspaceId, {}, undefined, { kind: 'NONE' }, { taskId: `TICKET:${t.id}` });
		expect(contributors!.lines.map((l) => [l.userId, l.total])).toEqual([
			[bob.userId, 2],
			[ws.userId, 0.5]
		]);
		// Le congé est dans la ligne Absences, pas dans Sans activité.
		const bobAbs = await getActivitySynthesisDetail(ws.workspaceId, {}, undefined, { kind: 'ABSENCE' }, { userId: bob.userId });
		expect(bobAbs!.lines.map((l) => [l.id, l.total])).toEqual([[`CATEGORY:${conge.id}`, 1.5]]);
		expect(await getActivitySynthesisDetail(ws.workspaceId, {}, undefined, { kind: 'NONE' }, { taskId: 'TICKET:pas-un-uuid' })).toBeNull();

		const noBob = await getActivitySynthesisView(ws.workspaceId, {}, [bob.userId]);
		expect(noBob.rows.find((r) => r.kind === 'NONE')!.total).toBe(0.5);
		expect(noBob.rows.some((r) => r.kind === 'ABSENCE')).toBe(false);
	});

	it('fenêtre de 12 mois (mois courant inclus), activité archivée signalée, filtre projet appliqué à la vue et au détail', async () => {
		const ws = await makeWorkspace('synth-win');
		const thisMonth = `${toISODate(new Date()).slice(0, 7)}-01`;
		const firstMonth = addMonths(thisMonth, -11); // 1er mois de la fenêtre
		const tooOld = `${addMonths(thisMonth, -12).slice(0, 7)}-28`; // dernier mois hors fenêtre

		const [act] = await db
			.insert(activity)
			.values({ workspaceId: ws.workspaceId, label: 'Archivée test', archivedAt: new Date() })
			.returning();
		const [proj] = await db.insert(project).values({ workspaceId: ws.workspaceId, name: 'Projet synth' }).returning({ id: project.id });
		const [inProj] = await db
			.insert(ticket)
			.values({ workspaceId: ws.workspaceId, key: 'WIN-1', title: 'Dans le projet', projectId: proj.id })
			.returning({ id: ticket.id });
		const [outProj] = await db.insert(ticket).values({ workspaceId: ws.workspaceId, key: 'WIN-2', title: 'Hors projet' }).returning({ id: ticket.id });
		const entry = (ticketId: string, day: string, amount: string) => ({
			workspaceId: ws.workspaceId,
			userId: ws.userId,
			targetType: 'TICKET' as const,
			ticketId,
			activityId: act.id,
			day,
			amount
		});
		await db.insert(timeEntry).values([
			entry(inProj.id, firstMonth, '1'), // borne basse : comptée
			entry(outProj.id, thisMonth, '2'),
			entry(inProj.id, tooOld, '5') // hors fenêtre : ignorée
		]);

		const all = await getActivitySynthesisView(ws.workspaceId, {});
		expect(all.windowMonths).toHaveLength(12);
		expect(all.windowMonths[0]).toBe(firstMonth);
		expect(all.windowMonths[11]).toBe(thisMonth);
		const row = all.rows.find((r) => r.activityId === act.id)!;
		expect(row.archived).toBe(true);
		expect(row.total).toBe(3);
		expect(row.cells[0].total).toBe(1);
		expect(row.cells[11].total).toBe(2);

		const filtered = await getActivitySynthesisView(ws.workspaceId, { projectId: proj.id });
		expect(filtered.rows.find((r) => r.activityId === act.id)!.total).toBe(1);

		const bucket = { kind: 'ACTIVITY' as const, activityId: act.id };
		const detail = await getActivitySynthesisDetail(ws.workspaceId, { projectId: proj.id }, undefined, bucket, { userId: ws.userId });
		expect(detail!.lines.map((l) => [l.ticketKey, l.total, l.byMonth])).toEqual([['WIN-1', 1, { [firstMonth]: 1 }]]);
		// Personne exclue (factice pour un non-ADMIN) : rien dans le détail non plus.
		const hidden = await getActivitySynthesisDetail(ws.workspaceId, {}, [ws.userId], bucket, { taskId: `TICKET:${outProj.id}` });
		expect(hidden!.lines).toEqual([]);
	});
});
