import { and, asc, eq, sql } from 'drizzle-orm';
import { db, workspace, user, membership, supportRotationMember, supportOverride, supportDutyLog, type SupportCadence } from '$lib/server/db';
import { addDays, currentSupportPeriod, mondayOf, parseISODate, supportPeriodIndex, toISODate, todayInParis } from '$lib/utils/date';

export type { SupportCadence };

export async function getSupportConfig(
	workspaceId: string
): Promise<{ enabled: boolean; cadence: SupportCadence; offset: number; includeSaturday: boolean }> {
	const rows = await db
		.select({
			enabled: workspace.supportEnabled,
			cadence: workspace.supportCadence,
			offset: workspace.supportRotationOffset,
			includeSaturday: workspace.supportIncludeSaturday
		})
		.from(workspace)
		.where(eq(workspace.id, workspaceId));
	const row = rows[0];
	if (!row) throw new Error('Espace introuvable.');
	return row;
}

export async function setSupportEnabled(workspaceId: string, enabled: boolean) {
	await db.update(workspace).set({ supportEnabled: enabled }).where(eq(workspace.id, workspaceId));
}

export async function setSupportCadence(workspaceId: string, cadence: SupportCadence) {
	await db.update(workspace).set({ supportCadence: cadence }).where(eq(workspace.id, workspaceId));
}

export async function setSupportIncludeSaturday(workspaceId: string, includeSaturday: boolean) {
	await db.update(workspace).set({ supportIncludeSaturday: includeSaturday }).where(eq(workspace.id, workspaceId));
}

export type RotationMemberItem = { id: string; userId: string; displayName: string; sortOrder: number };

export async function listRotationMembers(workspaceId: string): Promise<RotationMemberItem[]> {
	return db
		.select({
			id: supportRotationMember.id,
			userId: user.id,
			displayName: user.displayName,
			sortOrder: supportRotationMember.sortOrder
		})
		.from(supportRotationMember)
		.innerJoin(user, eq(supportRotationMember.userId, user.id))
		.where(eq(supportRotationMember.workspaceId, workspaceId))
		.orderBy(asc(supportRotationMember.sortOrder), asc(supportRotationMember.createdAt));
}

/** Ajoute un membre actif de l'espace en fin de rotation. */
export async function addRotationMember(workspaceId: string, userId: string) {
	const [m] = await db
		.select({ id: membership.id })
		.from(membership)
		.where(and(eq(membership.workspaceId, workspaceId), eq(membership.userId, userId), eq(membership.active, true)));
	if (!m) throw new Error('Membre introuvable ou inactif.');

	const [{ max }] = await db
		.select({ max: sql<number>`coalesce(max(${supportRotationMember.sortOrder}), -1)` })
		.from(supportRotationMember)
		.where(eq(supportRotationMember.workspaceId, workspaceId));

	await db
		.insert(supportRotationMember)
		.values({ workspaceId, userId, sortOrder: Number(max) + 1 })
		.onConflictDoNothing();
}

export async function removeRotationMember(workspaceId: string, id: string) {
	await db
		.delete(supportRotationMember)
		.where(and(eq(supportRotationMember.id, id), eq(supportRotationMember.workspaceId, workspaceId)));
}

/** Échange l'ordre d'un membre avec son voisin (haut/bas) — même mécanique que moveState/moveObjective. */
export async function moveRotationMember(workspaceId: string, id: string, dir: 'up' | 'down') {
	const rows = await db
		.select({ id: supportRotationMember.id, sortOrder: supportRotationMember.sortOrder })
		.from(supportRotationMember)
		.where(eq(supportRotationMember.workspaceId, workspaceId))
		.orderBy(asc(supportRotationMember.sortOrder), asc(supportRotationMember.createdAt));
	const idx = rows.findIndex((r) => r.id === id);
	const swap = dir === 'up' ? idx - 1 : idx + 1;
	if (idx < 0 || swap < 0 || swap >= rows.length) return;
	const a = rows[idx];
	const b = rows[swap];
	await db.transaction(async (tx) => {
		await tx.update(supportRotationMember).set({ sortOrder: b.sortOrder }).where(eq(supportRotationMember.id, a.id));
		await tx.update(supportRotationMember).set({ sortOrder: a.sortOrder }).where(eq(supportRotationMember.id, b.id));
	});
}

export type SupportDuty = {
	periodStart: string;
	periodEnd: string;
	userId: string;
	displayName: string;
	overridden: boolean;
};

export function pickFromChain(
	cadence: SupportCadence,
	members: RotationMemberItem[],
	offset: number,
	periodStart: string,
	includeSaturday: boolean
) {
	const index = supportPeriodIndex(cadence, periodStart, includeSaturday) + offset;
	return members[((index % members.length) + members.length) % members.length];
}

async function pickDuty(
	cadence: SupportCadence,
	members: RotationMemberItem[],
	offset: number,
	periodStart: string,
	periodEnd: string,
	includeSaturday: boolean,
	workspaceId: string
): Promise<SupportDuty> {
	const [ov] = await db
		.select({ userId: supportOverride.userId })
		.from(supportOverride)
		.where(and(eq(supportOverride.workspaceId, workspaceId), eq(supportOverride.periodStart, periodStart)));
	const overridden = members.find((m) => m.userId === ov?.userId);
	if (overridden) return { periodStart, periodEnd, userId: overridden.userId, displayName: overridden.displayName, overridden: true };

	const picked = pickFromChain(cadence, members, offset, periodStart, includeSaturday);
	return { periodStart, periodEnd, userId: picked.userId, displayName: picked.displayName, overridden: false };
}

/** Personne de perm pour la période courante (rotation normale, sauf override ponctuel). Null si aucun membre dans la rotation. */
export async function getCurrentDuty(workspaceId: string, todayISO: string = todayInParis()): Promise<SupportDuty | null> {
	const [{ cadence, offset, includeSaturday }, members] = await Promise.all([
		getSupportConfig(workspaceId),
		listRotationMembers(workspaceId)
	]);
	if (members.length === 0) return null;
	const { start, end } = currentSupportPeriod(cadence, todayISO, includeSaturday);
	return pickDuty(cadence, members, offset, start, end, includeSaturday, workspaceId);
}

export type DutyDay = { date: string; userId: string; displayName: string; overridden: boolean };
export type DutyWeek = { weekStart: string; days: DutyDay[] };

/**
 * Grille jour par jour (lun→ven, ou lun→sam si le samedi est inclus dans la perm), `weekCount`
 * semaines à partir de la semaine courante — pour un calendrier "qui est de perm ce jour-là".
 * Seule la période courante peut porter un override (cf. setOverride) : les autres jours
 * reflètent toujours la chaîne normale.
 */
export async function listDutyCalendar(
	workspaceId: string,
	weekCount: number,
	todayISO: string = todayInParis()
): Promise<DutyWeek[]> {
	const [{ cadence, offset, includeSaturday }, members] = await Promise.all([
		getSupportConfig(workspaceId),
		listRotationMembers(workspaceId)
	]);
	if (members.length === 0) return [];

	const currentPeriodStart = currentSupportPeriod(cadence, todayISO, includeSaturday).start;
	const [ov] = await db
		.select({ userId: supportOverride.userId })
		.from(supportOverride)
		.where(and(eq(supportOverride.workspaceId, workspaceId), eq(supportOverride.periodStart, currentPeriodStart)));
	const overrideMember = members.find((m) => m.userId === ov?.userId);

	const firstMonday = mondayOf(parseISODate(todayISO));
	const dayCount = includeSaturday ? 6 : 5;
	const weeks: DutyWeek[] = [];
	for (let w = 0; w < weekCount; w++) {
		const weekMonday = addDays(firstMonday, w * 7);
		const days: DutyDay[] = [];
		for (let d = 0; d < dayCount; d++) {
			const date = toISODate(addDays(weekMonday, d));
			const periodStart = currentSupportPeriod(cadence, date, includeSaturday).start;
			const isOverridden = Boolean(overrideMember) && periodStart === currentPeriodStart;
			const picked = isOverridden ? overrideMember! : pickFromChain(cadence, members, offset, periodStart, includeSaturday);
			days.push({ date, userId: picked.userId, displayName: picked.displayName, overridden: isOverridden });
		}
		weeks.push({ weekStart: toISODate(weekMonday), days });
	}
	return weeks;
}

/**
 * Recale supportDutyLog sur la personne effective actuelle d'une période, après un override/skip.
 * logDutyForToday n'écrit qu'une fois par période (onConflictDoNothing) : sans ce recalage, changer
 * qui est de perm sur la période EN COURS (déjà journalisée par le cron du jour même ou d'un jour
 * précédent de cette période) laisserait l'ancienne personne créditée dans le wrapped. No-op si la
 * période n'a pas encore de ligne (rien à corriger, le prochain passage du cron lira la bonne
 * valeur directement via pickDuty) — includeSaturday vient de getSupportConfig, donc déjà respecté.
 */
async function refreshDutyLog(workspaceId: string, periodStart: string) {
	const [{ cadence, offset, includeSaturday }, members] = await Promise.all([
		getSupportConfig(workspaceId),
		listRotationMembers(workspaceId)
	]);
	if (members.length === 0) return;
	const duty = await pickDuty(cadence, members, offset, periodStart, periodStart, includeSaturday, workspaceId);
	await db
		.update(supportDutyLog)
		.set({ userId: duty.userId })
		.where(and(eq(supportDutyLog.workspaceId, workspaceId), eq(supportDutyLog.periodStart, periodStart)));
}

/**
 * "Passer son tour" : décale toute la chaîne d'un cran, définitivement (la période courante ET
 * toutes les suivantes). Contrairement à setOverride, ne cible pas une personne précise — on
 * avance juste au suivant dans l'ordre. Efface un override existant sur cette période : il n'aurait
 * plus de sens une fois la chaîne décalée.
 */
export async function skipCurrentTurn(workspaceId: string, periodStart: string) {
	await db.transaction(async (tx) => {
		await tx
			.update(workspace)
			.set({ supportRotationOffset: sql`${workspace.supportRotationOffset} + 1` })
			.where(eq(workspace.id, workspaceId));
		await tx
			.delete(supportOverride)
			.where(and(eq(supportOverride.workspaceId, workspaceId), eq(supportOverride.periodStart, periodStart)));
	});
	await refreshDutyLog(workspaceId, periodStart);
}

/** Remplace la personne calculée pour cette période précise, sans toucher à l'ordre de rotation. */
export async function setOverride(workspaceId: string, periodStart: string, userId: string) {
	const [m] = await db
		.select({ id: supportRotationMember.id })
		.from(supportRotationMember)
		.where(and(eq(supportRotationMember.workspaceId, workspaceId), eq(supportRotationMember.userId, userId)));
	if (!m) throw new Error("Cette personne n'est pas dans la rotation.");
	await db
		.insert(supportOverride)
		.values({ workspaceId, periodStart, userId })
		.onConflictDoUpdate({ target: [supportOverride.workspaceId, supportOverride.periodStart], set: { userId } });
	await refreshDutyLog(workspaceId, periodStart);
}

export async function clearOverride(workspaceId: string, periodStart: string) {
	await db
		.delete(supportOverride)
		.where(and(eq(supportOverride.workspaceId, workspaceId), eq(supportOverride.periodStart, periodStart)));
	await refreshDutyLog(workspaceId, periodStart);
}

/**
 * Fige qui est de perm aujourd'hui dans supportDutyLog (une ligne par période, cf. schema.ts) —
 * appelé par le cron quotidien /api/jobs/support-duty. Idempotent (onConflictDoNothing sur
 * workspaceId+periodStart) : plusieurs passages sur la même période n'écrivent qu'une fois.
 * Ne journalise rien si la perm est désactivée ou la rotation vide, pour ne pas polluer
 * l'historique de wrapped (cf. computeSupportCount) avec une perm éteinte à l'époque.
 */
export async function logDutyForToday(workspaceId: string, todayISO: string = todayInParis()): Promise<boolean> {
	const { enabled, cadence, offset, includeSaturday } = await getSupportConfig(workspaceId);
	if (!enabled) return false;
	const members = await listRotationMembers(workspaceId);
	if (members.length === 0) return false;

	const { start, end } = currentSupportPeriod(cadence, todayISO, includeSaturday);
	const duty = await pickDuty(cadence, members, offset, start, end, includeSaturday, workspaceId);
	await db.insert(supportDutyLog).values({ workspaceId, periodStart: start, userId: duty.userId }).onConflictDoNothing();
	return true;
}

/** Cron quotidien : journalise la perm du jour pour un espace, ou tous si non précisé. */
export async function runSupportDutyLog(dateISO: string, workspaceId?: string): Promise<{ workspaces: number; logged: number }> {
	const workspaces = await db
		.select({ id: workspace.id })
		.from(workspace)
		.where(workspaceId ? eq(workspace.id, workspaceId) : undefined);

	let logged = 0;
	for (const ws of workspaces) {
		if (await logDutyForToday(ws.id, dateISO)) logged++;
	}
	return { workspaces: workspaces.length, logged };
}
