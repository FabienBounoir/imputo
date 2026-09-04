import { and, eq, ne, isNull, inArray, count, sql } from 'drizzle-orm';
import {
	db,
	perimeter,
	perimeterMember,
	membership,
	ticket,
	user,
	type Role,
	type PerimeterRole
} from '$lib/server/db';

/**
 * Périmètres applicatifs — sous-scope DANS l'espace.
 *
 * L'espace (`workspaceId`) reste la frontière d'isolation : toute fonction d'ici l'exige et
 * l'applique, exactement comme les autres services. Le périmètre s'ajoute PAR-DESSUS, il ne
 * remplace jamais ce filtre — `canLead()` n'est évalué qu'une fois le workspace déjà contraint.
 *
 * Le rôle d'espace (`membership.role`) ne bouge pas. Le périmètre est une élévation :
 *   - DP        = membership.role ADMIN        → lead implicite de TOUS les périmètres
 *   - CP/backup = perimeterMember.role CP|CP_BACKUP → droits MANAGER sur SES périmètres
 *   - collaborateur = USER + CONTRIBUTOR sur N périmètres
 */

// ---------- Contexte de requête ----------

export type PerimeterInfo = {
	id: string;
	name: string;
	color: string | null;
	transverse: boolean;
	role: PerimeterRole;
};

export type PerimeterCtx = {
	role: Role | null;
	/** Directeur de projet : ADMIN de l'espace, donc lead partout sans rattachement explicite. */
	isDp: boolean;
	/** Périmètres où l'utilisateur est CP ou backup. Vide pour un DP : `isDp` suffit. */
	leadPerimeterIds: Set<string>;
	/** Tous les périmètres où l'utilisateur est rattaché, quel que soit son rôle dedans. */
	memberPerimeterIds: Set<string>;
	/** Détail affichable (pastilles, libellés) — ordonné comme les périmètres de l'espace. */
	perimeters: PerimeterInfo[];
};

export const EMPTY_PERIMETER_CTX: PerimeterCtx = {
	role: null,
	isDp: false,
	leadPerimeterIds: new Set(),
	memberPerimeterIds: new Set(),
	perimeters: []
};

/** CP et backup ont exactement les mêmes pouvoirs — seul l'affichage les distingue. */
export function isLeadRole(role: PerimeterRole): boolean {
	return role === 'CP' || role === 'CP_BACKUP';
}

/**
 * Peut-il agir comme CP sur ce périmètre ? Le DP, oui, partout — c'est la traduction directe de
 * « le DP doit pouvoir intervenir comme un CP du périmètre ».
 * `perimeterId` null (jamais le cas d'un ticket, qui est NOT NULL) répond false : on n'accorde
 * pas un droit sur une cible dont on ne sait pas à qui elle appartient.
 */
export function canLead(ctx: PerimeterCtx, perimeterId: string | null): boolean {
	if (ctx.isDp) return true;
	return perimeterId !== null && ctx.leadPerimeterIds.has(perimeterId);
}

/**
 * Portée de lead passée aux services : soit le contexte d'un utilisateur réel, soit `'SYSTEM'` pour
 * un appelant sans rôle courant (cron de snapshot, jobs de notification, export planifié) qui doit
 * voir les données non redactées. Remplace l'ancien booléen `isAdmin`, devenu insuffisant : la
 * visibilité des champs budget se décide désormais ticket par ticket, selon SON périmètre.
 */
export type LeadScopeArg = PerimeterCtx | 'SYSTEM';

export function canLeadArg(arg: LeadScopeArg, perimeterId: string | null): boolean {
	return arg === 'SYSTEM' || canLead(arg, perimeterId);
}

/** Pendant de `leadScope` pour une portée qui peut être 'SYSTEM' (laquelle ne restreint rien). */
export function leadScopeArg(arg: LeadScopeArg): 'ALL' | string[] {
	return arg === 'SYSTEM' ? 'ALL' : leadScope(arg);
}

/** `'ALL'` = aucune restriction (DP). Sinon la liste des périmètres pilotés, possiblement vide. */
export function leadScope(ctx: PerimeterCtx): 'ALL' | string[] {
	return ctx.isDp ? 'ALL' : [...ctx.leadPerimeterIds];
}

/** true dès qu'il y a quelque chose à piloter — sert à afficher/masquer les écrans de pilotage. */
export function hasLeadScope(ctx: PerimeterCtx): boolean {
	return ctx.isDp || ctx.leadPerimeterIds.size > 0;
}

/**
 * Charge le contexte périmètre d'un utilisateur dans un espace. Appelé par hooks.server.ts à
 * chaque requête authentifiée : une seule requête, couverte par `perimeter_member_ws_user_idx`.
 */
export async function loadPerimeterCtx(
	workspaceId: string,
	userId: string,
	role: Role | null
): Promise<PerimeterCtx> {
	const rows = await db
		.select({
			id: perimeter.id,
			name: perimeter.name,
			color: perimeter.color,
			transverse: perimeter.transverse,
			role: perimeterMember.role
		})
		.from(perimeterMember)
		.innerJoin(perimeter, eq(perimeterMember.perimeterId, perimeter.id))
		.where(
			and(
				eq(perimeterMember.workspaceId, workspaceId),
				eq(perimeterMember.userId, userId),
				isNull(perimeter.archivedAt)
			)
		)
		.orderBy(perimeter.sortOrder, perimeter.name);

	return {
		role,
		isDp: role === 'ADMIN',
		leadPerimeterIds: new Set(rows.filter((r) => isLeadRole(r.role)).map((r) => r.id)),
		memberPerimeterIds: new Set(rows.map((r) => r.id)),
		perimeters: rows
	};
}

/**
 * Les personnes rattachées à ces périmètres — c'est « les collaborateurs qui interviennent sur mon
 * périmètre », la population qu'un CP a le droit de consulter. Retourne [] si `perimeterIds` est
 * vide : surtout ne pas interpréter une liste vide comme « tout le monde ».
 */
export async function listPerimeterCollaborators(
	workspaceId: string,
	perimeterIds: string[]
): Promise<string[]> {
	if (perimeterIds.length === 0) return [];
	const rows = await db
		.selectDistinct({ userId: perimeterMember.userId })
		.from(perimeterMember)
		.where(
			and(
				eq(perimeterMember.workspaceId, workspaceId),
				inArray(perimeterMember.perimeterId, perimeterIds)
			)
		);
	return rows.map((r) => r.userId);
}

// ---------- Lecture ----------

export type PerimeterMemberItem = {
	userId: string;
	displayName: string;
	role: PerimeterRole;
};

export type PerimeterItem = {
	id: string;
	name: string;
	color: string | null;
	transverse: boolean;
	sortOrder: number;
	archived: boolean;
	/** Tickets actifs rattachés — bloque l'archivage tant qu'il en reste. */
	ticketCount: number;
	members: PerimeterMemberItem[];
};

/** Périmètres actifs, pour les pickers et les filtres. */
export async function listActivePerimeters(workspaceId: string) {
	return db
		.select({
			id: perimeter.id,
			name: perimeter.name,
			color: perimeter.color,
			transverse: perimeter.transverse
		})
		.from(perimeter)
		.where(and(eq(perimeter.workspaceId, workspaceId), isNull(perimeter.archivedAt)))
		.orderBy(perimeter.sortOrder, perimeter.name);
}

/** Vue complète pour l'écran d'administration (archivés compris). */
export async function listPerimeters(workspaceId: string): Promise<PerimeterItem[]> {
	const [rows, memberRows] = await Promise.all([
		db
			.select({
				id: perimeter.id,
				name: perimeter.name,
				color: perimeter.color,
				transverse: perimeter.transverse,
				sortOrder: perimeter.sortOrder,
				archivedAt: perimeter.archivedAt,
				ticketCount: count(ticket.id)
			})
			.from(perimeter)
			// Les tickets archivés ne comptent pas : ils ne doivent pas bloquer l'archivage d'un
			// périmètre dont il ne reste que du soft-delete en attente de purge.
			.leftJoin(ticket, and(eq(ticket.perimeterId, perimeter.id), isNull(ticket.archivedAt)))
			.where(eq(perimeter.workspaceId, workspaceId))
			.groupBy(
				perimeter.id,
				perimeter.name,
				perimeter.color,
				perimeter.transverse,
				perimeter.sortOrder,
				perimeter.archivedAt
			)
			.orderBy(perimeter.sortOrder, perimeter.name),
		db
			.select({
				perimeterId: perimeterMember.perimeterId,
				userId: perimeterMember.userId,
				displayName: user.displayName,
				role: perimeterMember.role
			})
			.from(perimeterMember)
			.innerJoin(user, eq(perimeterMember.userId, user.id))
			.where(eq(perimeterMember.workspaceId, workspaceId))
			.orderBy(user.displayName)
	]);

	const byPerimeter = new Map<string, PerimeterMemberItem[]>();
	for (const m of memberRows) {
		if (!byPerimeter.has(m.perimeterId)) byPerimeter.set(m.perimeterId, []);
		byPerimeter.get(m.perimeterId)!.push({ userId: m.userId, displayName: m.displayName, role: m.role });
	}

	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		color: r.color,
		transverse: r.transverse,
		sortOrder: r.sortOrder,
		archived: r.archivedAt !== null,
		ticketCount: r.ticketCount,
		// CP et backups d'abord : c'est l'information qu'on cherche en scannant la liste.
		members: (byPerimeter.get(r.id) ?? []).sort(
			(a, b) => Number(isLeadRole(b.role)) - Number(isLeadRole(a.role))
		)
	}));
}

/** Les périmètres où ces personnes sont rattachées, pour l'onglet Membres (une ligne = une personne). */
export async function listPerimetersByUser(
	workspaceId: string
): Promise<Map<string, { id: string; name: string; color: string | null; role: PerimeterRole }[]>> {
	const rows = await db
		.select({
			userId: perimeterMember.userId,
			id: perimeter.id,
			name: perimeter.name,
			color: perimeter.color,
			role: perimeterMember.role
		})
		.from(perimeterMember)
		.innerJoin(perimeter, eq(perimeterMember.perimeterId, perimeter.id))
		.where(and(eq(perimeterMember.workspaceId, workspaceId), isNull(perimeter.archivedAt)))
		.orderBy(perimeter.sortOrder, perimeter.name);

	const map = new Map<string, { id: string; name: string; color: string | null; role: PerimeterRole }[]>();
	for (const r of rows) {
		if (!map.has(r.userId)) map.set(r.userId, []);
		map.get(r.userId)!.push({ id: r.id, name: r.name, color: r.color, role: r.role });
	}
	return map;
}

// ---------- Écriture ----------

/** Rejette un nom déjà pris par un périmètre actif de l'espace (cf. perimeter_ws_name_uq). */
async function assertUniqueName(workspaceId: string, name: string, excludeId: string | null) {
	const conds = [
		eq(perimeter.workspaceId, workspaceId),
		isNull(perimeter.archivedAt),
		sql`lower(${perimeter.name}) = ${name.toLowerCase()}`
	];
	if (excludeId) conds.push(ne(perimeter.id, excludeId));
	const dup = await db.select({ id: perimeter.id }).from(perimeter).where(and(...conds)).limit(1);
	if (dup.length) throw new Error('Un périmètre actif porte déjà ce nom.');
}

export async function createPerimeter(
	workspaceId: string,
	name: string,
	color: string | null,
	transverse: boolean
) {
	const n = name.trim();
	if (!n) throw new Error('Nom requis.');
	await assertUniqueName(workspaceId, n, null);
	const [max] = await db
		.select({ v: sql<number>`coalesce(max(${perimeter.sortOrder}), -1)` })
		.from(perimeter)
		.where(eq(perimeter.workspaceId, workspaceId));
	const [row] = await db
		.insert(perimeter)
		.values({ workspaceId, name: n, color, transverse, sortOrder: Number(max.v) + 1 })
		.returning({ id: perimeter.id });
	return row.id;
}

export async function updatePerimeter(
	workspaceId: string,
	id: string,
	name: string,
	color: string | null,
	transverse: boolean
) {
	const n = name.trim();
	if (!n) throw new Error('Nom requis.');
	await assertUniqueName(workspaceId, n, id);
	const res = await db
		.update(perimeter)
		.set({ name: n, color, transverse })
		.where(and(eq(perimeter.id, id), eq(perimeter.workspaceId, workspaceId)))
		.returning({ id: perimeter.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}

/**
 * Archivage (soft-delete, comme les autres référentiels) — mais refusé tant que des tickets actifs
 * y sont rattachés : `ticket.perimeterId` étant NOT NULL, ils resteraient rattachés à un périmètre
 * archivé, invisible des filtres, donc introuvables. L'admin les déplace d'abord.
 */
export async function setPerimeterArchived(workspaceId: string, id: string, archived: boolean) {
	if (archived) {
		const [{ v: tickets }] = await db
			.select({ v: count(ticket.id) })
			.from(ticket)
			.where(and(eq(ticket.perimeterId, id), isNull(ticket.archivedAt)));
		if (tickets > 0)
			throw new Error(
				`Impossible d'archiver : ${tickets} ticket(s) y sont encore rattachés. Déplacez-les d'abord.`
			);
		const [{ v: actifs }] = await db
			.select({ v: count(perimeter.id) })
			.from(perimeter)
			.where(
				and(eq(perimeter.workspaceId, workspaceId), isNull(perimeter.archivedAt), ne(perimeter.id, id))
			);
		if (actifs === 0) throw new Error('Impossible d\'archiver le dernier périmètre de l\'espace.');
	}
	const res = await db
		.update(perimeter)
		.set({ archivedAt: archived ? new Date() : null })
		.where(and(eq(perimeter.id, id), eq(perimeter.workspaceId, workspaceId)))
		.returning({ id: perimeter.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}

/** Échange l'ordre avec le voisin — même mécanique que moveState. */
export async function movePerimeter(workspaceId: string, id: string, dir: 'up' | 'down') {
	const rows = await db
		.select({ id: perimeter.id, sortOrder: perimeter.sortOrder })
		.from(perimeter)
		.where(and(eq(perimeter.workspaceId, workspaceId), isNull(perimeter.archivedAt)))
		.orderBy(perimeter.sortOrder, perimeter.name);
	const idx = rows.findIndex((r) => r.id === id);
	const swap = dir === 'up' ? idx - 1 : idx + 1;
	if (idx < 0 || swap < 0 || swap >= rows.length) return;
	const a = rows[idx];
	const b = rows[swap];
	await db.transaction(async (tx) => {
		await tx.update(perimeter).set({ sortOrder: b.sortOrder }).where(eq(perimeter.id, a.id));
		await tx.update(perimeter).set({ sortOrder: a.sortOrder }).where(eq(perimeter.id, b.id));
	});
}

/**
 * Rattache une personne à un périmètre, ou change son rôle dedans. `role = null` la retire.
 * La personne doit être membre de l'espace : sinon on créerait un droit sur un périmètre pour
 * quelqu'un qui n'a rien à faire dans l'espace.
 */
export async function setPerimeterMemberRole(
	workspaceId: string,
	perimeterId: string,
	userId: string,
	role: PerimeterRole | null
) {
	const [p] = await db
		.select({ id: perimeter.id })
		.from(perimeter)
		.where(and(eq(perimeter.id, perimeterId), eq(perimeter.workspaceId, workspaceId)))
		.limit(1);
	if (!p) throw new Error('Périmètre introuvable dans cet espace.');

	if (role === null) {
		await db
			.delete(perimeterMember)
			.where(
				and(
					eq(perimeterMember.workspaceId, workspaceId),
					eq(perimeterMember.perimeterId, perimeterId),
					eq(perimeterMember.userId, userId)
				)
			);
		return;
	}

	const [m] = await db
		.select({ id: membership.id })
		.from(membership)
		.where(
			and(
				eq(membership.workspaceId, workspaceId),
				eq(membership.userId, userId),
				eq(membership.active, true)
			)
		)
		.limit(1);
	if (!m) throw new Error("Cette personne n'est pas un membre actif de l'espace.");

	await db
		.insert(perimeterMember)
		.values({ workspaceId, perimeterId, userId, role })
		.onConflictDoUpdate({
			target: [perimeterMember.perimeterId, perimeterMember.userId],
			set: { role }
		});
}

/**
 * Périmètre d'atterrissage par défaut d'un espace : le premier périmètre actif dans l'ordre
 * d'affichage, en écartant les transverses tant qu'il reste un périmètre applicatif.
 *
 * Sert aux créations de tickets qui ne peuvent PAS choisir : le sync Jira (Jira ignore la notion
 * de périmètre) et les appels programmatiques. Les créations passant par l'UI, elles, imposent un
 * choix explicite — ce défaut n'est jamais un moyen de ne pas trancher, juste un filet pour que
 * `ticket.perimeterId` (NOT NULL) soit toujours satisfiable.
 */
export async function resolveDefaultPerimeterId(workspaceId: string): Promise<string> {
	const rows = await db
		.select({ id: perimeter.id, transverse: perimeter.transverse })
		.from(perimeter)
		.where(and(eq(perimeter.workspaceId, workspaceId), isNull(perimeter.archivedAt)))
		.orderBy(perimeter.sortOrder, perimeter.name);
	const pick = rows.find((r) => !r.transverse) ?? rows[0];
	if (!pick) throw new Error("Cet espace n'a aucun périmètre actif.");
	return pick.id;
}

/** Vérifie qu'un périmètre appartient bien à l'espace — même garde que assertTargetInWorkspace. */
export async function assertPerimeterInWorkspace(workspaceId: string, perimeterId: string) {
	const [row] = await db
		.select({ id: perimeter.id })
		.from(perimeter)
		.where(and(eq(perimeter.id, perimeterId), eq(perimeter.workspaceId, workspaceId)))
		.limit(1);
	if (!row) throw new Error('Périmètre introuvable dans cet espace.');
}
