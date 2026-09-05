import { and, eq, gte, lte, isNull, isNotNull, sql, desc } from 'drizzle-orm';
import {
	db,
	monthlyClosing,
	monthlyClosingLine,
	monthlyClosingMember,
	monthlyClosingSsp,
	ssp,
	perimeter,
	membership,
	user,
	timeEntry,
	category
} from '$lib/server/db';
import { getConsoBySsp } from './dashboard';
import { num, round, plannedDays, toAllocate } from './calc';
import { countWorkdaysNonHoliday, workdayHolidaysBetween, monthRange } from '$lib/utils/date';

/**
 * Clôture mensuelle — reproduit l'onglet « Synthèse mois » du modèle de suivi financier.
 *
 * Une PASSE (`monthlyClosing`, une ligne par `seq`) = une tentative d'intégration GPS sur un mois.
 * La clôture comptable tombe quelques jours avant la fin du mois : tout n'est pas encore imputé, on
 * complète donc à la main les jours manquants, on reporte dans GPS, et on fige. Rejouer le process
 * plus tard n'annule jamais la passe précédente — on en ouvre une nouvelle, pré-remplie avec les
 * mêmes compléments mais des consos à jour.
 */

export type ClosingSummary = {
	id: string;
	seq: number;
	status: 'DRAFT' | 'INTEGRATED';
	workdaysOverride: string | null;
	integratedAt: Date | null;
	integratedByName: string | null;
};

export type ClosingSsp = {
	id: string;
	code: string;
	label: string;
	/** Archivé depuis : la colonne reste tant qu'elle porte quelque chose, mais on la signale. */
	archived: boolean;
	/**
	 * Périmètre du code, pour GROUPER les colonnes — purement de la présentation. La clôture reste
	 * un acte de gouvernance à l'échelle de l'espace : le « prévu du mois » est une donnée PERSONNE
	 * (ouvrés − congés − formation − hors-projet) et le « à ventiler » n'a de sens que si la
	 * totalité des jours d'une personne est dans le même écran. La découper par périmètre ferait
	 * apparaître un collaborateur multi-périmètres dans N clôtures, chacune avec un prévu partiel.
	 * `null` = code sans périmètre (ou rattaché à un périmètre archivé) : colonnes « Partagé ».
	 */
	perimeterId: string | null;
	perimeterName: string | null;
	perimeterColor: string | null;
};

/** D'où vient le nombre de jours ouvrés du mois — affiché pour qu'on puisse le contester. */
export type WorkdaysDetail = {
	/** Jours de la semaine (lun→ven) du mois, fériés compris. */
	weekdays: number;
	/** Fériés FR tombant un jour de semaine, retirés du calcul. */
	holidays: string[];
	/** weekdays − holidays.length. */
	computed: number;
	/** Valeur imposée par l'admin, `null` si on garde le calcul. */
	override: number | null;
	/** Ce qui sert réellement de base au prévu. */
	effective: number;
};

export type ClosingMemberRow = {
	userId: string;
	displayName: string;
	/** Plus membre actif de l'espace, mais garde des jours sur ce mois : sa ligne reste. */
	inactive: boolean;
	/** Congés validés + formation + hors-projet imputés sur le mois. */
	absenceDays: number;
	/** Valeur saisie par l'admin, `null` si on garde le calcul. */
	plannedOverride: number | null;
	/** Prévu retenu : override, ou photo si la passe est intégrée, ou calcul. */
	planned: number;
	/** Conso par sspId (clé `''` = tickets sans code SSP, non complétable). */
	conso: Record<string, number>;
	complement: Record<string, number>;
	consoTotal: number;
	complementTotal: number;
	/** Prévu − conso − complément. Négatif = déjà dépassé. */
	toAllocate: number;
	/** Conso vivante, uniquement sur une passe intégrée — sert à l'écart vs prévisionnel. */
	consoLive: Record<string, number> | null;
};

export type ClosingView = {
	month: string; // 'YYYY-MM'
	closing: ClosingSummary | null;
	passes: ClosingSummary[];
	/** Colonnes retenues : les codes imputés sur le mois, plus ceux ajoutés à la main. */
	ssps: ClosingSsp[];
	/** Codes actifs absents des colonnes — proposés à l'ajout. */
	availableSsps: ClosingSsp[];
	workdays: WorkdaysDetail;
	/** true si des imputations du mois portent sur des tickets sans code SSP (colonne en lecture seule). */
	hasUnassigned: boolean;
	members: ClosingMemberRow[];
};

/** Clé de colonne d'un SSP absent (tickets sans code SSP) — jamais un uuid. */
export const UNASSIGNED_SSP = '';

async function listPasses(workspaceId: string, month: string): Promise<ClosingSummary[]> {
	const rows = await db
		.select({
			id: monthlyClosing.id,
			seq: monthlyClosing.seq,
			status: monthlyClosing.status,
			workdaysOverride: monthlyClosing.workdaysOverride,
			integratedAt: monthlyClosing.integratedAt,
			integratedByName: user.displayName
		})
		.from(monthlyClosing)
		.leftJoin(user, eq(monthlyClosing.integratedById, user.id))
		.where(and(eq(monthlyClosing.workspaceId, workspaceId), eq(monthlyClosing.month, `${month}-01`)))
		.orderBy(desc(monthlyClosing.seq));
	return rows;
}

/**
 * Jours d'absence imputés par personne sur le mois. On somme les `time_entry` posés sur les
 * catégories liées à un type d'absence (congé validé / formation / hors-projet) : `syncAbsenceEntries`
 * les y matérialise déjà, fériés exclus — rien à recalculer depuis la table `absence`.
 */
async function absenceDaysByUser(workspaceId: string, from: string, to: string) {
	const rows = await db
		.select({ userId: timeEntry.userId, total: sql<string>`sum(${timeEntry.amount})` })
		.from(timeEntry)
		.innerJoin(category, eq(timeEntry.categoryId, category.id))
		.where(
			and(
				eq(timeEntry.workspaceId, workspaceId),
				isNotNull(category.linkedAbsenceType),
				gte(timeEntry.day, from),
				lte(timeEntry.day, to)
			)
		)
		.groupBy(timeEntry.userId);
	return new Map(rows.map((r) => [r.userId, round(num(r.total))]));
}

/**
 * État complet de l'écran de clôture pour un mois. `seq` cible une passe précise ; sans lui on
 * prend la passe ouverte, à défaut la dernière intégrée.
 */
export async function getClosingView(
	workspaceId: string,
	month: string,
	seq?: number
): Promise<ClosingView> {
	const { from, to } = monthRange(month);
	const passes = await listPasses(workspaceId, month);
	const closing =
		(seq !== undefined ? passes.find((p) => p.seq === seq) : undefined) ??
		passes.find((p) => p.status === 'DRAFT') ??
		passes[0] ??
		null;
	const integrated = closing?.status === 'INTEGRATED';

	const [allSsps, members, consoRows, absences, lines, memberRows, addedSspRows] = await Promise.all([
		// Archivés compris : un code archivé APRÈS avoir été complété doit garder sa colonne, sinon
		// ses jours disparaissent de l'écran tout en restant en base — et le total reporté dans GPS
		// devient faux sans que personne ne le voie.
		db
			.select({
				id: ssp.id,
				code: ssp.code,
				label: ssp.label,
				archivedAt: ssp.archivedAt,
				perimeterId: ssp.perimeterId,
				perimeterName: perimeter.name,
				perimeterColor: perimeter.color,
				perimeterArchivedAt: perimeter.archivedAt
			})
			.from(ssp)
			.leftJoin(perimeter, eq(ssp.perimeterId, perimeter.id))
			// Tri par code : c'est l'en-tête affiché par défaut. Trier sur le libellé ferait sauter
			// l'ordre des colonnes à chaque bascule de l'interrupteur codes/libellés.
			.where(eq(ssp.workspaceId, workspaceId))
			.orderBy(ssp.code),
		// Inactifs compris, même raison : quelqu'un qui quitte l'équipe en cours de mois garde des
		// jours à reporter. Sa ligne n'est retenue que s'il a réellement quelque chose (cf. plus bas).
		db
			.select({ userId: membership.userId, displayName: user.displayName, active: membership.active })
			.from(membership)
			.innerJoin(user, eq(membership.userId, user.id))
			.where(eq(membership.workspaceId, workspaceId))
			.orderBy(user.displayName),
		getConsoBySsp(workspaceId, { from, to }),
		absenceDaysByUser(workspaceId, from, to),
		closing
			? db.select().from(monthlyClosingLine).where(eq(monthlyClosingLine.closingId, closing.id))
			: Promise.resolve([]),
		closing
			? db.select().from(monthlyClosingMember).where(eq(monthlyClosingMember.closingId, closing.id))
			: Promise.resolve([]),
		closing
			? db
					.select({ sspId: monthlyClosingSsp.sspId })
					.from(monthlyClosingSsp)
					.where(eq(monthlyClosingSsp.closingId, closing.id))
			: Promise.resolve([])
	]);

	const holidays = workdayHolidaysBetween(from, to);
	const computedWorkdays = countWorkdaysNonHoliday(from, to);
	const overrideWorkdays = closing?.workdaysOverride == null ? null : num(closing.workdaysOverride);
	const workdays = overrideWorkdays ?? computedWorkdays;
	const workdaysDetail: WorkdaysDetail = {
		weekdays: computedWorkdays + holidays.length,
		holidays,
		computed: computedWorkdays,
		override: overrideWorkdays,
		effective: workdays
	};
	// Conso vivante, toujours recalculée. Sur une passe intégrée elle sert l'écart vs prévisionnel ;
	// la conso affichée dans les 3 premiers tableaux vient alors de la photo (consoSnapshot).
	const liveByUser = new Map<string, Record<string, number>>();
	let hasUnassigned = false;
	for (const r of consoRows) {
		if (r.sspId === null) hasUnassigned = true;
		const key = r.sspId ?? UNASSIGNED_SSP;
		const rec = liveByUser.get(r.userId) ?? {};
		rec[key] = round((rec[key] ?? 0) + r.total);
		liveByUser.set(r.userId, rec);
	}

	// Colonnes retenues : un code imputé sur le mois, un code déjà complété (y compris recopié
	// d'une passe précédente), ou un code ajouté explicitement. Le reste du référentiel n'a rien à
	// faire à l'écran — sur un espace à trente codes, la table devient illisible.
	const keptSspIds = new Set<string>([
		...consoRows.map((r) => r.sspId).filter((v): v is string => v !== null),
		...lines.map((l) => l.sspId),
		...addedSspRows.map((r) => r.sspId)
	]);
	const toClosingSsp = (r: (typeof allSsps)[number]): ClosingSsp => {
		// Un code rattaché à un périmètre archivé retombe en « Partagé » : son budget existe toujours,
		// il doit rester lisible quelque part (même règle que la consolidation).
		const live = r.perimeterId !== null && r.perimeterArchivedAt === null;
		return {
			id: r.id,
			code: r.code,
			label: r.label,
			archived: r.archivedAt !== null,
			perimeterId: live ? r.perimeterId : null,
			perimeterName: live ? r.perimeterName : null,
			perimeterColor: live ? r.perimeterColor : null
		};
	};
	const ssps = allSsps.filter((s) => keptSspIds.has(s.id)).map(toClosingSsp);
	// On ne propose à l'ajout que des codes actifs : ressusciter un archivé se fait aux référentiels.
	const availableSsps = allSsps
		.filter((s) => !keptSspIds.has(s.id) && s.archivedAt === null)
		.map(toClosingSsp);

	const snapByUser = new Map<string, Record<string, number>>();
	const complByUser = new Map<string, Record<string, number>>();
	for (const l of lines) {
		const c = complByUser.get(l.userId) ?? {};
		c[l.sspId] = num(l.complement);
		complByUser.set(l.userId, c);
		if (l.consoSnapshot !== null) {
			const s = snapByUser.get(l.userId) ?? {};
			s[l.sspId] = num(l.consoSnapshot);
			snapByUser.set(l.userId, s);
		}
	}
	const memberById = new Map(memberRows.map((m) => [m.userId, m]));

	const keptUserIds = new Set<string>([
		...consoRows.map((r) => r.userId),
		...lines.map((l) => l.userId),
		...memberRows.map((r) => r.userId)
	]);
	const rows: ClosingMemberRow[] = members
		.filter((m) => m.active || keptUserIds.has(m.userId))
		.map((m) => {
		const live = liveByUser.get(m.userId) ?? {};
		const conso = integrated ? (snapByUser.get(m.userId) ?? {}) : live;
		const complement = complByUser.get(m.userId) ?? {};
		const stored = memberById.get(m.userId);
		const absenceDays = absences.get(m.userId) ?? 0;
		const override = stored?.plannedOverride == null ? null : num(stored.plannedOverride);
		const planned = integrated
			? num(stored?.plannedSnapshot ?? null)
			: (override ?? plannedDays(workdays, absenceDays));
		const consoTotal = round(Object.values(conso).reduce((a, b) => a + b, 0));
		const complementTotal = round(Object.values(complement).reduce((a, b) => a + b, 0));
		return {
			userId: m.userId,
			displayName: m.displayName,
			inactive: !m.active,
			absenceDays,
			plannedOverride: override,
			planned,
			conso,
			complement,
			consoTotal,
			complementTotal,
			toAllocate: toAllocate(planned, consoTotal, complementTotal),
			consoLive: integrated ? live : null
		};
	});

	return {
		month,
		closing,
		passes,
		ssps,
		availableSsps,
		workdays: workdaysDetail,
		hasUnassigned,
		members: rows
	};
}

/** Charge une passe en s'assurant qu'elle appartient bien à l'espace, et qu'elle est modifiable. */
async function loadDraft(workspaceId: string, closingId: string) {
	const [row] = await db
		.select()
		.from(monthlyClosing)
		.where(and(eq(monthlyClosing.id, closingId), eq(monthlyClosing.workspaceId, workspaceId)));
	if (!row) throw new Error('Clôture introuvable dans cet espace.');
	if (row.status === 'INTEGRATED')
		throw new Error('Cette passe est intégrée dans GPS — ouvrez une nouvelle passe pour reprendre la saisie.');
	return row;
}

/**
 * Ouvre une passe sur un mois. La première crée la seq 1 ; les suivantes recopient les compléments
 * de la passe précédente (on rejoue le même report, pas une saisie à blanc) mais repartent sur des
 * consos vivantes. Si une passe est déjà ouverte, on la renvoie telle quelle.
 */
export async function openClosing(workspaceId: string, month: string): Promise<string> {
	const monthDate = `${month}-01`;
	return db.transaction(async (tx) => {
		const existing = await tx
			.select()
			.from(monthlyClosing)
			.where(
				and(
					eq(monthlyClosing.workspaceId, workspaceId),
					eq(monthlyClosing.month, monthDate),
					eq(monthlyClosing.status, 'DRAFT')
				)
			);
		if (existing.length) return existing[0].id;

		const [{ max }] = await tx
			.select({ max: sql<number>`coalesce(max(${monthlyClosing.seq}), 0)` })
			.from(monthlyClosing)
			.where(and(eq(monthlyClosing.workspaceId, workspaceId), eq(monthlyClosing.month, monthDate)));
		const prevSeq = Number(max);
		// L'ajustement des jours ouvrés décrit le mois, pas la passe : il vaut encore pour la suivante.
		const [prevRow] = prevSeq
			? await tx
					.select({ workdaysOverride: monthlyClosing.workdaysOverride })
					.from(monthlyClosing)
					.where(
						and(
							eq(monthlyClosing.workspaceId, workspaceId),
							eq(monthlyClosing.month, monthDate),
							eq(monthlyClosing.seq, prevSeq)
						)
					)
			: [];
		const [created] = await tx
			.insert(monthlyClosing)
			.values({
				workspaceId,
				month: monthDate,
				seq: prevSeq + 1,
				workdaysOverride: prevRow?.workdaysOverride ?? null
			})
			.returning({ id: monthlyClosing.id });

		if (prevSeq > 0) {
			const [prev] = await tx
				.select({ id: monthlyClosing.id })
				.from(monthlyClosing)
				.where(
					and(
						eq(monthlyClosing.workspaceId, workspaceId),
						eq(monthlyClosing.month, monthDate),
						eq(monthlyClosing.seq, prevSeq)
					)
				);
			const prevLines = await tx
				.select()
				.from(monthlyClosingLine)
				.where(eq(monthlyClosingLine.closingId, prev.id));
			// consoSnapshot volontairement non recopié : la nouvelle passe doit repartir des consos
			// réelles à jour, c'est tout son intérêt.
			if (prevLines.length)
				await tx.insert(monthlyClosingLine).values(
					prevLines.map((l) => ({
						closingId: created.id,
						userId: l.userId,
						sspId: l.sspId,
						complement: l.complement
					}))
				);
			const prevSsps = await tx
				.select({ sspId: monthlyClosingSsp.sspId })
				.from(monthlyClosingSsp)
				.where(eq(monthlyClosingSsp.closingId, prev.id));
			if (prevSsps.length)
				await tx
					.insert(monthlyClosingSsp)
					.values(prevSsps.map((r) => ({ closingId: created.id, sspId: r.sspId })));
			const prevMembers = await tx
				.select()
				.from(monthlyClosingMember)
				.where(eq(monthlyClosingMember.closingId, prev.id));
			const overrides = prevMembers.filter((m) => m.plannedOverride !== null);
			if (overrides.length)
				await tx.insert(monthlyClosingMember).values(
					overrides.map((m) => ({
						closingId: created.id,
						userId: m.userId,
						plannedOverride: m.plannedOverride
					}))
				);
		}
		return created.id;
	});
}

/**
 * Un id d'utilisateur ou de code SSP posté dans un formulaire n'est jamais digne de confiance :
 * les FK de monthly_closing_line pointent vers `user` et `ssp` globalement, pas vers l'espace.
 * Sans cette vérification, une clôture peut référencer des lignes d'un autre espace.
 */
async function assertBelongsToWorkspace(workspaceId: string, userId: string, sspId?: string) {
	const [m] = await db
		.select({ userId: membership.userId })
		.from(membership)
		.where(and(eq(membership.workspaceId, workspaceId), eq(membership.userId, userId)));
	if (!m) throw new Error('Collaborateur introuvable dans cet espace.');
	if (sspId) {
		const [row] = await db
			.select({ id: ssp.id })
			.from(ssp)
			.where(and(eq(ssp.id, sspId), eq(ssp.workspaceId, workspaceId)));
		if (!row) throw new Error('Code SSP introuvable dans cet espace.');
	}
}

/** Saisie d'une case de complément. `0` supprime la ligne plutôt que de stocker un zéro. */
export async function setComplement(
	workspaceId: string,
	closingId: string,
	userId: string,
	sspId: string,
	amount: number
) {
	await loadDraft(workspaceId, closingId);
	await assertBelongsToWorkspace(workspaceId, userId, sspId);
	if (!Number.isFinite(amount)) throw new Error('Montant invalide.');
	if (amount === 0) {
		await db
			.delete(monthlyClosingLine)
			.where(
				and(
					eq(monthlyClosingLine.closingId, closingId),
					eq(monthlyClosingLine.userId, userId),
					eq(monthlyClosingLine.sspId, sspId)
				)
			);
		return;
	}
	await db
		.insert(monthlyClosingLine)
		.values({ closingId, userId, sspId, complement: String(amount) })
		.onConflictDoUpdate({
			target: [monthlyClosingLine.closingId, monthlyClosingLine.userId, monthlyClosingLine.sspId],
			set: { complement: String(amount), updatedAt: new Date() }
		});
}

/** `null` remet le prévu sur son calcul automatique. */
export async function setPlanned(
	workspaceId: string,
	closingId: string,
	userId: string,
	value: number | null
) {
	await loadDraft(workspaceId, closingId);
	await assertBelongsToWorkspace(workspaceId, userId);
	if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error('Prévu invalide.');
	await db
		.insert(monthlyClosingMember)
		.values({ closingId, userId, plannedOverride: value === null ? null : String(value) })
		.onConflictDoUpdate({
			target: [monthlyClosingMember.closingId, monthlyClosingMember.userId],
			set: { plannedOverride: value === null ? null : String(value) }
		});
}

/** Ajoute un code SSP aux colonnes de la passe, pour pouvoir y rattraper des jours. */
export async function addClosingSsp(workspaceId: string, closingId: string, sspId: string) {
	await loadDraft(workspaceId, closingId);
	const [row] = await db
		.select({ id: ssp.id })
		.from(ssp)
		.where(and(eq(ssp.id, sspId), eq(ssp.workspaceId, workspaceId), isNull(ssp.archivedAt)));
	if (!row) throw new Error('Code SSP introuvable dans cet espace.');
	await db.insert(monthlyClosingSsp).values({ closingId, sspId }).onConflictDoNothing();
}

/**
 * Retire une colonne ajoutée. Refusé dès qu'elle porte quelque chose : masquer une colonne
 * complétée ferait disparaître des jours du total d'intégration sans le dire.
 */
export async function removeClosingSsp(workspaceId: string, closingId: string, sspId: string) {
	const closing = await loadDraft(workspaceId, closingId);
	const { from, to } = monthRange(closing.month.slice(0, 7));
	// On teste la VALEUR du complément, pas l'existence de la ligne : une ligne peut n'être qu'une
	// photo de conso (consoSnapshot) avec un complément à 0, et refuser sur ce motif serait faux.
	const used = await db
		.select({ id: monthlyClosingLine.id })
		.from(monthlyClosingLine)
		.where(
			and(
				eq(monthlyClosingLine.closingId, closingId),
				eq(monthlyClosingLine.sspId, sspId),
				sql`${monthlyClosingLine.complement} <> 0`
			)
		)
		.limit(1);
	if (used.length) throw new Error('Ce code porte déjà un complément — remettez-le à 0 d\'abord.');
	const conso = await getConsoBySsp(workspaceId, { from, to });
	if (conso.some((r) => r.sspId === sspId))
		throw new Error('Ce code a des imputations sur le mois — sa colonne ne peut pas être retirée.');
	await db
		.delete(monthlyClosingSsp)
		.where(and(eq(monthlyClosingSsp.closingId, closingId), eq(monthlyClosingSsp.sspId, sspId)));
}

/** `null` remet le nombre de jours ouvrés sur son calcul automatique. */
export async function setWorkdays(workspaceId: string, closingId: string, value: number | null) {
	await loadDraft(workspaceId, closingId);
	if (value !== null && (!Number.isFinite(value) || value < 0 || value > 31))
		throw new Error('Nombre de jours ouvrés invalide.');
	await db
		.update(monthlyClosing)
		.set({ workdaysOverride: value === null ? null : String(value) })
		.where(eq(monthlyClosing.id, closingId));
}

/**
 * Fige la passe : photo de la conso et du prévu au moment du report dans GPS. Après ça les
 * imputations continuent de vivre, et c'est justement l'écart entre les deux qu'on veut mesurer.
 * Les tickets sans code SSP ne sont pas photographiés (rien à reporter dans GPS pour eux).
 */
export async function integrate(workspaceId: string, closingId: string, byUserId: string) {
	const closing = await loadDraft(workspaceId, closingId);
	const month = closing.month.slice(0, 7);
	// Une seule lecture de la conso, celle de la vue : réinterroger séparément photographierait un
	// instant différent de celui qui a servi à calculer le prévu, et les deux ne colleraient plus.
	const view = await getClosingView(workspaceId, month, closing.seq);

	// ponytail: une écriture par (personne, code) — 9 × 5 chez le plus gros espace actuel. À batcher
	// si un espace monte à des centaines de lignes.
	await db.transaction(async (tx) => {
		for (const m of view.members) {
			for (const [sspId, total] of Object.entries(m.conso)) {
				// Les jours sans code SSP ne se reportent pas dans GPS : rien à figer pour eux.
				if (sspId === UNASSIGNED_SSP) continue;
				await tx
					.insert(monthlyClosingLine)
					.values({ closingId, userId: m.userId, sspId, consoSnapshot: String(total) })
					.onConflictDoUpdate({
						target: [
							monthlyClosingLine.closingId,
							monthlyClosingLine.userId,
							monthlyClosingLine.sspId
						],
						set: { consoSnapshot: String(total), updatedAt: new Date() }
					});
			}
		}
		for (const m of view.members) {
			await tx
				.insert(monthlyClosingMember)
				.values({
					closingId,
					userId: m.userId,
					plannedOverride: m.plannedOverride === null ? null : String(m.plannedOverride),
					plannedSnapshot: String(m.planned)
				})
				.onConflictDoUpdate({
					target: [monthlyClosingMember.closingId, monthlyClosingMember.userId],
					set: { plannedSnapshot: String(m.planned) }
				});
		}
		await tx
			.update(monthlyClosing)
			.set({ status: 'INTEGRATED', integratedAt: new Date(), integratedById: byUserId })
			.where(eq(monthlyClosing.id, closingId));
	});
}
