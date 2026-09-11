import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db, workspace, category, timeEntry, moodVote, user, membership, activity, ticket, ticketActivityRae } from '$lib/server/db';
import { createWorkspaceWithOwner } from './workspaces';
import { setSupportEnabled, setSupportCadence, addRotationMember, setOverride, getCurrentDuty } from './support';
import { addMember, makeWorkspace } from './test-helpers';
import { listStaleRaePairs, upsertTicketActivityRae } from './tickets';
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
// isWorkday/lastWorkdayOnOrBefore neutralisés : sans ça les tests ci-dessous (qui construisent des
// plages se terminant « aujourd'hui ») échoueraient selon le jour de la semaine où la CI tourne.
// Le décalage au dernier jour ouvré est couvert par date.test.ts.
//
// todayInParis figé sur un lundi (ANCHOR_TODAY) pour la même raison : currentSupportPeriod (cadence
// DAY, cf. support.ts) retombe sur le dernier jour actif un week-end, donc « aujourd'hui » n'est
// alors jamais le début de période — sans ce mock, le test support ci-dessous échouait un
// samedi/dimanche. Tous les autres tests du fichier dérivent déjà leurs dates de todayInParis(),
// donc les figer sur un lundi les rend simplement déterministes, sans rien changer à ce qu'ils
// vérifient. `mockedToday` est mutable pour le test « week-end » plus bas, qui a besoin d'un vrai
// samedi/dimanche — remis à l'ancre après chaque test.
const ANCHOR_TODAY = '2026-06-22'; // lundi
let mockedToday = ANCHOR_TODAY;
vi.mock('$lib/utils/date', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/utils/date')>();
	return { ...actual, isWorkday: () => true, lastWorkdayOnOrBefore: (d: string) => d, todayInParis: () => mockedToday };
});

const { runNotifications, notifyAbsencePending, notifyAbsenceValidated, notifySupportDutyChanged, parseNotifPrefs } =
	await import('./notifications');

const rnd = Math.random().toString(36).slice(2, 8);
const wsIds: string[] = [];
afterAll(async () => {
	for (const id of wsIds) await db.delete(workspace).where(eq(workspace.id, id));
});
afterEach(() => {
	mockedToday = ANCHOR_TODAY;
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

describe('créneaux de relance', () => {
	it('ne notifie pas sur un créneau décoché, mais garde les autres', async () => {
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Slot Test',
			email: `slot-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Slot'
		});
		wsIds.push(workspaceId);
		await db
			.update(user)
			.set({ notifPrefs: JSON.stringify({ eveningSlots: { '1715': false } }) })
			.where(eq(user.id, userId));

		sendCalls.length = 0;
		await runNotifications('evening', '1700');
		expect(sentTo(userId)).toBe(true);

		sendCalls.length = 0;
		await runNotifications('evening', '1715'); // créneau décoché
		expect(sentTo(userId)).toBe(false);

		sendCalls.length = 0;
		await runNotifications('evening', '1800');
		expect(sentTo(userId)).toBe(true);
	});

	it('des prefs sans créneaux (ou illisibles) activent les trois créneaux', () => {
		for (const raw of [null, '{}', 'pas du json', '{"eveningMissing":true}']) {
			expect(parseNotifPrefs(raw).eveningSlots).toEqual({ '1700': true, '1715': true, '1800': true });
		}
		// Clés inconnues ignorées, seuls les créneaux connus sont conservés.
		expect(parseNotifPrefs('{"eveningSlots":{"0300":false,"1700":false}}').eveningSlots).toEqual({
			'1700': false,
			'1715': true,
			'1800': true
		});
	});
});

describe('support', () => {
	it('notifie la personne de support le jour où sa période démarre, pas les jours suivants', async () => {
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Support Test',
			email: `support-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Support'
		});
		wsIds.push(workspaceId);
		await setSupportEnabled(workspaceId, true);
		await setSupportCadence(workspaceId, 'DAY'); // période = la journée, donc elle démarre aujourd'hui
		await addRotationMember(workspaceId, userId);

		sendCalls.length = 0;
		await runNotifications('morning', '0900');
		expect(sentTo(userId, 'SUPPORT_DUTY')).toBe(true);

		// Cadence WEEK : la période a démarré lundi, donc plus rien à notifier aujourd'hui
		// (sauf si on est lundi — d'où le dédup déjà posé ci-dessus qui couvre ce cas).
		await setSupportCadence(workspaceId, 'WEEK');
		sendCalls.length = 0;
		await runNotifications('morning', '0915');
		expect(sentTo(userId, 'SUPPORT_DUTY')).toBe(false);
	});

	it('cadence DAY un week-end : la période retombe sur le dernier jour actif, jamais "aujourd\'hui"', async () => {
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Support Weekend',
			email: `support-we-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Support Weekend'
		});
		wsIds.push(workspaceId);
		await setSupportEnabled(workspaceId, true);
		await setSupportCadence(workspaceId, 'DAY');
		await addRotationMember(workspaceId, userId);

		// Samedi (includeSaturday par défaut false) : currentSupportPeriod retombe sur le vendredi
		// précédent (cf. isActiveSupportDay/date.ts) — periodStart ne vaut alors jamais "aujourd'hui",
		// donc supportDuty() (notifications.ts) ne notifie personne, un jour comme l'autre du week-end.
		mockedToday = '2026-06-27'; // samedi
		sendCalls.length = 0;
		await runNotifications('morning', '0900');
		expect(sentTo(userId, 'SUPPORT_DUTY')).toBe(false);

		mockedToday = '2026-06-28'; // dimanche
		sendCalls.length = 0;
		await runNotifications('morning', '0900');
		expect(sentTo(userId, 'SUPPORT_DUTY')).toBe(false);
	});

	it('notifie la personne effective après un override manuel, avec un kind distinct du cron', async () => {
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Support Override',
			email: `support-ov-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Support Override'
		});
		wsIds.push(workspaceId);
		await setSupportEnabled(workspaceId, true);
		await setSupportCadence(workspaceId, 'DAY');
		await addRotationMember(workspaceId, userId);
		const other = await addMember(workspaceId, 'USER', `support-ov2-${rnd}`);
		await addRotationMember(workspaceId, other.userId);

		const current = await getCurrentDuty(workspaceId);
		await setOverride(workspaceId, current!.periodStart, other.userId);

		sendCalls.length = 0;
		await notifySupportDutyChanged(workspaceId, 'Espace Support Override', current!.periodStart);
		expect(sentTo(other.userId, 'SUPPORT_DUTY_CHANGED')).toBe(true);
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
		await notifyAbsencePending(admin.workspaceId, 'Espace Congés', requester.id, 'Demandeur', '2026-08-10', '2026-08-12', 'absence-1');
		expect(sentTo(admin.userId, 'ABSENCE_PENDING')).toBe(true);
		expect(sentTo(requester.id)).toBe(false); // le demandeur n'est pas admin de toute façon, mais surtout jamais notifié de sa propre demande

		sendCalls.length = 0;
		await notifyAbsencePending(admin.workspaceId, 'Espace Congés', requester.id, 'Demandeur', '2026-08-10', '2026-08-12', 'absence-1');
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

describe('RAE périmé', () => {
	it('ne compte que les paires (ticket, activité) imputées, au RAE Réel > 0 et non mises à jour depuis 7 jours', async () => {
		// makeWorkspace (et pas createWorkspaceWithOwner) : son nettoyage supprime les tickets avant
		// l'espace, sinon ticket_activity_rae → activity (RESTRICT) bloque la suppression.
		const { userId: dev, workspaceId } = await makeWorkspace('rae-stale');
		const recette = await addMember(workspaceId, 'USER', 'rae-stale-recette');
		const [devAct, recAct] = await db
			.insert(activity)
			.values([
				{ workspaceId, label: `Dev ${rnd}` },
				{ workspaceId, label: `Recette ${rnd}` }
			])
			.returning();
		const longAgo = new Date(Date.now() - 30 * 86400000);
		const [ventile, nonVentile] = await db
			.insert(ticket)
			.values([
				{ workspaceId, key: `RAE-1-${rnd}`, title: 'Ventilé', raeReal: '5' },
				{ workspaceId, key: `RAE-2-${rnd}`, title: 'Non ventilé', raeReal: '5' }
			])
			.returning();
		await db.insert(ticketActivityRae).values([
			{ ticketId: ventile.id, activityId: devAct.id, raeReal: '3', updatedAt: longAgo },
			{ ticketId: ventile.id, activityId: recAct.id, raeReal: '0', updatedAt: longAgo }
		]);
		const day = todayInParis();
		const entry = (userId: string, ticketId: string, activityId: string) =>
			({ workspaceId, userId, targetType: 'TICKET', ticketId, activityId, day, amount: '1' }) as const;
		await db.insert(timeEntry).values([
			entry(dev, ventile.id, devAct.id),
			entry(recette.userId, ventile.id, recAct.id),
			// RAE non ventilé par activité (repli ticket.raeReal) : affiché 0 en imputation.
			entry(recette.userId, nonVentile.id, recAct.id)
		]);
		// La personne Recette met sa ligne à jour : ça ne rafraîchit plus la ligne Dev du même ticket.
		await upsertTicketActivityRae(workspaceId, ventile.id, recAct.id, 'raeReal', 2);

		sendCalls.length = 0;
		await runNotifications('morning', '0900');
		expect(sentTo(dev, 'RAE_STALE')).toBe(true);
		expect(sentTo(recette.userId, 'RAE_STALE')).toBe(false);

		// Même définition pour la page /rae et sa pastille : la ligne Dev (30 j, palier 3), rien pour Recette.
		const devLines = await listStaleRaePairs({ workspaceId, userId: dev });
		expect(devLines.map((p) => [p.activityId, p.step, p.imputed])).toEqual([[devAct.id, 3, 1]]);
		expect(await listStaleRaePairs({ workspaceId, userId: recette.userId })).toEqual([]);
	});
});
