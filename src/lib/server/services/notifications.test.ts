import { describe, it, expect, vi, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db, workspace, category, timeEntry, moodVote, user, membership } from '$lib/server/db';
import { createWorkspaceWithOwner } from './workspaces';
import { todayInParis, parseISODate, toISODate, addDays } from '$lib/utils/date';

const sendCalls: { userId: string; tag?: string }[] = [];
vi.mock('./push', () => ({
	hasSubscription: async () => true,
	sendToUser: async (userId: string, payload: { tag?: string }) => {
		sendCalls.push({ userId, tag: payload.tag });
		return 1;
	}
}));
function sentTo(userId: string, tagPrefix?: string) {
	return sendCalls.some((c) => c.userId === userId && (!tagPrefix || c.tag?.startsWith(tagPrefix)));
}
vi.mock('$lib/utils/date', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/utils/date')>();
	return { ...actual, isWorkday: () => true };
});

const { runNotifications, notifyAbsencePending, notifyAbsenceValidated } = await import('./notifications');

const rnd = Math.random().toString(36).slice(2, 8);
const wsIds: string[] = [];
afterAll(async () => {
	for (const id of wsIds) await db.delete(workspace).where(eq(workspace.id, id));
});

describe('runNotifications - relances par slot', () => {
	it('renotifie tant que la journée reste incomplète, mais pas deux fois pour le même slot', async () => {
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Nag Test',
			email: `nag-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Nag'
		});
		wsIds.push(workspaceId);

		sendCalls.length = 0;
		await runNotifications('evening', '1700');
		expect(sentTo(userId)).toBe(true); // rien saisi → notifie

		sendCalls.length = 0;
		await runNotifications('evening', '1700');
		expect(sentTo(userId)).toBe(false); // même slot → dédupliqué

		sendCalls.length = 0;
		await runNotifications('evening', '1715');
		expect(sentTo(userId)).toBe(true); // slot différent, toujours rien saisi → relance

		const [mco] = await db
			.select({ id: category.id })
			.from(category)
			.where(and(eq(category.workspaceId, workspaceId), eq(category.label, 'MCO')));
		await db.insert(timeEntry).values({
			workspaceId,
			userId,
			targetType: 'CATEGORY',
			categoryId: mco.id,
			day: todayInParis(),
			amount: '1'
		});

		sendCalls.length = 0;
		await runNotifications('evening', '1800');
		expect(sentTo(userId)).toBe(false); // journée complétée → plus de relance
	});
});

/** dow 0=lundi..6=dimanche, comme currentMoodPeriod. */
function dowMon0(iso: string): number {
	return (parseISODate(iso).getUTCDay() + 6) % 7;
}
/** startWeekday à donner à un espace WEEK_1 pour que sa plage se termine pile sur `endISO`. */
function startWeekdayForEnd(endISO: string): number {
	return (dowMon0(endISO) + 1) % 7;
}

describe('runNotifications - Team mood', () => {
	it('mood-deadline notifie seulement ceux qui n’ont pas voté le dernier jour de la plage', async () => {
		const today = todayInParis();
		const startWeekday = startWeekdayForEnd(today);

		const notVoted = await createWorkspaceWithOwner({
			displayName: 'Pas voté',
			email: `mood-a-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Mood A'
		});
		wsIds.push(notVoted.workspaceId);
		const alreadyVoted = await createWorkspaceWithOwner({
			displayName: 'Déjà voté',
			email: `mood-b-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Mood B'
		});
		wsIds.push(alreadyVoted.workspaceId);

		for (const ws of [notVoted.workspaceId, alreadyVoted.workspaceId]) {
			await db
				.update(workspace)
				.set({ moodEnabled: true, moodPeriodKind: 'WEEK_1', moodStartWeekday: startWeekday })
				.where(eq(workspace.id, ws));
		}
		const periodStart = toISODate(addDays(parseISODate(today), -6));
		await db.insert(moodVote).values({
			workspaceId: alreadyVoted.workspaceId,
			userId: alreadyVoted.userId,
			periodStart,
			periodEnd: today,
			score: 4
		});

		sendCalls.length = 0;
		await runNotifications('mood-deadline');
		expect(sentTo(notVoted.userId, 'MOOD_DEADLINE')).toBe(true);
		expect(sentTo(alreadyVoted.userId, 'MOOD_DEADLINE')).toBe(false);
	});

	it('mood-recap notifie l’admin seulement si la moyenne chute nettement vs la plage précédente', async () => {
		const today = todayInParis();
		const yesterday = toISODate(addDays(parseISODate(today), -1));
		const startWeekday = startWeekdayForEnd(yesterday);
		const justClosedStart = toISODate(addDays(parseISODate(yesterday), -6));
		const prevStart = toISODate(addDays(parseISODate(justClosedStart), -7));

		const dropped = await createWorkspaceWithOwner({
			displayName: 'Admin chute',
			email: `mood-c-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Mood Chute'
		});
		wsIds.push(dropped.workspaceId);
		const stable = await createWorkspaceWithOwner({
			displayName: 'Admin stable',
			email: `mood-d-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Mood Stable'
		});
		wsIds.push(stable.workspaceId);

		for (const ws of [dropped.workspaceId, stable.workspaceId]) {
			await db
				.update(workspace)
				.set({ moodEnabled: true, moodPeriodKind: 'WEEK_1', moodStartWeekday: startWeekday })
				.where(eq(workspace.id, ws));
		}
		// Chute nette : 4.5 → 2.0 (> seuil par défaut 0.5)
		await db.insert(moodVote).values([
			{ workspaceId: dropped.workspaceId, userId: dropped.userId, periodStart: prevStart, periodEnd: justClosedStart, score: 4 },
			{ workspaceId: dropped.workspaceId, userId: dropped.userId, periodStart: justClosedStart, periodEnd: yesterday, score: 2 }
		]);
		// Stable : 4 → 4 (pas de chute)
		await db.insert(moodVote).values([
			{ workspaceId: stable.workspaceId, userId: stable.userId, periodStart: prevStart, periodEnd: justClosedStart, score: 4 },
			{ workspaceId: stable.workspaceId, userId: stable.userId, periodStart: justClosedStart, periodEnd: yesterday, score: 4 }
		]);

		sendCalls.length = 0;
		await runNotifications('morning', '0900');
		expect(sentTo(dropped.userId, 'MOOD_RECAP')).toBe(true);
		expect(sentTo(stable.userId, 'MOOD_RECAP')).toBe(false);
	});
});

describe('notifyAbsencePending', () => {
	it('notifie les autres admins mais pas le demandeur, et dédup un second appel pour le même congé', async () => {
		const admin = await createWorkspaceWithOwner({
			displayName: 'Admin Congés',
			email: `abs-a-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Congés'
		});
		wsIds.push(admin.workspaceId);

		const [requester] = await db
			.insert(user)
			.values({ displayName: 'Demandeur', email: `abs-b-${rnd}@acme.test`, passwordHash: 'x' })
			.returning();
		await db.insert(membership).values({ workspaceId: admin.workspaceId, userId: requester.id, role: 'USER' });

		sendCalls.length = 0;
		await notifyAbsencePending(admin.workspaceId, 'Espace Congés', requester.id, 'Demandeur', 'absence-1');
		expect(sentTo(admin.userId, 'ABSENCE_PENDING')).toBe(true);
		expect(sentTo(requester.id)).toBe(false); // le demandeur n'est pas admin de toute façon, mais surtout jamais notifié de sa propre demande

		sendCalls.length = 0;
		await notifyAbsencePending(admin.workspaceId, 'Espace Congés', requester.id, 'Demandeur', 'absence-1');
		expect(sentTo(admin.userId)).toBe(false); // même congé → dédupliqué
	});
});

describe('notifyAbsenceValidated', () => {
	it('notifie le demandeur et dédup un second appel pour le même congé', async () => {
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Congé Validé',
			email: `abs-c-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Validation'
		});
		wsIds.push(workspaceId);

		sendCalls.length = 0;
		await notifyAbsenceValidated(workspaceId, 'Espace Validation', userId, '2026-08-10', '2026-08-12', 'absence-2');
		expect(sentTo(userId, 'ABSENCE_VALIDATED')).toBe(true);

		sendCalls.length = 0;
		await notifyAbsenceValidated(workspaceId, 'Espace Validation', userId, '2026-08-10', '2026-08-12', 'absence-2');
		expect(sentTo(userId)).toBe(false); // même congé → dédupliqué
	});
});
