import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, absence, user, externalMember } from '$lib/server/db';
import type { AbsenceType, AbsencePeriod } from '$lib/absenceTypes';
import { parseISODate, toISODate, addDays } from '$lib/utils/date';
import { logChange } from './changeLog';

const validator = alias(user, 'absence_validator');

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
	/** Horodatage de dépôt — sert à trancher « qui a imputé en premier » en cas de conflit de dates. */
	createdAt: Date;
	/** Renseignés uniquement une fois validé (type CONGE_VALIDE) — qui et quand. */
	validatedAt: Date | null;
	validatedByName: string | null;
};

export type AbsenceWithUser = AbsenceRow & { displayName: string; external: boolean };

const subjectIdExpr = sql<string>`coalesce(${absence.userId}, ${absence.externalMemberId})`;

const absenceSelect = {
	id: absence.id,
	subjectId: subjectIdExpr,
	startDate: absence.startDate,
	endDate: absence.endDate,
	type: absence.type,
	period: absence.period,
	createdAt: absence.createdAt,
	validatedAt: absence.validatedAt,
	validatedByName: validator.displayName
};

/** Absences d'une personne (compte réel), les plus récentes/à venir en premier. */
export async function listAbsencesForUser(workspaceId: string, userId: string): Promise<AbsenceRow[]> {
	return db
		.select(absenceSelect)
		.from(absence)
		.leftJoin(validator, eq(absence.validatedById, validator.id))
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
		.leftJoin(validator, eq(absence.validatedById, validator.id))
		.where(and(eq(absence.workspaceId, workspaceId), lte(absence.startDate, toISO), gte(absence.endDate, fromISO)));
}

/** Congés prévisionnels en attente de validation, tout l'espace confondu — la « liste d'actions » admin/manager. */
export async function listPendingAbsences(workspaceId: string): Promise<AbsenceWithUser[]> {
	return db
		.select({
			...absenceSelect,
			displayName: sql<string>`coalesce(${user.displayName}, ${externalMember.displayName})`,
			external: sql<boolean>`${absence.externalMemberId} is not null`
		})
		.from(absence)
		.leftJoin(user, eq(absence.userId, user.id))
		.leftJoin(externalMember, eq(absence.externalMemberId, externalMember.id))
		.leftJoin(validator, eq(absence.validatedById, validator.id))
		.where(and(eq(absence.workspaceId, workspaceId), eq(absence.type, 'CONGE_PREVISIONNEL')))
		.orderBy(asc(absence.startDate));
}

/** Nombre de congés en attente de validation — pour le badge de nav admin/manager. */
export async function countPendingAbsences(workspaceId: string): Promise<number> {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(absence)
		.where(and(eq(absence.workspaceId, workspaceId), eq(absence.type, 'CONGE_PREVISIONNEL')));
	return row?.count ?? 0;
}

export async function createAbsenceFor(
	workspaceId: string,
	subject: AbsenceSubject,
	input: { startDate: string; endDate: string; type: AbsenceType; period: AbsencePeriod }
) {
	if (parseISODate(input.startDate) > parseISODate(input.endDate))
		throw new Error('La date de fin doit être après la date de début.');
	// Un membre externe n'a personne pour valider son congé en son nom : on le pose directement validé.
	if ('externalMemberId' in subject && input.type === 'CONGE_PREVISIONNEL')
		throw new Error("Un membre externe ne peut avoir qu'un congé validé (pas de congé prévisionnel).");
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

	// Capturée avant suppression : la ligne source disparaît, mais la trace doit rester lisible.
	const [existing] = await db
		.select({ startDate: absence.startDate, endDate: absence.endDate, type: absence.type })
		.from(absence)
		.where(and(...conditions));

	await db.delete(absence).where(and(...conditions));

	if (existing) {
		await logChange({
			workspaceId,
			entityType: 'ABSENCE',
			entityId: id,
			action: 'DELETE',
			oldValue: `${existing.startDate} → ${existing.endDate} (${existing.type})`,
			newValue: null,
			changedById: requesterId
		});
	}
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

	const [existing] = await db
		.select({
			externalMemberId: absence.externalMemberId,
			startDate: absence.startDate,
			endDate: absence.endDate,
			type: absence.type,
			period: absence.period
		})
		.from(absence)
		.where(and(eq(absence.workspaceId, workspaceId), eq(absence.id, id)));

	if (input.type === 'CONGE_PREVISIONNEL' && existing?.externalMemberId)
		throw new Error("Un membre externe ne peut avoir qu'un congé validé (pas de congé prévisionnel).");

	const conditions = [eq(absence.workspaceId, workspaceId), eq(absence.id, id)];
	if (!canManageOthers) conditions.push(eq(absence.userId, requesterId));
	const updated = await db
		.update(absence)
		.set({ startDate: input.startDate, endDate: input.endDate, type: input.type, period, updatedAt: new Date() })
		.where(and(...conditions))
		.returning({ id: absence.id });
	if (updated.length === 0) throw new Error('Absence introuvable ou non autorisée.');

	if (existing) {
		const changes: { field: string; oldValue: string; newValue: string }[] = [
			{ field: 'startDate', oldValue: existing.startDate, newValue: input.startDate },
			{ field: 'endDate', oldValue: existing.endDate, newValue: input.endDate },
			{ field: 'type', oldValue: existing.type, newValue: input.type },
			{ field: 'period', oldValue: existing.period, newValue: period }
		].filter((c) => c.oldValue !== c.newValue);
		for (const c of changes) {
			await logChange({
				workspaceId,
				entityType: 'ABSENCE',
				entityId: id,
				field: c.field,
				action: 'UPDATE',
				oldValue: c.oldValue,
				newValue: c.newValue,
				changedById: requesterId
			});
		}
	}
}

/** Passe un congé prévisionnel en validé — réservé admin/manager (vérifié par l'appelant). */
export async function validateAbsence(workspaceId: string, id: string, validatedById: string) {
	const now = new Date();
	const updated = await db
		.update(absence)
		.set({ type: 'CONGE_VALIDE', validatedById, validatedAt: now, updatedAt: now })
		.where(and(eq(absence.workspaceId, workspaceId), eq(absence.id, id), eq(absence.type, 'CONGE_PREVISIONNEL')))
		.returning({ id: absence.id });
	if (updated.length === 0) throw new Error('Absence introuvable ou déjà traitée.');
}

/** Une cellule de la grille porte toute l'absence (pas juste type/période) pour permettre l'édition en un clic. */
export type AbsenceCell = {
	id: string;
	startDate: string;
	endDate: string;
	type: AbsenceType;
	period: AbsencePeriod;
	createdAt: Date;
	validatedAt: Date | null;
	validatedByName: string | null;
};
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
		const cell: AbsenceCell = {
			id: a.id,
			startDate: a.startDate,
			endDate: a.endDate,
			type: a.type,
			period: a.period,
			createdAt: a.createdAt,
			validatedAt: a.validatedAt,
			validatedByName: a.validatedByName
		};
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
