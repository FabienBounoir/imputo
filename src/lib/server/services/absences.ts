import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db, absence, user, externalMember } from '$lib/server/db';
import type { AbsenceType, AbsencePeriod } from '$lib/absenceTypes';
import { parseISODate, toISODate, addDays } from '$lib/utils/date';

/** Sujet d'une absence : soit un membre réel, soit un membre externe (jamais les deux). */
export type AbsenceSubject = { userId: string } | { externalMemberId: string };

export type AbsenceRow = {
	id: string;
	/** userId ou externalMemberId — clé unique utilisée pour indexer la grille. */
	subjectId: string;
	startDate: string;
	endDate: string;
	type: AbsenceType;
	period: AbsencePeriod;
};

export type AbsenceWithUser = AbsenceRow & { displayName: string; external: boolean };

const subjectIdExpr = sql<string>`coalesce(${absence.userId}, ${absence.externalMemberId})`;

const absenceSelect = {
	id: absence.id,
	subjectId: subjectIdExpr,
	startDate: absence.startDate,
	endDate: absence.endDate,
	type: absence.type,
	period: absence.period
};

/** Absences d'une personne (compte réel), les plus récentes/à venir en premier. */
export async function listAbsencesForUser(workspaceId: string, userId: string): Promise<AbsenceRow[]> {
	return db
		.select(absenceSelect)
		.from(absence)
		.where(and(eq(absence.workspaceId, workspaceId), eq(absence.userId, userId)))
		.orderBy(desc(absence.startDate));
}

/** Absences de tout l'espace (réels + externes) chevauchant [fromISO, toISO] — synthèse équipe. */
export async function listAbsencesForRange(
	workspaceId: string,
	fromISO: string,
	toISO: string
): Promise<AbsenceWithUser[]> {
	return db
		.select({
			...absenceSelect,
			displayName: sql<string>`coalesce(${user.displayName}, ${externalMember.displayName})`,
			external: sql<boolean>`${absence.externalMemberId} is not null`
		})
		.from(absence)
		.leftJoin(user, eq(absence.userId, user.id))
		.leftJoin(externalMember, eq(absence.externalMemberId, externalMember.id))
		.where(and(eq(absence.workspaceId, workspaceId), lte(absence.startDate, toISO), gte(absence.endDate, fromISO)));
}

export async function createAbsenceFor(
	workspaceId: string,
	subject: AbsenceSubject,
	input: { startDate: string; endDate: string; type: AbsenceType; period: AbsencePeriod }
) {
	if (parseISODate(input.startDate) > parseISODate(input.endDate))
		throw new Error('La date de fin doit être après la date de début.');
	// La demi-journée n'a de sens que pour une plage d'un seul jour.
	const period = input.startDate === input.endDate ? input.period : 'FULL';
	await db.insert(absence).values({
		workspaceId,
		userId: 'userId' in subject ? subject.userId : null,
		externalMemberId: 'externalMemberId' in subject ? subject.externalMemberId : null,
		startDate: input.startDate,
		endDate: input.endDate,
		type: input.type,
		period
	});
}

/** Supprime une absence — son auteur (réel), ou un admin/manager (`canManageOthers`, seul moyen pour un membre externe). */
export async function deleteAbsence(workspaceId: string, requesterId: string, id: string, canManageOthers: boolean) {
	const conditions = [eq(absence.workspaceId, workspaceId), eq(absence.id, id)];
	if (!canManageOthers) conditions.push(eq(absence.userId, requesterId));
	await db.delete(absence).where(and(...conditions));
}

/**
 * Modifie une absence existante (dates/type/demi-journée) — mêmes permissions que la suppression.
 * Ne change jamais le sujet (userId/externalMemberId) : réassigner reviendrait à en créer une autre.
 */
export async function updateAbsence(
	workspaceId: string,
	requesterId: string,
	canManageOthers: boolean,
	id: string,
	input: { startDate: string; endDate: string; type: AbsenceType; period: AbsencePeriod }
) {
	if (parseISODate(input.startDate) > parseISODate(input.endDate))
		throw new Error('La date de fin doit être après la date de début.');
	const period = input.startDate === input.endDate ? input.period : 'FULL';

	const conditions = [eq(absence.workspaceId, workspaceId), eq(absence.id, id)];
	if (!canManageOthers) conditions.push(eq(absence.userId, requesterId));
	const updated = await db
		.update(absence)
		.set({ startDate: input.startDate, endDate: input.endDate, type: input.type, period, updatedAt: new Date() })
		.where(and(...conditions))
		.returning({ id: absence.id });
	if (updated.length === 0) throw new Error('Absence introuvable ou non autorisée.');
}

/** Une cellule de la grille porte toute l'absence (pas juste type/période) pour permettre l'édition en un clic. */
export type AbsenceCell = { id: string; startDate: string; endDate: string; type: AbsenceType; period: AbsencePeriod };
export type AbsenceGrid = Record<string, Record<string, AbsenceCell>>;

/**
 * Grille sujet → jour → absence, pour la synthèse équipe et l'export. Fonction pure (pas de
 * DB) : chaque plage [startDate, endDate] est expansée jour par jour et ne garde que les jours
 * présents dans `days`.
 */
export function buildAbsenceGrid(absences: AbsenceWithUser[], days: string[]): AbsenceGrid {
	const grid: AbsenceGrid = {};
	const daySet = new Set(days);
	for (const a of absences) {
		const cell: AbsenceCell = { id: a.id, startDate: a.startDate, endDate: a.endDate, type: a.type, period: a.period };
		let d = parseISODate(a.startDate);
		let iso = toISODate(d);
		while (iso <= a.endDate) {
			if (daySet.has(iso)) (grid[a.subjectId] ??= {})[iso] = cell;
			d = addDays(d, 1);
			iso = toISODate(d);
		}
	}
	return grid;
}

// ---------- Membres externes ----------
export type ExternalMemberRow = { id: string; displayName: string };

/** Membres externes actifs de l'espace (clients, prestataires…), triés par nom. */
export async function listExternalMembers(workspaceId: string): Promise<ExternalMemberRow[]> {
	return db
		.select({ id: externalMember.id, displayName: externalMember.displayName })
		.from(externalMember)
		.where(and(eq(externalMember.workspaceId, workspaceId), isNull(externalMember.archivedAt)))
		.orderBy(externalMember.displayName);
}

export async function addExternalMember(workspaceId: string, displayName: string) {
	const name = displayName.trim();
	if (!name) throw new Error('Nom requis.');
	await db.insert(externalMember).values({ workspaceId, displayName: name });
}

/** Archive (retire des listes actives) — conserve l'historique des absences déjà déclarées. */
export async function archiveExternalMember(workspaceId: string, id: string) {
	await db
		.update(externalMember)
		.set({ archivedAt: new Date() })
		.where(and(eq(externalMember.workspaceId, workspaceId), eq(externalMember.id, id)));
}
