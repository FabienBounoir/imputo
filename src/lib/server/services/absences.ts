import { and, asc, desc, eq, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, absence, user, externalMember, category, timeEntry } from '$lib/server/db';
import type { AbsenceType, AbsencePeriod } from '$lib/absenceTypes';
import { parseISODate, toISODate, addDays, workdaysBetween, isPublicHolidayFR } from '$lib/utils/date';
import { logChange } from './changeLog';

// Autorise de passer soit `db`, soit un `tx` de `db.transaction(...)` — sync et création de
// catégorie doivent s'exécuter dans la même transaction que la mutation de l'absence (cf.
// createAbsenceFor/updateAbsence/validateAbsence) : sans ça, un échec du sync laisserait une
// absence "orpheline" déjà commitée en base, jamais répercutée sur l'imputation.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Dbx = typeof db | Tx;

/**
 * Types d'absence répercutés automatiquement dans "Mon imputation" (cf. syncAbsenceEntries) —
 * CONGE_PREVISIONNEL en est exclu tant qu'il n'est pas validé.
 */
const SYNCED_ABSENCE_TYPES = ['CONGE_VALIDE', 'FORMATION', 'HORS_PROJET'] as const;
type SyncedAbsenceType = (typeof SYNCED_ABSENCE_TYPES)[number];

const SYNCED_CATEGORY_DEFAULTS: Record<SyncedAbsenceType, { label: string; kind: 'PRODUCTIVE' | 'NON_PRODUCTIVE' }> = {
	CONGE_VALIDE: { label: 'Congé', kind: 'NON_PRODUCTIVE' },
	FORMATION: { label: 'Formation', kind: 'NON_PRODUCTIVE' },
	HORS_PROJET: { label: 'Hors-projet', kind: 'PRODUCTIVE' }
};

function isSyncedType(type: AbsenceType): type is SyncedAbsenceType {
	return (SYNCED_ABSENCE_TYPES as readonly string[]).includes(type);
}

/** Code SQLSTATE Postgres d'une violation de contrainte unique. */
const UNIQUE_VIOLATION = '23505';

/**
 * Catégorie liée à ce type d'absence — réutilise une catégorie déjà taguée, sinon une catégorie
 * active du même nom (espace créé avant cette fonctionnalité), sinon en crée une. Verrouillée
 * contre l'archivage une fois taguée (cf. params.ts setCategoryArchived).
 */
async function getOrCreateLinkedCategory(dbx: Dbx, workspaceId: string, type: SyncedAbsenceType): Promise<string> {
	const [tagged] = await dbx
		.select({ id: category.id })
		.from(category)
		.where(and(eq(category.workspaceId, workspaceId), eq(category.linkedAbsenceType, type)));
	if (tagged) return tagged.id;

	const def = SYNCED_CATEGORY_DEFAULTS[type];
	const [byLabel] = await dbx
		.select({ id: category.id })
		.from(category)
		.where(
			and(
				eq(category.workspaceId, workspaceId),
				isNull(category.archivedAt),
				sql`lower(${category.label}) = ${def.label.toLowerCase()}`
			)
		);
	if (byLabel) {
		await dbx.update(category).set({ linkedAbsenceType: type }).where(eq(category.id, byLabel.id));
		return byLabel.id;
	}

	try {
		// Savepoint (transaction imbriquée) : sur une violation de contrainte unique, Postgres met
		// le reste de la transaction en échec ("current transaction is aborted") tant qu'on ne
		// revient pas à un point de reprise — sans lui, le SELECT de récupération ci-dessous
		// échouerait à son tour et ferait échouer tout createAbsenceFor/updateAbsence/validateAbsence.
		const [created] = await dbx.transaction((tx2) =>
			tx2.insert(category).values({ workspaceId, label: def.label, kind: def.kind, linkedAbsenceType: type }).returning({ id: category.id })
		);
		return created.id;
	} catch (e) {
		// Deux absences synchronisées pour la toute première fois au même instant sur cet espace :
		// l'autre a gagné la course sur la contrainte unique (workspace_id, linked_absence_type) —
		// on récupère la sienne plutôt que de faire échouer cette validation.
		if ((e as { cause?: { code?: string } })?.cause?.code === UNIQUE_VIOLATION) {
			const [winner] = await dbx
				.select({ id: category.id })
				.from(category)
				.where(and(eq(category.workspaceId, workspaceId), eq(category.linkedAbsenceType, type)));
			if (winner) return winner.id;
		}
		throw e;
	}
}

/**
 * Répercute une absence (créée, modifiée ou validée) sur "Mon imputation" : une ligne par jour
 * ouvré non férié de la plage, sur la catégorie liée au type. Purge + recrée à chaque appel —
 * l'absence reste la source de vérité, pas les cases éventuellement éditées à la main depuis.
 * Sans effet pour un membre externe (pas de compte imputation) ou un congé encore prévisionnel.
 * Les jours fériés sont exclus : ils sont déjà hors capacité (cf. imputation/+page.svelte
 * periodCapacity), les compter en plus fausserait le total saisi et le % de capacité affichés.
 */
async function syncAbsenceEntries(
	dbx: Dbx,
	workspaceId: string,
	row: { id: string; userId: string | null; startDate: string; endDate: string; type: AbsenceType; period: AbsencePeriod }
) {
	await dbx.delete(timeEntry).where(eq(timeEntry.absenceId, row.id));
	if (!row.userId || !isSyncedType(row.type)) return;

	const categoryId = await getOrCreateLinkedCategory(dbx, workspaceId, row.type);
	const days = workdaysBetween(row.startDate, row.endDate).filter((d) => !isPublicHolidayFR(d));
	if (days.length === 0) return;
	const amount = String(row.period === 'FULL' ? 1 : 0.5);

	for (const day of days) {
		const [existing] = await dbx
			.select({ id: timeEntry.id })
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.workspaceId, workspaceId),
					eq(timeEntry.userId, row.userId),
					eq(timeEntry.day, day),
					eq(timeEntry.categoryId, categoryId),
					isNull(timeEntry.activityId)
				)
			);
		if (existing) {
			await dbx
				.update(timeEntry)
				.set({ amount, absenceId: row.id, updatedAt: new Date() })
				.where(eq(timeEntry.id, existing.id));
		} else {
			await dbx.insert(timeEntry).values({
				workspaceId,
				userId: row.userId,
				targetType: 'CATEGORY',
				categoryId,
				day,
				amount,
				absenceId: row.id
			});
		}
	}
}

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

/** Un membre externe n'a personne pour valider son congé en son nom : on le pose directement validé. */
function assertCreatable(startDate: string, endDate: string, subject: AbsenceSubject, type: AbsenceType) {
	if (parseISODate(startDate) > parseISODate(endDate))
		throw new Error('La date de fin doit être après la date de début.');
	if ('externalMemberId' in subject && type === 'CONGE_PREVISIONNEL')
		throw new Error("Un membre externe ne peut avoir qu'un congé validé (pas de congé prévisionnel).");
}

/** Cœur insert + sync, partagé par createAbsenceFor (transaction dédiée) et createHalfDayRangeFor
 * (une transaction commune à tout le lot, cf. plus bas) — `tx` doit toujours venir d'un `db.transaction`. */
async function insertAbsence(
	tx: Tx,
	workspaceId: string,
	subject: AbsenceSubject,
	input: { startDate: string; endDate: string; type: AbsenceType; period: AbsencePeriod }
) {
	// La demi-journée n'a de sens que pour une plage d'un seul jour.
	const period = input.startDate === input.endDate ? input.period : 'FULL';
	const [inserted] = await tx
		.insert(absence)
		.values({
			workspaceId,
			userId: 'userId' in subject ? subject.userId : null,
			externalMemberId: 'externalMemberId' in subject ? subject.externalMemberId : null,
			startDate: input.startDate,
			endDate: input.endDate,
			type: input.type,
			period
		})
		.returning({
			id: absence.id,
			userId: absence.userId,
			startDate: absence.startDate,
			endDate: absence.endDate,
			type: absence.type,
			period: absence.period
		});
	await syncAbsenceEntries(tx, workspaceId, inserted);
	return inserted.id;
}

export async function createAbsenceFor(
	workspaceId: string,
	subject: AbsenceSubject,
	input: { startDate: string; endDate: string; type: AbsenceType; period: AbsencePeriod }
) {
	assertCreatable(input.startDate, input.endDate, subject, input.type);
	// Transaction : si le sync échoue (cf. syncAbsenceEntries), l'absence ne doit pas rester
	// commitée sans ses imputations — sinon elle apparaîtrait créée alors que l'appel a échoué.
	return db.transaction((tx) => insertAbsence(tx, workspaceId, subject, input));
}

/** Plage maximale pour une demi-journée répétée jour par jour (cf. createHalfDayRangeFor) — au-delà,
 * la boucle ferait trop d'allers-retours DB séquentiels pour un cas d'usage réaliste. */
const MAX_HALF_DAY_RANGE_DAYS = 60;

/**
 * Demi-journée appliquée à chaque jour d'une plage (retour utilisateur : "faut faire 1/1" sinon) —
 * une ligne par jour, mais dans UNE seule transaction (tout ou rien), contrairement à N appels
 * séparés de createAbsenceFor qui laisseraient un lot partiellement créé si l'un d'eux échoue.
 */
export async function createHalfDayRangeFor(
	workspaceId: string,
	subject: AbsenceSubject,
	input: { startDate: string; endDate: string; type: AbsenceType; period: AbsencePeriod }
): Promise<string[]> {
	assertCreatable(input.startDate, input.endDate, subject, input.type);
	const days: string[] = [];
	for (let d = parseISODate(input.startDate); toISODate(d) <= input.endDate; d = addDays(d, 1)) days.push(toISODate(d));
	if (days.length > MAX_HALF_DAY_RANGE_DAYS)
		throw new Error(`Plage trop longue pour une demi-journée (max ${MAX_HALF_DAY_RANGE_DAYS} jours).`);
	return db.transaction(async (tx) => {
		const ids: string[] = [];
		for (const day of days)
			ids.push(await insertAbsence(tx, workspaceId, subject, { startDate: day, endDate: day, type: input.type, period: input.period }));
		return ids;
	});
}

/** Supprime une absence — son auteur (réel), un admin (`canManageAll`, n'importe qui), ou un manager
 *  (`canManageExternal`, mais alors seulement la sienne ou celle d'un membre externe). */
export async function deleteAbsence(
	workspaceId: string,
	requesterId: string,
	id: string,
	canManageAll: boolean,
	canManageExternal: boolean
) {
	const conditions = [eq(absence.workspaceId, workspaceId), eq(absence.id, id)];
	if (!canManageAll) {
		conditions.push(
			canManageExternal ? or(eq(absence.userId, requesterId), isNotNull(absence.externalMemberId))! : eq(absence.userId, requesterId)
		);
	}

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
	canManageAll: boolean,
	canManageExternal: boolean,
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
	// Bascule vers validé (typiquement CONGE_PREVISIONNEL → CONGE_VALIDE) réservée à l'admin, sauf
	// pour un membre externe (qui n'a que ça, cf. plus haut) — sinon ce serait un moyen détourné de
	// se valider soi-même sans passer par l'action `validate`. Une absence déjà validée qu'on modifie
	// (dates...) en gardant CONGE_VALIDE n'est PAS une bascule : pas concernée par ce garde-fou.
	if (input.type === 'CONGE_VALIDE' && existing?.type !== 'CONGE_VALIDE' && !existing?.externalMemberId && !canManageAll)
		throw new Error('Passage en congé validé réservé à un admin (ou un manager, pour un membre externe).');

	const conditions = [eq(absence.workspaceId, workspaceId), eq(absence.id, id)];
	if (!canManageAll) {
		conditions.push(
			canManageExternal ? or(eq(absence.userId, requesterId), isNotNull(absence.externalMemberId))! : eq(absence.userId, requesterId)
		);
	}
	// Transaction : voir createAbsenceFor — un échec du sync ne doit pas laisser la modification
	// commitée sans ses imputations à jour.
	await db.transaction(async (tx) => {
		const updated = await tx
			.update(absence)
			.set({ startDate: input.startDate, endDate: input.endDate, type: input.type, period, updatedAt: new Date() })
			.where(and(...conditions))
			.returning({
				id: absence.id,
				userId: absence.userId,
				startDate: absence.startDate,
				endDate: absence.endDate,
				type: absence.type,
				period: absence.period
			});
		if (updated.length === 0) throw new Error('Absence introuvable ou non autorisée.');
		await syncAbsenceEntries(tx, workspaceId, updated[0]);
	});

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
	// Transaction : voir createAbsenceFor — un échec du sync ne doit pas laisser la validation
	// commitée sans l'imputation rétroactive qui va avec.
	return db.transaction(async (tx) => {
		const updated = await tx
			.update(absence)
			.set({ type: 'CONGE_VALIDE', validatedById, validatedAt: now, updatedAt: now })
			.where(and(eq(absence.workspaceId, workspaceId), eq(absence.id, id), eq(absence.type, 'CONGE_PREVISIONNEL')))
			.returning({
				id: absence.id,
				userId: absence.userId,
				startDate: absence.startDate,
				endDate: absence.endDate,
				type: absence.type,
				period: absence.period
			});
		if (updated.length === 0) throw new Error('Absence introuvable ou déjà traitée.');
		await syncAbsenceEntries(tx, workspaceId, updated[0]);
		return updated[0];
	});
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
