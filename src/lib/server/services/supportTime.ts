import { and, eq, desc, gte, lte, lt, or, sql } from 'drizzle-orm';
import { db, workspace, supportTimeEntry, user } from '$lib/server/db';
import { todayInParis } from '$lib/utils/date';

/**
 * Temps passé sur un ticket de support (cf. workspace.supportTimeTrackingEnabled) — donnée que
 * l'entreprise ne trace nulle part ailleurs. `ticketRef` est un identifiant libre, jamais une FK
 * vers `ticket` : ces demandes de support vivent hors Imputo. Chacun ne corrige que ses propres
 * saisies, même un admin — décision produit, pas une limite technique.
 */

export type SupportTimeEntryRow = {
	id: string;
	userId: string;
	userDisplayName: string;
	ticketRef: string;
	minutes: number;
	day: string;
	createdAt: Date;
	updatedAt: Date;
};

/** Filtre commun aux vues agrégées/paginées/export — période sur `day` (bornes incluses) + personne. */
export type SupportTimeFilter = { from?: string; to?: string; userId?: string };

export type SupportPersonStats = { userId: string; name: string; minutes: number; entries: number; tickets: number };
export type SupportTicketStats = { ticketRef: string; minutes: number; entries: number; people: number };
export type SupportTimeStats = {
	totalMinutes: number;
	entryCount: number;
	distinctTickets: number;
	distinctPeople: number;
	byPerson: SupportPersonStats[];
	byTicket: SupportTicketStats[];
};

export type SupportTimeCursor = { day: string; createdAt: string; id: string };
export type SupportTimePage = { entries: SupportTimeEntryRow[]; nextCursor: SupportTimeCursor | null };

export async function isSupportTimeTrackingEnabled(workspaceId: string): Promise<boolean> {
	const [row] = await db
		.select({ enabled: workspace.supportTimeTrackingEnabled })
		.from(workspace)
		.where(eq(workspace.id, workspaceId));
	return row?.enabled ?? false;
}

const ENTRY_COLUMNS = {
	id: supportTimeEntry.id,
	userId: supportTimeEntry.userId,
	userDisplayName: user.displayName,
	ticketRef: supportTimeEntry.ticketRef,
	minutes: supportTimeEntry.minutes,
	day: supportTimeEntry.day,
	createdAt: supportTimeEntry.createdAt,
	updatedAt: supportTimeEntry.updatedAt
};

function filterConditions(workspaceId: string, filter: SupportTimeFilter) {
	const conditions = [eq(supportTimeEntry.workspaceId, workspaceId)];
	if (filter.from) conditions.push(gte(supportTimeEntry.day, filter.from));
	if (filter.to) conditions.push(lte(supportTimeEntry.day, filter.to));
	if (filter.userId) conditions.push(eq(supportTimeEntry.userId, filter.userId));
	return and(...conditions)!;
}

/** `day` par défaut = aujourd'hui (heure de Paris) — la saisie rapide (raccourci global) ne
 * propose pas de date, seule l'édition sur /support permet de la corriger après coup. */
export async function createTimeEntry(
	workspaceId: string,
	userId: string,
	data: { ticketRef: string; minutes: number; day?: string }
): Promise<{ id: string }> {
	const ticketRef = data.ticketRef.trim();
	if (!ticketRef) throw new Error('Identifiant de ticket requis.');
	if (!Number.isFinite(data.minutes) || data.minutes <= 0) throw new Error('Durée invalide.');
	const [row] = await db
		.insert(supportTimeEntry)
		.values({ workspaceId, userId, ticketRef, minutes: Math.round(data.minutes), day: data.day ?? todayInParis() })
		.returning({ id: supportTimeEntry.id });
	return row;
}

/** Ses propres saisies, les plus récentes d'abord — bornées (`limit`) : une vue courte, pas l'historique complet. */
export async function listOwnTimeEntries(workspaceId: string, userId: string, limit = 20): Promise<SupportTimeEntryRow[]> {
	return db
		.select(ENTRY_COLUMNS)
		.from(supportTimeEntry)
		.innerJoin(user, eq(supportTimeEntry.userId, user.id))
		.where(and(eq(supportTimeEntry.workspaceId, workspaceId), eq(supportTimeEntry.userId, userId)))
		.orderBy(desc(supportTimeEntry.day), desc(supportTimeEntry.createdAt))
		.limit(limit);
}

/** Dump complet (non paginé) sur le filtre donné — réservé à l'export Excel, qui a besoin de tout charger. */
export async function listAllTimeEntries(workspaceId: string, filter: SupportTimeFilter = {}): Promise<SupportTimeEntryRow[]> {
	return db
		.select(ENTRY_COLUMNS)
		.from(supportTimeEntry)
		.innerJoin(user, eq(supportTimeEntry.userId, user.id))
		.where(filterConditions(workspaceId, filter))
		.orderBy(desc(supportTimeEntry.day), desc(supportTimeEntry.createdAt));
}

/**
 * Page de saisies (vue admin "Historique complet") par curseur (day, createdAt, id) — jamais
 * d'offset : sur plusieurs années de saisies, un scroll infini par curseur reste correct même si
 * de nouvelles lignes s'ajoutent pendant la consultation (cf. listWorkspaceHistoryPage, même motif).
 */
export async function listTimeEntriesPage(
	workspaceId: string,
	filter: SupportTimeFilter,
	opts: { cursor?: SupportTimeCursor; limit?: number } = {}
): Promise<SupportTimePage> {
	const limit = opts.limit ?? 50;
	const conditions = [filterConditions(workspaceId, filter)];
// Postgres stocke created_at à la microseconde, mais le driver le rend en `Date` JS (milliseconde)
// et le curseur repart en ISO — donc tronqué. Comparer ce curseur tronqué à la colonne brute fait
// SAUTER des lignes : la dernière ligne d'une page à .834606 produit un curseur .834000, et la
// ligne suivante à .834200 satisfait ni `< .834000` ni `= .834000`. On tronque donc des DEUX côtés
// (tri et comparaison) pour que SQL et le curseur parlent de la même valeur ; l'ordre à l'intérieur
// d'une milliseconde est alors départagé par l'id, comme prévu.
	const createdAtMs = sql`date_trunc('milliseconds', ${supportTimeEntry.createdAt})`;
	if (opts.cursor) {
		const { day, createdAt, id } = opts.cursor;
		// Cast explicite : comparé à une expression SQL (et non à une colonne typée), drizzle ne sait
		// pas sérialiser un objet Date — on passe donc l'ISO du curseur tel quel.
		const c = sql`${new Date(createdAt).toISOString()}::timestamptz`;
		conditions.push(
			or(
				lt(supportTimeEntry.day, day),
				and(eq(supportTimeEntry.day, day), lt(createdAtMs, c)),
				and(eq(supportTimeEntry.day, day), eq(createdAtMs, c), lt(supportTimeEntry.id, id))
			)!
		);
	}
	const rows = await db
		.select(ENTRY_COLUMNS)
		.from(supportTimeEntry)
		.innerJoin(user, eq(supportTimeEntry.userId, user.id))
		.where(and(...conditions))
		.orderBy(desc(supportTimeEntry.day), desc(createdAtMs), desc(supportTimeEntry.id))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const entries = hasMore ? rows.slice(0, limit) : rows;
	const last = entries[entries.length - 1];
	return {
		entries,
		nextCursor: hasMore && last ? { day: last.day, createdAt: last.createdAt.toISOString(), id: last.id } : null
	};
}

/**
 * Stats agrégées côté SQL (jamais en mémoire) : KPIs + répartition par personne / par ticket sur
 * le filtre donné. Pense au long terme — sur plusieurs années de saisies, charger toutes les lignes
 * pour les additionner en JS ne passerait pas à l'échelle.
 */
export async function getSupportTimeStats(
	workspaceId: string,
	filter: SupportTimeFilter = {},
	opts: { includeByTicket?: boolean } = {}
): Promise<SupportTimeStats> {
	const { includeByTicket = true } = opts;
	const where = filterConditions(workspaceId, filter);

	const [totals] = await db
		.select({
			totalMinutes: sql<string>`coalesce(sum(${supportTimeEntry.minutes}), 0)`,
			entryCount: sql<string>`count(*)`,
			distinctTickets: sql<string>`count(distinct ${supportTimeEntry.ticketRef})`,
			distinctPeople: sql<string>`count(distinct ${supportTimeEntry.userId})`
		})
		.from(supportTimeEntry)
		.where(where);

	const byPersonRows = await db
		.select({
			userId: supportTimeEntry.userId,
			name: user.displayName,
			minutes: sql<string>`sum(${supportTimeEntry.minutes})`,
			entries: sql<string>`count(*)`,
			tickets: sql<string>`count(distinct ${supportTimeEntry.ticketRef})`
		})
		.from(supportTimeEntry)
		.innerJoin(user, eq(supportTimeEntry.userId, user.id))
		.where(where)
		.groupBy(supportTimeEntry.userId, user.displayName)
		.orderBy(desc(sql`sum(${supportTimeEntry.minutes})`));

	// Contrairement aux personnes (bornées par la taille de l'équipe), le nombre de tickets de
	// support distincts n'a pas de plafond naturel — des années de saisies peuvent en accumuler des
	// milliers. Cette répartition ne sert donc qu'à l'export Excel (choix explicite, période bornée
	// par l'admin) ; l'écran (`includeByTicket: false`) ne la demande même pas.
	const byTicketRows = includeByTicket
		? await db
				.select({
					ticketRef: supportTimeEntry.ticketRef,
					minutes: sql<string>`sum(${supportTimeEntry.minutes})`,
					entries: sql<string>`count(*)`,
					people: sql<string>`count(distinct ${supportTimeEntry.userId})`
				})
				.from(supportTimeEntry)
				.where(where)
				.groupBy(supportTimeEntry.ticketRef)
				.orderBy(desc(sql`sum(${supportTimeEntry.minutes})`))
		: [];

	return {
		totalMinutes: Number(totals?.totalMinutes ?? 0),
		entryCount: Number(totals?.entryCount ?? 0),
		distinctTickets: Number(totals?.distinctTickets ?? 0),
		distinctPeople: Number(totals?.distinctPeople ?? 0),
		byPerson: byPersonRows.map((r) => ({ userId: r.userId, name: r.name, minutes: Number(r.minutes), entries: Number(r.entries), tickets: Number(r.tickets) })),
		byTicket: byTicketRows.map((r) => ({ ticketRef: r.ticketRef, minutes: Number(r.minutes), entries: Number(r.entries), people: Number(r.people) }))
	};
}

/** Personnes ayant au moins une saisie (toutes périodes confondues) — options du filtre "Personne". */
export async function listPeopleWithEntries(workspaceId: string): Promise<{ userId: string; name: string }[]> {
	const rows = await db
		.selectDistinct({ userId: supportTimeEntry.userId, name: user.displayName })
		.from(supportTimeEntry)
		.innerJoin(user, eq(supportTimeEntry.userId, user.id))
		.where(eq(supportTimeEntry.workspaceId, workspaceId))
		.orderBy(user.displayName);
	return rows;
}

/** Modifie une saisie — seulement la sienne, même pour un admin (cf. commentaire de fichier). */
export async function updateTimeEntry(
	workspaceId: string,
	userId: string,
	entryId: string,
	data: { ticketRef: string; minutes: number; day: string }
): Promise<void> {
	const ticketRef = data.ticketRef.trim();
	if (!ticketRef) throw new Error('Identifiant de ticket requis.');
	if (!Number.isFinite(data.minutes) || data.minutes <= 0) throw new Error('Durée invalide.');
	const result = await db
		.update(supportTimeEntry)
		.set({ ticketRef, minutes: Math.round(data.minutes), day: data.day, updatedAt: new Date() })
		.where(
			and(
				eq(supportTimeEntry.id, entryId),
				eq(supportTimeEntry.workspaceId, workspaceId),
				eq(supportTimeEntry.userId, userId)
			)
		)
		.returning({ id: supportTimeEntry.id });
	if (result.length === 0) throw new Error("Saisie introuvable, ou vous n'en êtes pas l'auteur.");
}
