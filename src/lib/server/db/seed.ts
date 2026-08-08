// Environnement de test jetable : espace "QA Sandbox", 4 comptes, ~4 mois d'historique sur
// 8 sprints / 4 versions / 3 projets, imputations + snapshots cohérents dans le temps — de quoi
// avoir une vraie vision d'un projet global (pas juste un instantané d'une semaine).
// Tout est ancré sur la date du jour au moment de l'exécution (jamais de date figée en dur).
//
// Usage : npm run db:seed   (déploie/rafraîchit)
//         npm run db:unseed (supprime tout)
import { eq, inArray } from 'drizzle-orm';
import { hashPassword } from '../auth/password';
import { DEFAULT_STATES, DEFAULT_ACTIVITIES, DEFAULT_CATEGORIES } from '../services/defaults';
import { round } from '../services/calc';
import { toISODate, addDays, mondayOf, parseISODate, todayInParis, isPublicHolidayFR } from '../../utils/date';
import {
	workspace,
	user,
	membership,
	state,
	activity,
	category,
	project,
	sprint,
	ticket,
	ticketActivityRae,
	ticketGroup,
	ticketGroupMember,
	timeEntry,
	ticketSnapshot,
	moodVote,
	absence,
	externalMember,
	changeLog,
	weeklyObjective,
	weeklyVacation
} from './schema';
import { getDb, wipeSandbox, WORKSPACE_NAME, SEED_DOMAIN, SEED_USERS } from './seed.shared';

function rand<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}
function chance(p: number): boolean {
	return Math.random() < p;
}
function shuffled<T>(arr: T[]): T[] {
	return [...arr].sort(() => Math.random() - 0.5);
}
function weighted<T>(choices: [T, number][]): T {
	const total = choices.reduce((s, [, w]) => s + w, 0);
	let r = Math.random() * total;
	for (const [v, w] of choices) {
		if (r < w) return v;
		r -= w;
	}
	return choices[choices.length - 1][0];
}
function chunk<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}
/** Répartition dégressive d'une quantité entre n activités (1 → [1], 2 → [.6,.4], 3 → [.55,.27,.18]…). */
function splitShares(n: number): number[] {
	if (n <= 1) return [1];
	const raw = Array.from({ length: n }, (_, i) => 1 / (i + 1));
	const total = raw.reduce((a, b) => a + b, 0);
	return raw.map((x) => round(x / total));
}

// ---------- Chronologie : 8 sprints de 2 semaines (~4 mois), 4 versions (2 sprints chacune) ----------
const SPRINT_DEFS = [
	{ name: 'Sprint 9', startWeeksAgo: 15, endWeeksAgo: 14, version: 'V1.0' },
	{ name: 'Sprint 10', startWeeksAgo: 13, endWeeksAgo: 12, version: 'V1.0' },
	{ name: 'Sprint 11', startWeeksAgo: 11, endWeeksAgo: 10, version: 'V1.1' },
	{ name: 'Sprint 12', startWeeksAgo: 9, endWeeksAgo: 8, version: 'V1.1' },
	{ name: 'Sprint 13', startWeeksAgo: 7, endWeeksAgo: 6, version: 'V1.2' },
	{ name: 'Sprint 14', startWeeksAgo: 5, endWeeksAgo: 4, version: 'V1.2' },
	{ name: 'Sprint 15', startWeeksAgo: 3, endWeeksAgo: 2, version: 'V1.3' },
	{ name: 'Sprint 16', startWeeksAgo: 1, endWeeksAgo: 0, version: 'V1.3' } // sprint courant
];
const VERSION_NAMES = ['V1.0', 'V1.1', 'V1.2', 'V1.3'];
const PROJECT_NAMES = ['Mobile', 'Web', 'Backend'] as const;

const TITLE_POOL: Record<(typeof PROJECT_NAMES)[number], string[]> = {
	Mobile: [
		'Refonte page login',
		'Ajout paiement CB',
		'Notifications push',
		'Correctif accessibilité',
		'Mode hors-ligne',
		'Écran onboarding',
		'Biométrie Face ID',
		'Filtre recherche avancée',
		'Widget accueil',
		'Deep linking',
		'Dark mode',
		'Optimisation démarrage app',
		'Partage social',
		'Historique commandes'
	],
	Web: [
		'Optimisation requêtes API',
		'Export PDF factures',
		'Migration base clients',
		'Refactor design system',
		'Tableau de bord admin',
		'Filtres tableau tickets',
		'Pagination liste clients',
		'Éditeur WYSIWYG',
		'Intégration SSO',
		'Responsive tablette',
		'Thème personnalisable',
		'Recherche full-text',
		'Export CSV rapports',
		'Multi-langue FR/EN'
	],
	Backend: [
		"API webhooks sortants",
		"File d'attente asynchrone",
		'Cache Redis sessions',
		'Rate limiting API',
		'Migration PostgreSQL',
		'Observabilité (logs structurés)',
		'Chiffrement données sensibles',
		'Job de purge automatique',
		'API GraphQL v2',
		'Réplication base secondaire',
		'Tests de charge',
		'Refonte pipeline CI',
		'Audit sécurité dépendances',
		'Sauvegarde automatisée S3'
	]
};

/** États plausibles selon l'ancienneté du sprint (0 = le plus vieux, 7 = le sprint courant). */
function statesForAge(age: number): [string, number][] {
	if (age <= 1) return [['En production', 6], ['A mettre en production', 2], ['Retour recette', 1]];
	if (age <= 3) return [['En production', 5], ['En recette métier', 2], ['Retour recette', 1], ['Defect', 1]];
	if (age <= 5) return [['En qualif', 3], ['A mettre en qualif', 2], ['En production', 2], ['Defect', 1]];
	if (age === 6) return [['En cours de dev', 3], ['En MR', 3], ['A mettre en qualif', 2], ['Defect', 1]];
	return [['En cours de dev', 4], ['En MR', 2], ['Réalisation à faire', 2], ['A macro-chiffrer', 1]];
}
const DONE_STATES = new Set(['En production', 'A mettre en production']);

const ESTIMATION_CHOICES: [number, number][] = [
	[1, 3],
	[2, 4],
	[3, 4],
	[5, 3],
	[8, 2],
	[13, 1]
];

const USER_ACTIVITIES: Record<string, string[]> = {
	[`alice@${SEED_DOMAIN}`]: ['Dev', 'TU'],
	[`bob@${SEED_DOMAIN}`]: ['Dev', 'Infra'],
	[`chloe@${SEED_DOMAIN}`]: ['TU', 'TNR', 'Analyse'],
	[`david@${SEED_DOMAIN}`]: ['Dev', 'Relecture', 'DA'],
	[`manon@${SEED_DOMAIN}`]: ['Analyse', 'Relecture']
};

async function main() {
	const db = getDb();
	console.log(`Nettoyage d'un éventuel "${WORKSPACE_NAME}" précédent…`);
	await wipeSandbox(db);

	// ---------- Utilisateurs + espace ----------
	const passwordHashes = await Promise.all(SEED_USERS.map((u) => hashPassword(u.password)));
	const insertedUsers = await db
		.insert(user)
		.values(SEED_USERS.map((u, i) => ({ displayName: u.displayName, email: u.email, passwordHash: passwordHashes[i] })))
		.returning();
	const userByEmail = new Map(insertedUsers.map((u) => [u.email, u]));

	const [ws] = await db
		.insert(workspace)
		.values({ name: WORKSPACE_NAME, allowedDomain: SEED_DOMAIN, createdByUserId: userByEmail.get(`alice@${SEED_DOMAIN}`)!.id })
		.returning();

	await db.insert(membership).values(
		SEED_USERS.map((u) => ({
			workspaceId: ws.id,
			userId: userByEmail.get(u.email)!.id,
			role: u.role,
			capacityPerDay: u.email.startsWith('bob') ? '0.8' : '1' // un temps partiel pour voir le % de capacité varier
		}))
	);

	// ---------- Référentiels ----------
	const insertedStates = await db
		.insert(state)
		.values(DEFAULT_STATES.map((s, i) => ({ workspaceId: ws.id, label: s.label, emoji: s.emoji, color: s.color, sortOrder: i })))
		.returning();
	const insertedActivities = await db
		.insert(activity)
		.values(DEFAULT_ACTIVITIES.map((label) => ({ workspaceId: ws.id, label })))
		.returning();
	const insertedCategories = await db
		.insert(category)
		.values(DEFAULT_CATEGORIES.map((c) => ({ workspaceId: ws.id, label: c.label, kind: c.kind })))
		.returning();

	const stateByLabel = new Map(insertedStates.map((s) => [s.label, s]));
	const activityByLabel = new Map(insertedActivities.map((a) => [a.label, a]));
	const categoryByLabel = new Map(insertedCategories.map((c) => [c.label, c]));

	const insertedProjects = await db
		.insert(project)
		.values(PROJECT_NAMES.map((name) => ({ workspaceId: ws.id, name })))
		.returning();
	const projectByName = new Map(insertedProjects.map((p) => [p.name, p]));

	const insertedVersions = await db
		.insert(sprint)
		.values(VERSION_NAMES.map((name, i) => ({ workspaceId: ws.id, name, kind: 'VERSION' as const, sortOrder: i })))
		.returning();
	const versionByName = new Map(insertedVersions.map((v) => [v.name, v]));

	const insertedSprints = await db
		.insert(sprint)
		.values(SPRINT_DEFS.map((s, i) => ({ workspaceId: ws.id, name: s.name, kind: 'SPRINT' as const, sortOrder: i })))
		.returning();
	const sprintByName = new Map(insertedSprints.map((s) => [s.name, s]));

	const insertedGroups = await db
		.insert(ticketGroup)
		.values([
			{ workspaceId: ws.id, label: 'Quick wins' },
			{ workspaceId: ws.id, label: 'Dette technique' },
			{ workspaceId: ws.id, label: 'Sécurité' }
		])
		.returning();
	const groupByLabel = new Map(insertedGroups.map((g) => [g.label, g]));

	// ---------- Fenêtre calendaire de chaque sprint (ancrée sur aujourd'hui) ----------
	const today = parseISODate(todayInParis());
	const currentMonday = mondayOf(today);
	const mondayWeeksAgo = (n: number) => addDays(currentMonday, -7 * n);
	const fridayWeeksAgo = (n: number) => addDays(mondayWeeksAgo(n), 4);

	const sprintWindows = SPRINT_DEFS.map((s) => ({
		...s,
		from: toISODate(mondayWeeksAgo(s.startWeeksAgo)),
		to: toISODate(fridayWeeksAgo(s.endWeeksAgo) < today ? fridayWeeksAgo(s.endWeeksAgo) : today)
	}));
	const rangeStart = mondayWeeksAgo(SPRINT_DEFS[0].startWeeksAgo);
	const allDays: string[] = [];
	for (let d = rangeStart; d <= today; d = addDays(d, 1)) {
		const dow = d.getUTCDay();
		if (dow !== 0 && dow !== 6 && !isPublicHolidayFR(toISODate(d))) allDays.push(toISODate(d));
	}
	function sprintForDay(dayISO: string) {
		return sprintWindows.find((s) => dayISO >= s.from && dayISO <= s.to);
	}

	// ---------- Tickets : 4 par sprint (32) + 4 en backlog, sans sprint/version ----------
	type TicketDraft = {
		key: string;
		title: string;
		project: (typeof PROJECT_NAMES)[number];
		sprintName?: string;
		versionName?: string;
		state: string;
		estimationReal: number;
		estimationTest: number | null;
		owner: string; // email du contributeur principal
		group?: string;
	};

	const titlePools: Record<string, string[]> = {
		Mobile: shuffled(TITLE_POOL.Mobile),
		Web: shuffled(TITLE_POOL.Web),
		Backend: shuffled(TITLE_POOL.Backend)
	};
	const titleIdx: Record<string, number> = { Mobile: 0, Web: 0, Backend: 0 };
	function nextTitle(p: (typeof PROJECT_NAMES)[number]) {
		const pool = titlePools[p];
		const t = pool[titleIdx[p] % pool.length];
		titleIdx[p]++;
		return t;
	}

	let ticketNum = 1;
	const drafts: TicketDraft[] = [];
	sprintWindows.forEach((sw, age) => {
		for (let i = 0; i < 4; i++) {
			const proj = PROJECT_NAMES[(age * 4 + i) % PROJECT_NAMES.length];
			drafts.push({
				key: `SBX-${ticketNum++}`,
				title: nextTitle(proj),
				project: proj,
				sprintName: sw.name,
				versionName: chance(0.85) ? sw.version : undefined, // ~15% de tickets techniques hors version
				state: weighted(statesForAge(age)),
				estimationReal: weighted(ESTIMATION_CHOICES),
				estimationTest: chance(0.5) ? weighted<number>([[1, 3], [2, 2], [3, 1]]) : null,
				owner: SEED_USERS[(age * 4 + i) % SEED_USERS.length].email,
				group: chance(0.25) ? rand(['Quick wins', 'Dette technique', 'Sécurité']) : undefined
			});
		}
	});
	// Backlog : pas encore planifié, jamais imputé.
	for (const proj of [...PROJECT_NAMES, 'Web'] as const) {
		drafts.push({
			key: `SBX-${ticketNum++}`,
			title: nextTitle(proj),
			project: proj,
			state: rand(['A macro-chiffrer', 'DA à faire / à revoir']),
			estimationReal: weighted(ESTIMATION_CHOICES),
			estimationTest: null,
			owner: rand(SEED_USERS).email
		});
	}

	const insertedTickets = await db
		.insert(ticket)
		.values(
			drafts.map((t) => ({
				workspaceId: ws.id,
				key: t.key,
				title: t.title,
				projectId: projectByName.get(t.project)!.id,
				sprintId: t.sprintName ? sprintByName.get(t.sprintName)!.id : null,
				versionId: t.versionName ? versionByName.get(t.versionName)!.id : null,
				stateId: stateByLabel.get(t.state)?.id ?? null,
				estimationReal: String(t.estimationReal),
				estimationTest: t.estimationTest != null ? String(t.estimationTest) : null,
				// Repli le temps de connaître le consommé — recalculé plus bas (jamais laissé tel quel
				// pour un ticket imputé : cf. la passe RAE par activité).
				raeReal: String(t.estimationReal),
				raeTest: t.estimationTest != null ? String(t.estimationTest) : null,
				sspCode: chance(0.15) ? `SSP-${t.key.split('-')[1].padStart(3, '0')}` : null,
				estimationPrev: chance(0.2) ? String(round(t.estimationReal * 0.9)) : null,
				enveloppeTotale: chance(0.2) ? String(round(t.estimationReal * 1.3)) : null,
				raeUpdatedAt: new Date()
			}))
		)
		.returning();
	const ticketByKey = new Map(insertedTickets.map((t) => [t.key, t]));

	for (const t of drafts) {
		if (t.group) await db.insert(ticketGroupMember).values({ groupId: groupByLabel.get(t.group)!.id, ticketId: ticketByKey.get(t.key)!.id });
	}

	// ---------- Imputations : ~4 mois glissants, ancrées sur le sprint actif à chaque date ----------
	type EntryDraft = {
		userId: string;
		targetType: 'TICKET' | 'CATEGORY';
		ticketId?: string;
		categoryId?: string;
		activityId: string | null;
		day: string;
		amount: number;
	};
	const entryDrafts: EntryDraft[] = [];
	const consumedByTicketDay = new Map<string, Map<string, number>>();
	const usedActivitiesByTicket = new Map<string, Set<string>>();

	function logAmount(ticketId: string, day: string, amount: number, activityLabel: string) {
		if (!consumedByTicketDay.has(ticketId)) consumedByTicketDay.set(ticketId, new Map());
		const byDay = consumedByTicketDay.get(ticketId)!;
		byDay.set(day, round((byDay.get(day) ?? 0) + amount));
		if (!usedActivitiesByTicket.has(ticketId)) usedActivitiesByTicket.set(ticketId, new Set());
		usedActivitiesByTicket.get(ticketId)!.add(activityLabel);
	}

	for (const day of allDays) {
		const sw = sprintForDay(day);
		if (!sw) continue;
		const sprintTickets = drafts.filter((d) => d.sprintName === sw.name);
		if (sprintTickets.length === 0) continue;

		for (const u of SEED_USERS) {
			const userId = userByEmail.get(u.email)!.id;
			if (chance(0.1)) {
				entryDrafts.push({ userId, targetType: 'CATEGORY', categoryId: categoryByLabel.get('Congé')!.id, activityId: null, day, amount: 1 });
				continue;
			}
			if (chance(0.05)) {
				entryDrafts.push({ userId, targetType: 'CATEGORY', categoryId: categoryByLabel.get('Formation')!.id, activityId: null, day, amount: 1 });
				continue;
			}
			// Ticket "possédé" ce sprint par l'utilisateur, sinon coup de main sur un ticket du sprint.
			const owned = sprintTickets.filter((t) => t.owner === u.email);
			const primary = owned.length > 0 ? rand(owned) : rand(sprintTickets);
			const userActivities = USER_ACTIVITIES[u.email];

			const splitDay = chance(0.25) && sprintTickets.length > 1;
			const picks = splitDay ? [primary, rand(sprintTickets.filter((t) => t.key !== primary.key))] : [primary];
			const amounts = splitDay ? [0.75, 0.25] : [1];
			picks.forEach((t, i) => {
				const tk = ticketByKey.get(t.key)!;
				const activityLabel = rand(userActivities);
				entryDrafts.push({
					userId,
					targetType: 'TICKET',
					ticketId: tk.id,
					activityId: activityByLabel.get(activityLabel)!.id,
					day,
					amount: amounts[i]
				});
				logAmount(tk.id, day, amounts[i], activityLabel);
			});
		}
	}

	for (const batch of chunk(
		entryDrafts.map((d) => ({
			workspaceId: ws.id,
			userId: d.userId,
			targetType: d.targetType,
			ticketId: d.ticketId ?? null,
			categoryId: d.categoryId ?? null,
			activityId: d.activityId,
			day: d.day,
			amount: String(d.amount)
		})),
		500
	))
		await db.insert(timeEntry).values(batch);

	// ---------- RAE cible par ticket (dérivé de l'état + du consommé réel) ----------
	const targetRaeByTicket = new Map<string, { real: number; test: number }>();
	for (const t of drafts) {
		const tk = ticketByKey.get(t.key)!;
		const totalConsumed = round([...(consumedByTicketDay.get(tk.id)?.values() ?? [])].reduce((a, b) => a + b, 0));
		let real: number;
		if (DONE_STATES.has(t.state)) real = 0;
		else if (totalConsumed === 0) real = t.estimationReal; // pas commencé
		else real = Math.max(0, round(t.estimationReal - totalConsumed * 0.85));
		const test = t.estimationTest == null || DONE_STATES.has(t.state) ? 0 : t.estimationTest;
		targetRaeByTicket.set(tk.id, { real, test });
	}

	// ---------- RAE toujours renseigné PAR ACTIVITÉ dès qu'un ticket a été imputé — jamais le
	// global directement (côté appli, resolvedRae() fait ensuite la somme des lignes d'activité).
	// Le champ ticket.raeReal ne sert de repli que pour les tickets jamais imputés.
	const activityRaeRows: (typeof ticketActivityRae.$inferInsert)[] = [];
	for (const t of drafts) {
		const tk = ticketByKey.get(t.key)!;
		const used = [...(usedActivitiesByTicket.get(tk.id) ?? [])];
		const target = targetRaeByTicket.get(tk.id)!;
		if (used.length === 0) {
			await db
				.update(ticket)
				.set({ raeReal: String(target.real), raeTest: target.test ? String(target.test) : null })
				.where(eq(ticket.id, tk.id));
			continue;
		}
		const shares = splitShares(used.length);
		used.forEach((label, i) => {
			activityRaeRows.push({
				ticketId: tk.id,
				activityId: activityByLabel.get(label)!.id,
				raeReal: String(round(target.real * shares[i])),
				raeTest: String(round(target.test * shares[i]))
			});
		});
	}
	for (const batch of chunk(activityRaeRows, 500)) await db.insert(ticketActivityRae).values(batch);

	// ---------- Historique de snapshots (courbe conso/RAE) pour les tickets liés à une version ----------
	const snapshotRows: (typeof ticketSnapshot.$inferInsert)[] = [];
	for (const t of drafts) {
		if (!t.versionName) continue;
		const tk = ticketByKey.get(t.key)!;
		const target = targetRaeByTicket.get(tk.id)!;
		const estTotal = t.estimationReal + (t.estimationTest ?? 0);
		const finalRae = target.real + target.test;
		const byDay = consumedByTicketDay.get(tk.id) ?? new Map();
		let cumulative = 0;
		let started = false;
		for (const day of allDays) {
			const dayAmount = byDay.get(day) ?? 0;
			if (dayAmount > 0) started = true;
			cumulative = round(cumulative + dayAmount);
			// RAE = reste-à-faire, interpolé entre l'estimation (avant démarrage) et le RAE final connu.
			const rae = started ? round(Math.max(finalRae, estTotal - cumulative)) : estTotal;
			snapshotRows.push({
				workspaceId: ws.id,
				ticketId: tk.id,
				date: day,
				estimationReal: String(t.estimationReal),
				raeReal: String(rae),
				raeTest: String(target.test),
				consumed: String(cumulative)
			});
		}
	}
	for (const batch of chunk(snapshotRows, 500)) await db.insert(ticketSnapshot).values(batch);

	// ---------- Team mood : quelques semaines de votes pour voir l'écran de résultats admin ----------
	await db.update(workspace).set({ moodEnabled: true }).where(eq(workspace.id, ws.id));

	const MOOD_MESSAGES = [
		"Sprint chargé mais on avance bien.",
		'Un peu de flou sur les priorités cette semaine.',
		"Bonne ambiance dans l'équipe !",
		'Beaucoup de réunions, moins de temps de dev.',
		'Content de la livraison de vendredi.',
		'Charge un peu élevée en ce moment.',
		'Semaine calme, on a pu souffler.'
	];
	const moodVoteRows: (typeof moodVote.$inferInsert)[] = [];
	for (let weeksAgo = 6; weeksAgo >= 0; weeksAgo--) {
		const periodStart = toISODate(mondayWeeksAgo(weeksAgo));
		const periodEnd = toISODate(addDays(mondayWeeksAgo(weeksAgo), 6));
		// Semaine courante : pas encore terminée, seule une partie de l'équipe a déjà voté.
		const voters = weeksAgo === 0 ? shuffled(SEED_USERS).slice(0, 3) : SEED_USERS;
		// Un coup de mou marqué il y a 3 semaines, pour que la courbe ne soit pas plate.
		const scoreWeights: [number, number][] =
			weeksAgo === 3
				? [[1, 2], [2, 4], [3, 3], [4, 1], [5, 0]]
				: [[1, 1], [2, 2], [3, 4], [4, 5], [5, 3]];
		for (const u of voters) {
			moodVoteRows.push({
				workspaceId: ws.id,
				userId: userByEmail.get(u.email)!.id,
				periodStart,
				periodEnd,
				score: weighted(scoreWeights),
				message: chance(0.35) ? rand(MOOD_MESSAGES) : null
			});
		}
	}
	await db.insert(moodVote).values(moodVoteRows);

	// ---------- Absences : congés/formations passés (déjà pris) et à venir (prévisionnels) ----------
	const absenceRows: (typeof absence.$inferInsert)[] = [];
	for (const u of SEED_USERS) {
		const userId = userByEmail.get(u.email)!.id;

		// 2 à 3 congés déjà posés, étalés sur toute la fenêtre du seed (pas juste les dernières semaines).
		const pastCount = chance(0.5) ? 3 : 2;
		for (let i = 0; i < pastCount; i++) {
			const pastStart = addDays(mondayWeeksAgo(1 + Math.floor(Math.random() * 14)), Math.floor(Math.random() * 5));
			absenceRows.push({
				workspaceId: ws.id,
				userId,
				startDate: toISODate(pastStart),
				endDate: toISODate(addDays(pastStart, chance(0.4) ? 4 : chance(0.5) ? 1 : 0)),
				type: 'CONGE_VALIDE',
				period: 'FULL'
			});
		}

		// 2 demi-journées ou journées de formation / hors-projet, passées.
		for (let i = 0; i < 2; i++) {
			const trainingDay = addDays(mondayWeeksAgo(1 + Math.floor(Math.random() * 14)), Math.floor(Math.random() * 5));
			absenceRows.push({
				workspaceId: ws.id,
				userId,
				startDate: toISODate(trainingDay),
				endDate: toISODate(trainingDay),
				type: rand(['FORMATION', 'HORS_PROJET'] as const),
				period: rand(['FULL', 'AM', 'PM'] as const)
			});
		}

		// Des congés prévisionnels à venir (pas encore validés) — au moins un, parfois deux.
		const futureCount = chance(0.4) ? 2 : 1;
		for (let i = 0; i < futureCount; i++) {
			const futureStart = addDays(mondayWeeksAgo(-1 - Math.floor(Math.random() * 8)), Math.floor(Math.random() * 5));
			absenceRows.push({
				workspaceId: ws.id,
				userId,
				startDate: toISODate(futureStart),
				endDate: toISODate(addDays(futureStart, chance(0.4) ? 4 : 1)),
				type: 'CONGE_PREVISIONNEL',
				period: 'FULL'
			});
		}
	}
	const insertedAbsences = await db.insert(absence).values(absenceRows).returning();

	// Un membre externe (client) — jamais de congé prévisionnel pour lui (posé direct en validé),
	// cf. règle métier dans absences.ts.
	const [client] = await db.insert(externalMember).values({ workspaceId: ws.id, displayName: 'Client Acme' }).returning();
	const clientAbsenceRows: (typeof absence.$inferInsert)[] = Array.from({ length: 3 }, () => {
		const start = addDays(mondayWeeksAgo(1 + Math.floor(Math.random() * 10)), Math.floor(Math.random() * 5));
		return {
			workspaceId: ws.id,
			externalMemberId: client.id,
			startDate: toISODate(start),
			endDate: toISODate(addDays(start, chance(0.3) ? 3 : 0)),
			type: 'CONGE_VALIDE' as const,
			period: 'FULL' as const
		};
	});
	await db.insert(absence).values(clientAbsenceRows);

	// Quelques absences créées puis retirées (erreur de saisie corrigée) — pour peupler les
	// suppressions tracées dans l'historique, en plus des révisions ci-dessous.
	const phantomAbsenceRows: (typeof absence.$inferInsert)[] = SEED_USERS.slice(0, 3).map((u) => ({
		workspaceId: ws.id,
		userId: userByEmail.get(u.email)!.id,
		startDate: toISODate(addDays(mondayWeeksAgo(1 + Math.floor(Math.random() * 3)), Math.floor(Math.random() * 5))),
		endDate: toISODate(addDays(mondayWeeksAgo(1 + Math.floor(Math.random() * 3)), Math.floor(Math.random() * 5))),
		type: 'CONGE_PREVISIONNEL' as const,
		period: 'FULL' as const
	}));
	const insertedPhantomAbsences = await db.insert(absence).values(phantomAbsenceRows).returning();
	await db.delete(absence).where(
		inArray(
			absence.id,
			insertedPhantomAbsences.map((a) => a.id)
		)
	);

	// ---------- Objectifs de la semaine : pour tester la vue globale (/admin/objectifs) et la règle
	// "personne en vacances -> pas d'objectif attribuable" — David est volontairement en vacances la
	// semaine prochaine (vue par défaut de la page) et n'a donc aucun objectif ce jour-là.
	const nextMondayISO = toISODate(mondayWeeksAgo(-1));
	const thisMondayISO = toISODate(currentMonday);
	const assignerId = userByEmail.get(`manon@${SEED_DOMAIN}`)!.id;
	const uid = (email: string) => userByEmail.get(email)!.id;
	const ticketPick = (n: number) => insertedTickets[n % insertedTickets.length];

	await db.insert(weeklyObjective).values([
		// Semaine prochaine (vue par défaut de la page).
		{
			workspaceId: ws.id,
			userId: uid(`bob@${SEED_DOMAIN}`),
			weekMonday: nextMondayISO,
			kind: 'TICKET',
			ticketId: ticketPick(0).id,
			activityId: activityByLabel.get('Dev')!.id,
			createdByUserId: assignerId
		},
		{
			workspaceId: ws.id,
			userId: uid(`bob@${SEED_DOMAIN}`),
			weekMonday: nextMondayISO,
			kind: 'CUSTOM',
			// Libellé volontairement long pour vérifier le rendu (page + export SVG) sur une tâche qui déborde.
			label: 'Finaliser la migration complète de la base clients avec vérification post-déploiement',
			createdByUserId: assignerId
		},
		{
			workspaceId: ws.id,
			userId: uid(`chloe@${SEED_DOMAIN}`),
			weekMonday: nextMondayISO,
			kind: 'TICKET',
			ticketId: ticketPick(1).id,
			activityId: activityByLabel.get('TU')!.id,
			createdByUserId: assignerId
		},
		{
			workspaceId: ws.id,
			userId: uid(`alice@${SEED_DOMAIN}`),
			weekMonday: nextMondayISO,
			kind: 'CUSTOM',
			label: "Revue de code de l'équipe",
			createdByUserId: assignerId
		},
		// Semaine courante (pour tester la navigation "précédent").
		{
			workspaceId: ws.id,
			userId: uid(`bob@${SEED_DOMAIN}`),
			weekMonday: thisMondayISO,
			kind: 'TICKET',
			ticketId: ticketPick(2).id,
			createdByUserId: assignerId
		},
		{
			workspaceId: ws.id,
			userId: uid(`manon@${SEED_DOMAIN}`),
			weekMonday: thisMondayISO,
			kind: 'CUSTOM',
			label: 'Point budget mensuel',
			createdByUserId: assignerId
		}
	]);
	await db.insert(weeklyVacation).values({ workspaceId: ws.id, userId: uid(`david@${SEED_DOMAIN}`), weekMonday: nextMondayISO });

	// ---------- Historique des modifications (change_log) : révisions d'estimation ticket, RAE par
	// activité et absences, + les suppressions ci-dessus — dans les 30 derniers jours (fenêtre
	// affichée par /admin/history), quelle que soit la date réelle du sprint ou de l'absence, pour
	// avoir de quoi filtrer/rechercher/paginer sur cet écran dès le premier chargement.
	const recentTimestamp = (maxDaysAgo = 25) => new Date(Date.now() - Math.random() * maxDaysAgo * 24 * 60 * 60 * 1000);
	const anyUserId = () => userByEmail.get(rand(SEED_USERS).email)!.id;
	const changeLogRows: (typeof changeLog.$inferInsert)[] = [];

	// Révisions de champs budget/estimation, sur ~40% des tickets.
	for (const tk of insertedTickets) {
		if (!chance(0.4)) continue;
		const fields = (['estimationReal', 'estimationTest', 'estimationPrev', 'enveloppeTotale'] as const)
			.map((field) => ({ field, current: tk[field] }))
			.filter((f) => f.current != null);
		if (fields.length === 0) continue;
		const { field, current } = rand(fields) as { field: string; current: string };
		const oldValue = String(Math.max(0, round(Number(current) - rand([1, 1.5, 2, 3, -1, -2]))));
		if (oldValue === current) continue;
		changeLogRows.push({
			workspaceId: ws.id,
			entityType: 'TICKET',
			entityId: tk.id,
			field,
			action: 'UPDATE',
			oldValue,
			newValue: current,
			changedById: anyUserId(),
			createdAt: recentTimestamp()
		});
	}

	// Révisions de RAE par activité, sur ~25% des lignes déjà générées plus haut.
	for (const row of activityRaeRows) {
		if (!chance(0.25) || !row.ticketId || !row.activityId) continue;
		const field = rand(['raeReal', 'raeTest'] as const);
		const current = row[field] as string;
		const oldValue = String(Math.max(0, round(Number(current) + rand([1, 1.5, 2, -1, -1.5]))));
		if (oldValue === current) continue;
		changeLogRows.push({
			workspaceId: ws.id,
			entityType: 'TICKET',
			entityId: row.ticketId,
			activityId: row.activityId,
			field,
			action: 'UPDATE',
			oldValue,
			newValue: current,
			changedById: anyUserId(),
			createdAt: recentTimestamp()
		});
	}

	// Révisions d'absences (dates ajustées après coup), sur ~25% des absences déjà posées.
	for (const a of insertedAbsences) {
		if (!chance(0.25)) continue;
		changeLogRows.push({
			workspaceId: ws.id,
			entityType: 'ABSENCE',
			entityId: a.id,
			field: 'endDate',
			action: 'UPDATE',
			oldValue: toISODate(addDays(parseISODate(a.endDate), chance(0.5) ? 1 : -1)),
			newValue: a.endDate,
			changedById: a.userId ?? anyUserId(),
			createdAt: recentTimestamp()
		});
	}

	// Les 3 absences retirées plus haut — une ligne de suppression chacune.
	for (const a of insertedPhantomAbsences) {
		changeLogRows.push({
			workspaceId: ws.id,
			entityType: 'ABSENCE',
			entityId: a.id,
			action: 'DELETE',
			oldValue: `${a.startDate} → ${a.endDate} (${a.type})`,
			newValue: null,
			changedById: a.userId ?? anyUserId(),
			createdAt: recentTimestamp(10)
		});
	}

	for (const batch of chunk(changeLogRows, 500)) await db.insert(changeLog).values(batch);

	// ---------- Résumé ----------
	const totalAbsences = insertedAbsences.length + clientAbsenceRows.length;
	console.log(
		`\n✓ "${WORKSPACE_NAME}" créé — ${insertedTickets.length} tickets sur ${SPRINT_DEFS.length} sprints / ${VERSION_NAMES.length} versions, ` +
			`${entryDrafts.length} imputations (${allDays.length} jours ouvrés, du ${allDays[0]} au ${allDays[allDays.length - 1]}), ${snapshotRows.length} snapshots, ${moodVoteRows.length} votes team mood sur 7 semaines, ${totalAbsences} absences (dont 1 membre externe), ${changeLogRows.length} entrées d'historique, 6 objectifs de semaine (dont David en vacances la semaine prochaine, sans objectif).\n`
	);
	console.log('Comptes :');
	for (const u of SEED_USERS) console.log(`  ${u.email.padEnd(24)} ${u.password.padEnd(12)} (${u.role})`);
	console.log(`\nPour repartir de zéro : npm run db:unseed`);
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
