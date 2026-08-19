import { and, eq, ne, isNull, count, sql } from 'drizzle-orm';
import { db, category, activity, timeEntry, state, ticket, ticketActivityRae, ssp } from '$lib/server/db';

export type CategoryKind = 'PRODUCTIVE' | 'NON_PRODUCTIVE';
export type CategoryItem = {
	id: string;
	label: string;
	kind: CategoryKind;
	archived: boolean;
	usage: number;
	/** Requise par le suivi des absences (cf. absences.ts) — ne peut pas être archivée. */
	locked: boolean;
};
export type ActivityItem = { id: string; label: string; archived: boolean; usage: number };

const kindOf = (v: unknown): CategoryKind => (v === 'NON_PRODUCTIVE' ? 'NON_PRODUCTIVE' : 'PRODUCTIVE');

/** Rejette un label déjà pris par un item actif (insensible à la casse) dans l'espace. */
async function assertUniqueLabel(
	table: typeof category | typeof activity,
	workspaceId: string,
	trimmed: string,
	excludeId: string | null
) {
	const conds = [
		eq(table.workspaceId, workspaceId),
		isNull(table.archivedAt),
		sql`lower(${table.label}) = ${trimmed.toLowerCase()}`
	];
	if (excludeId) conds.push(ne(table.id, excludeId));
	const dup = await db
		.select({ id: table.id })
		.from(table)
		.where(and(...conds))
		.limit(1);
	if (dup.length) throw new Error('Un élément actif porte déjà ce nom.');
}

// ---------- Catégories ----------

export async function listCategories(workspaceId: string): Promise<CategoryItem[]> {
	const rows = await db
		.select({
			id: category.id,
			label: category.label,
			kind: category.kind,
			archivedAt: category.archivedAt,
			linkedAbsenceType: category.linkedAbsenceType,
			usage: count(timeEntry.id)
		})
		.from(category)
		.leftJoin(timeEntry, eq(timeEntry.categoryId, category.id))
		.where(eq(category.workspaceId, workspaceId))
		.groupBy(category.id, category.label, category.kind, category.archivedAt, category.linkedAbsenceType)
		.orderBy(category.label);
	return rows.map((r) => ({
		id: r.id,
		label: r.label,
		kind: kindOf(r.kind),
		archived: r.archivedAt !== null,
		usage: r.usage,
		locked: r.linkedAbsenceType !== null
	}));
}

export async function createCategory(workspaceId: string, label: string, kind: CategoryKind) {
	const trimmed = label.trim();
	if (!trimmed) throw new Error('Nom requis.');
	await assertUniqueLabel(category, workspaceId, trimmed, null);
	await db.insert(category).values({ workspaceId, label: trimmed, kind: kindOf(kind) });
}

export async function renameCategory(workspaceId: string, id: string, label: string) {
	const trimmed = label.trim();
	if (!trimmed) throw new Error('Nom requis.');
	await assertUniqueLabel(category, workspaceId, trimmed, id);
	const res = await db
		.update(category)
		.set({ label: trimmed })
		.where(and(eq(category.id, id), eq(category.workspaceId, workspaceId)))
		.returning({ id: category.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}

export async function setCategoryKind(workspaceId: string, id: string, kind: CategoryKind) {
	const res = await db
		.update(category)
		.set({ kind: kindOf(kind) })
		.where(and(eq(category.id, id), eq(category.workspaceId, workspaceId)))
		.returning({ id: category.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}

export async function setCategoryArchived(workspaceId: string, id: string, archived: boolean) {
	if (archived) {
		const [existing] = await db
			.select({ linkedAbsenceType: category.linkedAbsenceType })
			.from(category)
			.where(and(eq(category.id, id), eq(category.workspaceId, workspaceId)));
		if (existing?.linkedAbsenceType) throw new Error('Catégorie requise par le suivi des absences — impossible à archiver.');
	}
	const res = await db
		.update(category)
		.set({ archivedAt: archived ? new Date() : null })
		.where(and(eq(category.id, id), eq(category.workspaceId, workspaceId)))
		.returning({ id: category.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}

// ---------- Codes SSP ----------

export type SspItem = {
	id: string;
	code: string;
	label: string;
	/** Budget alloué en jours, `null` si non renseigné. */
	budgetDays: number | null;
	archived: boolean;
	usage: number;
};

export async function listSsp(workspaceId: string): Promise<SspItem[]> {
	const rows = await db
		.select({
			id: ssp.id,
			code: ssp.code,
			label: ssp.label,
			budgetDays: ssp.budgetDays,
			archivedAt: ssp.archivedAt,
			usage: count(ticket.id)
		})
		.from(ssp)
		.leftJoin(ticket, eq(ticket.sspId, ssp.id))
		.where(eq(ssp.workspaceId, workspaceId))
		.groupBy(ssp.id, ssp.code, ssp.label, ssp.budgetDays, ssp.archivedAt)
		.orderBy(ssp.code);
	return rows.map((r) => ({
		id: r.id,
		code: r.code,
		label: r.label,
		budgetDays: r.budgetDays === null ? null : Number(r.budgetDays),
		archived: r.archivedAt !== null,
		usage: r.usage
	}));
}

/** Rejette un code déjà pris par un SSP actif de l'espace (insensible à la casse, cf. ssp_ws_code_uq). */
async function assertUniqueSspCode(workspaceId: string, code: string, excludeId: string | null) {
	const conds = [
		eq(ssp.workspaceId, workspaceId),
		isNull(ssp.archivedAt),
		sql`lower(${ssp.code}) = ${code.toLowerCase()}`
	];
	if (excludeId) conds.push(ne(ssp.id, excludeId));
	const dup = await db.select({ id: ssp.id }).from(ssp).where(and(...conds)).limit(1);
	if (dup.length) throw new Error('Un code SSP actif porte déjà ce code.');
}

/** `budgetDays` : `null` efface le budget, un nombre le fixe. */
export async function createSsp(workspaceId: string, code: string, label: string, budgetDays: number | null) {
	const c = code.trim();
	const l = label.trim();
	if (!c) throw new Error('Code requis.');
	await assertUniqueSspCode(workspaceId, c, null);
	// Libellé vide : on retombe sur le code plutôt que d'afficher une ligne sans nom.
	await db.insert(ssp).values({
		workspaceId,
		code: c,
		label: l || c,
		budgetDays: budgetDays === null ? null : String(budgetDays)
	});
}

export async function updateSsp(
	workspaceId: string,
	id: string,
	code: string,
	label: string,
	budgetDays: number | null
) {
	const c = code.trim();
	const l = label.trim();
	if (!c) throw new Error('Code requis.');
	await assertUniqueSspCode(workspaceId, c, id);
	const res = await db
		.update(ssp)
		.set({ code: c, label: l || c, budgetDays: budgetDays === null ? null : String(budgetDays) })
		.where(and(eq(ssp.id, id), eq(ssp.workspaceId, workspaceId)))
		.returning({ id: ssp.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}

export async function setSspArchived(workspaceId: string, id: string, archived: boolean) {
	const res = await db
		.update(ssp)
		.set({ archivedAt: archived ? new Date() : null })
		.where(and(eq(ssp.id, id), eq(ssp.workspaceId, workspaceId)))
		.returning({ id: ssp.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}

// ---------- Activités ----------

export async function listActivities(workspaceId: string): Promise<ActivityItem[]> {
	// Deux comptages séparés (imputations + RAE par activité) plutôt qu'un double join, qui
	// multiplierait les lignes et fausserait count(timeEntry.id).
	const [rows, raeCounts] = await Promise.all([
		db
			.select({
				id: activity.id,
				label: activity.label,
				archivedAt: activity.archivedAt,
				usage: count(timeEntry.id)
			})
			.from(activity)
			.leftJoin(timeEntry, eq(timeEntry.activityId, activity.id))
			.where(eq(activity.workspaceId, workspaceId))
			.groupBy(activity.id, activity.label, activity.archivedAt, activity.sortOrder)
			.orderBy(activity.sortOrder),
		db
			.select({ activityId: ticketActivityRae.activityId, n: count(ticketActivityRae.id) })
			.from(ticketActivityRae)
			.innerJoin(activity, eq(ticketActivityRae.activityId, activity.id))
			.where(eq(activity.workspaceId, workspaceId))
			.groupBy(ticketActivityRae.activityId)
	]);
	const raeCountMap = new Map(raeCounts.map((r) => [r.activityId, r.n]));
	return rows.map((r) => ({
		id: r.id,
		label: r.label,
		archived: r.archivedAt !== null,
		usage: r.usage + (raeCountMap.get(r.id) ?? 0)
	}));
}

export async function createActivity(workspaceId: string, label: string) {
	const trimmed = label.trim();
	if (!trimmed) throw new Error('Nom requis.');
	await assertUniqueLabel(activity, workspaceId, trimmed, null);
	const [{ max }] = await db
		.select({ max: sql<number>`coalesce(max(${activity.sortOrder}), -1)` })
		.from(activity)
		.where(eq(activity.workspaceId, workspaceId));
	await db.insert(activity).values({ workspaceId, label: trimmed, sortOrder: Number(max) + 1 });
}

/** Réordonne toutes les activités d'un espace en un seul geste (drag-and-drop), cf. reorderTicketGroups. */
export async function reorderActivities(workspaceId: string, orderedIds: string[]) {
	await db.transaction(async (tx) => {
		for (let i = 0; i < orderedIds.length; i++) {
			await tx
				.update(activity)
				.set({ sortOrder: i })
				.where(and(eq(activity.id, orderedIds[i]), eq(activity.workspaceId, workspaceId)));
		}
	});
}

export async function renameActivity(workspaceId: string, id: string, label: string) {
	const trimmed = label.trim();
	if (!trimmed) throw new Error('Nom requis.');
	await assertUniqueLabel(activity, workspaceId, trimmed, id);
	const res = await db
		.update(activity)
		.set({ label: trimmed })
		.where(and(eq(activity.id, id), eq(activity.workspaceId, workspaceId)))
		.returning({ id: activity.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}

/**
 * Actif/inactif — pas un archivage : une activité inactive n'apparaît plus dans les sélecteurs
 * de nouvelles saisies, mais toutes les données existantes qui la référencent restent intactes.
 * Réutilise la colonne activity.archivedAt existante (non-null = inactif), vocabulaire UI/API seulement.
 */
export async function setActivityActive(workspaceId: string, id: string, active: boolean) {
	const res = await db
		.update(activity)
		.set({ archivedAt: active ? null : new Date() })
		.where(and(eq(activity.id, id), eq(activity.workspaceId, workspaceId)))
		.returning({ id: activity.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}

/** Nombre de références à une activité (imputations + RAE par activité), tous statuts confondus. */
export async function countActivityUsage(workspaceId: string, id: string): Promise<number> {
	const [[{ n: teCount }], [{ n: raeCount }]] = await Promise.all([
		db
			.select({ n: count(timeEntry.id) })
			.from(timeEntry)
			.where(and(eq(timeEntry.workspaceId, workspaceId), eq(timeEntry.activityId, id))),
		db
			.select({ n: count(ticketActivityRae.id) })
			.from(ticketActivityRae)
			.innerJoin(activity, eq(ticketActivityRae.activityId, activity.id))
			.where(and(eq(activity.workspaceId, workspaceId), eq(ticketActivityRae.activityId, id)))
	]);
	return teCount + raeCount;
}

/** Hard delete — réservé au cas où aucun ticket/imputation n'y est lié. */
export async function deleteActivity(workspaceId: string, id: string) {
	const usage = await countActivityUsage(workspaceId, id);
	if (usage > 0) throw new Error('Activité utilisée : désactivez-la plutôt que de la supprimer.');
	const res = await db
		.delete(activity)
		.where(and(eq(activity.id, id), eq(activity.workspaceId, workspaceId)))
		.returning({ id: activity.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}

// ---------- États du workflow ----------

export type StateItem = {
	id: string;
	label: string;
	emoji: string | null;
	color: string | null;
	sortOrder: number;
	usage: number;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function listStates(workspaceId: string): Promise<StateItem[]> {
	const rows = await db
		.select({
			id: state.id,
			label: state.label,
			emoji: state.emoji,
			color: state.color,
			sortOrder: state.sortOrder,
			usage: count(ticket.id)
		})
		.from(state)
		.leftJoin(ticket, and(eq(ticket.stateId, state.id), isNull(ticket.archivedAt)))
		.where(eq(state.workspaceId, workspaceId))
		.groupBy(state.id, state.label, state.emoji, state.color, state.sortOrder)
		.orderBy(state.sortOrder);
	return rows;
}

async function assertUniqueStateLabel(workspaceId: string, trimmed: string, excludeId: string | null) {
	const conds = [
		eq(state.workspaceId, workspaceId),
		sql`lower(${state.label}) = ${trimmed.toLowerCase()}`
	];
	if (excludeId) conds.push(ne(state.id, excludeId));
	const dup = await db.select({ id: state.id }).from(state).where(and(...conds)).limit(1);
	if (dup.length) throw new Error('Un état porte déjà ce nom.');
}

export async function createState(
	workspaceId: string,
	label: string,
	emoji: string,
	color: string
) {
	const trimmed = label.trim();
	if (!trimmed) throw new Error('Nom requis.');
	await assertUniqueStateLabel(workspaceId, trimmed, null);
	const [{ max }] = await db
		.select({ max: sql<number>`coalesce(max(${state.sortOrder}), -1)` })
		.from(state)
		.where(eq(state.workspaceId, workspaceId));
	await db.insert(state).values({
		workspaceId,
		label: trimmed,
		emoji: emoji.trim() || null,
		color: HEX.test(color) ? color : '#94A3B8',
		sortOrder: Number(max) + 1
	});
}

export async function updateState(
	workspaceId: string,
	id: string,
	fields: { label?: string; emoji?: string; color?: string }
) {
	const patch: { label?: string; emoji?: string | null; color?: string } = {};
	if (fields.label !== undefined) {
		const trimmed = fields.label.trim();
		if (!trimmed) throw new Error('Nom requis.');
		await assertUniqueStateLabel(workspaceId, trimmed, id);
		patch.label = trimmed;
	}
	if (fields.emoji !== undefined) patch.emoji = fields.emoji.trim() || null;
	if (fields.color !== undefined) {
		if (!HEX.test(fields.color)) throw new Error('Couleur invalide (hex).');
		patch.color = fields.color;
	}
	if (Object.keys(patch).length === 0) return;
	const res = await db
		.update(state)
		.set(patch)
		.where(and(eq(state.id, id), eq(state.workspaceId, workspaceId)))
		.returning({ id: state.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}

/** Échange l'ordre d'un état avec son voisin (haut/bas). */
export async function moveState(workspaceId: string, id: string, dir: 'up' | 'down') {
	const rows = await db
		.select({ id: state.id, sortOrder: state.sortOrder })
		.from(state)
		.where(eq(state.workspaceId, workspaceId))
		.orderBy(state.sortOrder);
	const idx = rows.findIndex((r) => r.id === id);
	const swap = dir === 'up' ? idx - 1 : idx + 1;
	if (idx < 0 || swap < 0 || swap >= rows.length) return;
	const a = rows[idx];
	const b = rows[swap];
	await db.transaction(async (tx) => {
		await tx.update(state).set({ sortOrder: b.sortOrder }).where(eq(state.id, a.id));
		await tx.update(state).set({ sortOrder: a.sortOrder }).where(eq(state.id, b.id));
	});
}

export async function deleteState(workspaceId: string, id: string) {
	const res = await db
		.delete(state)
		.where(and(eq(state.id, id), eq(state.workspaceId, workspaceId)))
		.returning({ id: state.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}
