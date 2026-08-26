// Environnement de test jetable : espace "QA Sandbox", 4 comptes, ~4 mois d'historique sur
// 8 sprints / 4 versions / 3 projets, imputations + snapshots cohérents dans le temps — de quoi
// avoir une vraie vision d'un projet global (pas juste un instantané d'une semaine).
// Tout est ancré sur la date du jour au moment de l'exécution (jamais de date figée en dur).
//
// Usage : npm run db:seed   (déploie/rafraîchit)
//         npm run db:unseed (supprime tout)
//
// Échelle (tests de charge, cf. loadtest/README.md) : SEED_WORKSPACES/SEED_USERS_PER_WS/
// SEED_TICKETS_PER_WS/SEED_WEEKS — voir getSeedScale() dans seed.shared.ts. Sans ces variables,
// comportement strictement identique à avant (1 espace, 5 comptes, ~36 tickets, ~15 semaines).
import { eq, inArray } from 'drizzle-orm';
import { hashPassword } from '../auth/password';
import { DEFAULT_STATES, DEFAULT_ACTIVITIES, DEFAULT_CATEGORIES } from '../services/defaults';
import { round, plannedDays } from '../services/calc';
// Type seulement : ce module importe $lib/server/db (singleton lié à $env, indisponible sous tsx
// nu) — voir la note sur l'alias $lib en tête de jira-sync.ts pour la même contrainte. Le calcul
// ci-dessous reste donc une version locale, sur les données déjà en mémoire pendant le seed.
import type { WrappedPayload } from '../services/wrapped';
import {
	toISODate,
	addDays,
	mondayOf,
	parseISODate,
	todayInParis,
	isPublicHolidayFR,
	currentSupportPeriod,
	supportPeriodIndex,
	monthRange,
	countWorkdaysNonHoliday,
	workdaysBetween,
	formatMonthLabel
} from '../../utils/date';
import {
	workspace,
	user,
	membership,
	state,
	activity,
	category,
	project,
	ssp,
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
	weeklyVacation,
	jiraSyncRun,
	supportRotationMember,
	supportOverride,
	monthlyClosing,
	monthlyClosingLine,
	monthlyClosingMember,
	wrappedSnapshot
} from './schema';
import { getDb, wipeSandbox, WORKSPACE_NAME, SEED_DOMAIN, SEED_USERS, getSeedScale, type SeedScale } from './seed.shared';

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

// ---------- Personas : les 5 comptes nommés (identiques à avant par défaut) + comptes
// synthétiques au-delà, pour SEED_USERS_PER_WS. `slot` = identifiant stable (alice, bob, user6…)
// indépendant de l'email réel (suffixé par workspace dès que SEED_WORKSPACES > 1, l'email doit
// rester unique globalement). ----------
type Persona = { slot: string; displayName: string; email: string; password: string; role: 'ADMIN' | 'USER' | 'MANAGER' };
const EXTRA_ROLE_CYCLE = ['USER', 'USER', 'USER', 'MANAGER'] as const;

function buildPersonas(usersPerWorkspace: number, wsSuffix: string): Persona[] {
	const base: Persona[] = SEED_USERS.map((u) => {
		const slot = u.email.split('@')[0];
		return { slot, displayName: u.displayName, email: `${slot}${wsSuffix}@${SEED_DOMAIN}`, password: u.password, role: u.role };
	});
	const extra: Persona[] = [];
	for (let i = base.length; i < usersPerWorkspace; i++) {
		const slot = `user${i + 1}`;
		extra.push({
			slot,
			displayName: `Load User ${i + 1}`,
			email: `${slot}${wsSuffix}@${SEED_DOMAIN}`,
			password: 'loadtest123',
			role: EXTRA_ROLE_CYCLE[i % EXTRA_ROLE_CYCLE.length]
		});
	}
	return [...base, ...extra];
}

// ---------- Chronologie : sprints de 2 semaines jusqu'à `weeks` semaines en arrière, 4 versions en
// rotation. weeks=15 (défaut) reproduit exactement les 8 sprints historiques. ----------
const VERSION_NAMES = ['V1.0', 'V1.1', 'V1.2', 'V1.3'];
const PROJECT_NAMES = ['Mobile', 'Web', 'Backend'] as const;
const SSP_DEFS = [
	{ code: '8364BEB5354', label: 'Site Internet', budget: 350 },
	{ code: '123DBS34842', label: 'Appli Mob', budget: 213.75 },
	{ code: '774FCA9021', label: 'AMOE', budget: 100 },
	{ code: '5182ECD7730', label: 'TNR', budget: 7 },
	{ code: '6093AFB1146', label: 'Qualification', budget: 458 }
];

function buildSprintDefs(weeks: number) {
	const sprintCount = Math.max(1, Math.round(weeks / 2));
	return Array.from({ length: sprintCount }, (_, i) => {
		const startWeeksAgo = weeks - 2 * i;
		return {
			name: `Sprint ${9 + i}`,
			startWeeksAgo,
			endWeeksAgo: Math.max(0, startWeeksAgo - 1),
			version: VERSION_NAMES[Math.floor(i / 2) % VERSION_NAMES.length]
		};
	});
}

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

/**
 * États plausibles selon l'ancienneté du sprint : `age` 0 = le plus vieux, `mostRecentAge` = sprint
 * courant. On raisonne en distance au sprint courant plutôt qu'en `age` absolu, pour rester correct
 * quel que soit le nombre de sprints généré (cf. `SEED_WEEKS`) — reproduit exactement les seuils
 * historiques (8 sprints, mostRecentAge=7) une fois retraduits en distance.
 */
function statesForAge(age: number, mostRecentAge: number): [string, number][] {
	const distanceFromNow = mostRecentAge - age;
	if (distanceFromNow >= 6) return [['En production', 6], ['A mettre en production', 2], ['Retour recette', 1]];
	if (distanceFromNow >= 4) return [['En production', 5], ['En recette métier', 2], ['Retour recette', 1], ['Defect', 1]];
	if (distanceFromNow >= 2) return [['En qualif', 3], ['A mettre en qualif', 2], ['En production', 2], ['Defect', 1]];
	if (distanceFromNow === 1) return [['En cours de dev', 3], ['En MR', 3], ['A mettre en qualif', 2], ['Defect', 1]];
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

// Activités plausibles par persona nommée (slot) — comptes synthétiques au-delà : profil générique.
const USER_ACTIVITIES: Record<string, string[]> = {
	alice: ['Dev', 'TU'],
	bob: ['Dev', 'Infra'],
	chloe: ['TU', 'TNR', 'Analyse'],
	david: ['Dev', 'Relecture', 'DA'],
	manon: ['Analyse', 'Relecture']
};
const DEFAULT_PERSONA_ACTIVITIES = ['Dev', 'TU', 'Analyse'];
function activitiesFor(slot: string) {
	return USER_ACTIVITIES[slot] ?? DEFAULT_PERSONA_ACTIVITIES;
}

/** Génère un espace complet (référentiels, tickets, imputations, mood, absences, objectifs…). */
async function seedOneWorkspace(db: ReturnType<typeof getDb>, wsName: string, personas: Persona[], scale: SeedScale) {
	const sprintDefs = buildSprintDefs(scale.weeks);

	// ---------- Utilisateurs + espace ----------
	const passwordHashes = await Promise.all(personas.map((p) => hashPassword(p.password)));
	const insertedUsers = await db
		.insert(user)
		.values(personas.map((p, i) => ({ displayName: p.displayName, email: p.email, passwordHash: passwordHashes[i] })))
		.returning();
	const userByEmail = new Map(insertedUsers.map((u) => [u.email, u]));
	const bySlot = (slot: string) => userByEmail.get(personas.find((p) => p.slot === slot)!.email)!;

	const [ws] = await db
		.insert(workspace)
		.values({ name: wsName, allowedDomain: SEED_DOMAIN, createdByUserId: bySlot('alice').id })
		.returning();

	await db.insert(membership).values(
		personas.map((p) => ({
			workspaceId: ws.id,
			userId: userByEmail.get(p.email)!.id,
			role: p.role,
			capacityPerDay: p.slot === 'bob' ? '0.8' : '1' // un temps partiel pour voir le % de capacité varier
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
		.values(
			DEFAULT_CATEGORIES.map((c) => ({
				workspaceId: ws.id,
				label: c.label,
				kind: c.kind,
				linkedAbsenceType: c.linkedAbsenceType ?? null
			}))
		)
		.returning();

	const stateByLabel = new Map(insertedStates.map((s) => [s.label, s]));
	const activityByLabel = new Map(insertedActivities.map((a) => [a.label, a]));
	const categoryByLabel = new Map(insertedCategories.map((c) => [c.label, c]));

	// Codes SSP réalistes (format Sopra Steria) — la plupart des tickets en portent un désormais
	// qu'il s'agit d'un référentiel : la clôture mensuelle n'a rien à montrer sans eux.
	const insertedSsps = await db
		.insert(ssp)
		.values(SSP_DEFS.map((d) => ({ workspaceId: ws.id, code: d.code, label: d.label, budgetDays: String(d.budget) })))
		.returning();

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
		.values(sprintDefs.map((s, i) => ({ workspaceId: ws.id, name: s.name, kind: 'SPRINT' as const, sortOrder: i })))
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

	const sprintWindows = sprintDefs.map((s) => ({
		...s,
		from: toISODate(mondayWeeksAgo(s.startWeeksAgo)),
		to: toISODate(fridayWeeksAgo(s.endWeeksAgo) < today ? fridayWeeksAgo(s.endWeeksAgo) : today)
	}));
	const rangeStart = mondayWeeksAgo(sprintDefs[0].startWeeksAgo);
	const allDays: string[] = [];
	for (let d = rangeStart; d <= today; d = addDays(d, 1)) {
		const dow = d.getUTCDay();
		if (dow !== 0 && dow !== 6 && !isPublicHolidayFR(toISODate(d))) allDays.push(toISODate(d));
	}
	function sprintForDay(dayISO: string) {
		return sprintWindows.find((s) => dayISO >= s.from && dayISO <= s.to);
	}

	// ---------- Tickets : 4 par sprint + 4 en backlog, sans sprint/version ----------
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
	const mostRecentAge = sprintWindows.length - 1;
	sprintWindows.forEach((sw, age) => {
		for (let i = 0; i < 4; i++) {
			const proj = PROJECT_NAMES[(age * 4 + i) % PROJECT_NAMES.length];
			drafts.push({
				key: `SBX-${ticketNum++}`,
				title: nextTitle(proj),
				project: proj,
				sprintName: sw.name,
				versionName: chance(0.85) ? sw.version : undefined, // ~15% de tickets techniques hors version
				state: weighted(statesForAge(age, mostRecentAge)),
				estimationReal: weighted(ESTIMATION_CHOICES),
				estimationTest: chance(0.5) ? weighted<number>([[1, 3], [2, 2], [3, 1]]) : null,
				owner: personas[(age * 4 + i) % personas.length].email,
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
			owner: rand(personas).email
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
				sspId: chance(0.85) ? rand(insertedSsps).id : null,
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

	// ---------- Historique de sync Jira : peuple l'onglet Admin > Jira (historique + "Annuler ce
	// lot") sans dépendre d'un PAT/JQL réel — l'historique est append-only (contrairement à
	// workspace.jiraLastSync*), un espace peut donc très bien en avoir sans être configuré là
	// maintenant. Import initial : tout le lot curaté (hors top-up bulk, volontairement hors
	// périmètre) — déjà chiffré/imputé par la suite, donc plus annulable (réaliste). Run récent :
	// quelques tickets tels qu'un vrai sync les crée (juste key/title/projectId, cf. jiraSync.ts),
	// sans passer par TicketDraft qui leur donnerait toujours un état — sinon aucun ne serait plus
	// jamais "vierge" et "Annuler ce lot" n'aurait jamais rien à supprimer dans la démo.
	const [jiraInitialRun] = await db
		.insert(jiraSyncRun)
		.values({
			workspaceId: ws.id,
			startedAt: mondayWeeksAgo(sprintDefs[0].startWeeksAgo),
			status: 'SUCCESS',
			ticketsSeen: insertedTickets.length,
			ticketsCreated: insertedTickets.length
		})
		.returning({ id: jiraSyncRun.id });
	await db
		.update(ticket)
		.set({ createdBySyncRunId: jiraInitialRun.id })
		.where(inArray(ticket.id, insertedTickets.map((t) => t.id)));

	const recentTicketDefs = [
		{ key: `SBX-${ticketNum++}`, title: 'Export audit RGPD', project: 'Backend' as const },
		{ key: `SBX-${ticketNum++}`, title: 'Refonte formulaire contact', project: 'Web' as const },
		{ key: `SBX-${ticketNum++}`, title: 'Correctif notif push Android', project: 'Mobile' as const }
	];
	const insertedRecentTickets = await db
		.insert(ticket)
		.values(recentTicketDefs.map((t) => ({ workspaceId: ws.id, key: t.key, title: t.title, projectId: projectByName.get(t.project)!.id })))
		.returning({ id: ticket.id });
	const [jiraRecentRun] = await db
		.insert(jiraSyncRun)
		.values({
			workspaceId: ws.id,
			startedAt: addDays(today, -1),
			status: 'SUCCESS',
			ticketsSeen: insertedRecentTickets.length,
			ticketsCreated: insertedRecentTickets.length
		})
		.returning({ id: jiraSyncRun.id });
	await db
		.update(ticket)
		.set({ createdBySyncRunId: jiraRecentRun.id })
		.where(inArray(ticket.id, insertedRecentTickets.map((t) => t.id)));

	await db.insert(jiraSyncRun).values({
		workspaceId: ws.id,
		startedAt: new Date(),
		status: 'ERROR',
		error: '401 Unauthorized : le token Jira (PAT) semble invalide ou expiré.'
	});

	// ---------- Top-up : tickets bulk supplémentaires pour atteindre SEED_TICKETS_PER_WS (tests de
	// charge) — pas d'imputation/snapshot dessus, juste du volume pour stresser liste/kanban/dashboard.
	if (scale.ticketsPerWorkspace > insertedTickets.length) {
		const bulkCount = scale.ticketsPerWorkspace - insertedTickets.length;
		const bulkStates = [...DONE_STATES, 'En cours de dev', 'En qualif', 'En MR'];
		const bulkDrafts = Array.from({ length: bulkCount }, (_, i) => {
			const proj = PROJECT_NAMES[i % PROJECT_NAMES.length];
			const sw = rand(sprintWindows);
			const est = weighted(ESTIMATION_CHOICES);
			return {
				workspaceId: ws.id,
				key: `SBX-${ticketNum++}`,
				title: `${nextTitle(proj)} #${i + 1}`,
				projectId: projectByName.get(proj)!.id,
				sprintId: chance(0.7) ? sprintByName.get(sw.name)!.id : null,
				versionId: chance(0.5) ? versionByName.get(sw.version)!.id : null,
				stateId: stateByLabel.get(rand(bulkStates))?.id ?? null,
				estimationReal: String(est),
				raeReal: String(est)
			};
		});
		for (const batch of chunk(bulkDrafts, 500)) await db.insert(ticket).values(batch);
	}

	// ---------- Imputations : glissantes sur `scale.weeks` semaines, ancrées sur le sprint actif à
	// chaque date ----------
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

		for (const p of personas) {
			const userId = userByEmail.get(p.email)!.id;
			if (chance(0.1)) {
				entryDrafts.push({ userId, targetType: 'CATEGORY', categoryId: categoryByLabel.get('Congé')!.id, activityId: null, day, amount: 1 });
				continue;
			}
			if (chance(0.05)) {
				entryDrafts.push({ userId, targetType: 'CATEGORY', categoryId: categoryByLabel.get('Formation')!.id, activityId: null, day, amount: 1 });
				continue;
			}
			// Ticket "possédé" ce sprint par la personne, sinon coup de main sur un ticket du sprint.
			const owned = sprintTickets.filter((t) => t.owner === p.email);
			const primary = owned.length > 0 ? rand(owned) : rand(sprintTickets);
			const personaActivities = activitiesFor(p.slot);

			const splitDay = chance(0.25) && sprintTickets.length > 1;
			const picks = splitDay ? [primary, rand(sprintTickets.filter((t) => t.key !== primary.key))] : [primary];
			const amounts = splitDay ? [0.75, 0.25] : [1];
			picks.forEach((t, i) => {
				const tk = ticketByKey.get(t.key)!;
				const activityLabel = rand(personaActivities);
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

	// ---------- Clôtures mensuelles (/admin/cloture) : une passe INTEGRATED par mois déjà passé de
	// la fenêtre du seed (conso figée à la photo réelle des imputations ci-dessus), une passe DRAFT
	// sur le mois en cours — pour un écran qui a déjà de l'historique au premier chargement, plutôt
	// qu'un "Ouvrir la clôture" sur une page vide.
	const sspIdByTicketId = new Map(insertedTickets.map((t) => [t.id, t.sspId]));
	const linkedAbsenceCategoryIds = new Set(['Congé', 'Formation'].map((l) => categoryByLabel.get(l)!.id));
	type MonthAgg = { consoBySsp: Map<string, Map<string, number>>; absenceDays: Map<string, number> };
	const aggByMonth = new Map<string, MonthAgg>();
	function monthAgg(monthKey: string): MonthAgg {
		let agg = aggByMonth.get(monthKey);
		if (!agg) {
			agg = { consoBySsp: new Map(), absenceDays: new Map() };
			aggByMonth.set(monthKey, agg);
		}
		return agg;
	}
	for (const d of entryDrafts) {
		const agg = monthAgg(d.day.slice(0, 7));
		if (d.targetType === 'CATEGORY' && d.categoryId && linkedAbsenceCategoryIds.has(d.categoryId)) {
			agg.absenceDays.set(d.userId, round((agg.absenceDays.get(d.userId) ?? 0) + d.amount));
			continue;
		}
		const sspId = d.ticketId ? sspIdByTicketId.get(d.ticketId) : null;
		if (!sspId) continue;
		const byUser = agg.consoBySsp.get(d.userId) ?? new Map<string, number>();
		byUser.set(sspId, round((byUser.get(sspId) ?? 0) + d.amount));
		agg.consoBySsp.set(d.userId, byUser);
	}

	const currentMonthKey = todayInParis().slice(0, 7);
	const monthKeys = [...new Set(allDays.map((d) => d.slice(0, 7)))].sort();
	for (const monthKey of monthKeys) {
		const isCurrent = monthKey === currentMonthKey;
		const { from, to } = monthRange(monthKey);
		const workdays = countWorkdaysNonHoliday(from, to);
		const agg = monthAgg(monthKey);

		const [closing] = await db
			.insert(monthlyClosing)
			.values({
				workspaceId: ws.id,
				month: `${monthKey}-01`,
				seq: 1,
				status: isCurrent ? 'DRAFT' : 'INTEGRATED',
				integratedAt: isCurrent ? null : new Date(`${to}T18:00:00`),
				integratedById: isCurrent ? null : bySlot('alice').id
			})
			.returning();

		const memberRows: (typeof monthlyClosingMember.$inferInsert)[] = [];
		const lineRows: (typeof monthlyClosingLine.$inferInsert)[] = [];
		for (const p of personas) {
			const userId = userByEmail.get(p.email)!.id;
			// Bob (temps partiel) a un prévu ajusté à la main sur le dernier mois passé — pour montrer
			// l'override en plus du calcul automatique.
			const isLatestPastMonth = !isCurrent && monthKey === monthKeys.filter((k) => k !== currentMonthKey).at(-1);
			const plannedOverride = p.slot === 'bob' && isLatestPastMonth ? workdays - 1 : null;
			const planned = plannedOverride ?? plannedDays(workdays, agg.absenceDays.get(userId) ?? 0);
			memberRows.push({
				closingId: closing.id,
				userId,
				plannedOverride: plannedOverride != null ? String(plannedOverride) : null,
				plannedSnapshot: isCurrent ? null : String(planned)
			});

			for (const [sspId, consoAmount] of agg.consoBySsp.get(userId) ?? []) {
				// Petit rattrapage de fin de mois sur ~15% des lignes, comme un admin qui complète avant
				// bascule GPS — sinon "à ventiler" tombe toujours pile à 0, jamais crédible.
				const complement = chance(0.15) ? rand([0.25, 0.5, 1]) : 0;
				lineRows.push({
					closingId: closing.id,
					userId,
					sspId,
					complement: String(complement),
					consoSnapshot: isCurrent ? null : String(consoAmount)
				});
			}
		}
		await db.insert(monthlyClosingMember).values(memberRows);
		if (lineRows.length) await db.insert(monthlyClosingLine).values(lineRows);
	}

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
		const voters = weeksAgo === 0 ? shuffled(personas).slice(0, Math.min(3, personas.length)) : personas;
		// Un coup de mou marqué il y a 3 semaines, pour que la courbe ne soit pas plate.
		const scoreWeights: [number, number][] =
			weeksAgo === 3
				? [[1, 2], [2, 4], [3, 3], [4, 1], [5, 0]]
				: [[1, 1], [2, 2], [3, 4], [4, 5], [5, 3]];
		for (const p of voters) {
			moodVoteRows.push({
				workspaceId: ws.id,
				userId: userByEmail.get(p.email)!.id,
				periodStart,
				periodEnd,
				score: weighted(scoreWeights),
				message: chance(0.35) ? rand(MOOD_MESSAGES) : null
			});
		}
	}
	await db.insert(moodVote).values(moodVoteRows);

	// ---------- Perm support (rotation "qui regarde les tickets") : activée, tous les personas dans
	// la chaîne (dans leur ordre habituel), + un override sur la période courante pour voir ce cas
	// (badge "remplacé") à l'écran sans attendre une vraie absence. Cadence WEEK = le défaut colonne,
	// jamais changée explicitement ici. ----------
	await db.update(workspace).set({ supportEnabled: true }).where(eq(workspace.id, ws.id));

	const rotationUserIds = personas.map((p) => userByEmail.get(p.email)!.id);
	await db
		.insert(supportRotationMember)
		.values(rotationUserIds.map((userId, i) => ({ workspaceId: ws.id, userId, sortOrder: i })));

	const currentPeriodStart = currentSupportPeriod('WEEK', toISODate(today), false).start;
	const normalIndex =
		((supportPeriodIndex('WEEK', currentPeriodStart, false) % rotationUserIds.length) + rotationUserIds.length) %
		rotationUserIds.length;
	const overrideUserId = rotationUserIds[(normalIndex + 1) % rotationUserIds.length];
	await db.insert(supportOverride).values({ workspaceId: ws.id, periodStart: currentPeriodStart, userId: overrideUserId });

	// ---------- Absences : congés/formations passés (déjà pris) et à venir (prévisionnels) ----------
	const absenceRows: (typeof absence.$inferInsert)[] = [];
	for (const p of personas) {
		const userId = userByEmail.get(p.email)!.id;

		// 2 à 3 congés déjà posés, étalés sur toute la fenêtre du seed (pas juste les dernières semaines).
		const pastCount = chance(0.5) ? 3 : 2;
		for (let i = 0; i < pastCount; i++) {
			const pastStart = addDays(mondayWeeksAgo(1 + Math.floor(Math.random() * Math.max(1, scale.weeks - 1))), Math.floor(Math.random() * 5));
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
			const trainingDay = addDays(mondayWeeksAgo(1 + Math.floor(Math.random() * Math.max(1, scale.weeks - 1))), Math.floor(Math.random() * 5));
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
		const start = addDays(mondayWeeksAgo(1 + Math.floor(Math.random() * Math.max(1, scale.weeks - 5))), Math.floor(Math.random() * 5));
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
	const phantomAbsenceRows: (typeof absence.$inferInsert)[] = personas.slice(0, Math.min(3, personas.length)).map((p) => ({
		workspaceId: ws.id,
		userId: userByEmail.get(p.email)!.id,
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
	const assignerId = bySlot('manon').id;
	const ticketPick = (n: number) => insertedTickets[n % insertedTickets.length];

	await db.insert(weeklyObjective).values([
		// Semaine prochaine (vue par défaut de la page).
		{
			workspaceId: ws.id,
			userId: bySlot('bob').id,
			weekMonday: nextMondayISO,
			kind: 'TICKET',
			ticketId: ticketPick(0).id,
			activityId: activityByLabel.get('Dev')!.id,
			createdByUserId: assignerId
		},
		{
			workspaceId: ws.id,
			userId: bySlot('bob').id,
			weekMonday: nextMondayISO,
			kind: 'CUSTOM',
			// Libellé volontairement long pour vérifier le rendu (page + export SVG) sur une tâche qui déborde.
			label: 'Finaliser la migration complète de la base clients avec vérification post-déploiement',
			createdByUserId: assignerId
		},
		{
			workspaceId: ws.id,
			userId: bySlot('chloe').id,
			weekMonday: nextMondayISO,
			kind: 'TICKET',
			ticketId: ticketPick(1).id,
			activityId: activityByLabel.get('TU')!.id,
			createdByUserId: assignerId
		},
		{
			workspaceId: ws.id,
			userId: bySlot('alice').id,
			weekMonday: nextMondayISO,
			kind: 'CUSTOM',
			label: "Revue de code de l'équipe",
			createdByUserId: assignerId
		},
		// Semaine courante (pour tester la navigation "précédent").
		{
			workspaceId: ws.id,
			userId: bySlot('bob').id,
			weekMonday: thisMondayISO,
			kind: 'TICKET',
			ticketId: ticketPick(2).id,
			createdByUserId: assignerId
		},
		{
			workspaceId: ws.id,
			userId: bySlot('manon').id,
			weekMonday: thisMondayISO,
			kind: 'CUSTOM',
			label: 'Point budget mensuel',
			createdByUserId: assignerId
		}
	]);
	await db.insert(weeklyVacation).values({ workspaceId: ws.id, userId: bySlot('david').id, weekMonday: nextMondayISO });

	// ---------- Historique des modifications (change_log) : révisions d'estimation ticket, RAE par
	// activité et absences, + les suppressions ci-dessus — dans les 30 derniers jours (fenêtre
	// affichée par /admin/history), quelle que soit la date réelle du sprint ou de l'absence, pour
	// avoir de quoi filtrer/rechercher/paginer sur cet écran dès le premier chargement.
	const recentTimestamp = (maxDaysAgo = 25) => new Date(Date.now() - Math.random() * maxDaysAgo * 24 * 60 * 60 * 1000);
	const anyUserId = () => userByEmail.get(rand(personas).email)!.id;
	const changeLogRows: (typeof changeLog.$inferInsert)[] = [];

	// Révisions de champs budget/estimation, sur ~40% des tickets (curatés — pas le top-up bulk).
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

	// ---------- Wrapped : figé directement sur les données déjà en mémoire (entryDrafts,
	// moodVoteRows, rotationUserIds…) plutôt que via computeUserWrapped/runWrapped, qui vivent
	// derrière $lib/server/db — indisponible sous tsx nu (cf. note d'import plus haut). Année en
	// cours au moment du seed, arrêtée au 30 novembre comme computeUserWrapped (cf. sa docstring) ;
	// /wrapped?preview=1 (ADMIN) permet de la consulter sans attendre la vraie fenêtre du 1 déc → 5
	// jan. ----------
	const wrappedYear = today.getUTCFullYear();
	const ticketById = new Map(insertedTickets.map((t) => [t.id, t]));
	const categoryKindById = new Map(insertedCategories.map((c) => [c.id, c.kind]));
	const wrappedFromISO = `${wrappedYear}-01-01`;
	const wrappedToISO = `${wrappedYear}-11-30`;
	const yearDrafts = entryDrafts.filter((d) => d.day >= wrappedFromISO && d.day <= wrappedToISO);

	// Périodes de perm (cadence WEEK, jamais changée dans ce seed) sur l'année du wrapped — mêmes
	// deux lignes que pickFromChain (support.ts), non importées pour la même raison que ci-dessus.
	const supportPeriodStarts: string[] = [];
	const seenSupportPeriods = new Set<string>();
	for (let d = parseISODate(wrappedFromISO); d <= parseISODate(wrappedToISO); d = addDays(d, 1)) {
		const { start } = currentSupportPeriod('WEEK', toISODate(d), false);
		if (!seenSupportPeriods.has(start)) {
			seenSupportPeriods.add(start);
			supportPeriodStarts.push(start);
		}
	}

	for (const p of personas) {
		const userId = userByEmail.get(p.email)!.id;
		const mine = yearDrafts.filter((d) => d.userId === userId);

		const totalHours = round(mine.reduce((s, d) => s + d.amount, 0));
		const productiveHours = mine.reduce((s, d) => {
			const productive = d.targetType === 'TICKET' || categoryKindById.get(d.categoryId!) === 'PRODUCTIVE';
			return s + (productive ? d.amount : 0);
		}, 0);
		const productivePct = totalHours > 0 ? round((productiveHours / totalHours) * 100) : 0;

		const hoursByTicket = new Map<string, number>();
		for (const d of mine) if (d.targetType === 'TICKET') hoursByTicket.set(d.ticketId!, (hoursByTicket.get(d.ticketId!) ?? 0) + d.amount);
		const topTicketId = [...hoursByTicket.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
		const topTicket = topTicketId
			? { key: ticketById.get(topTicketId)!.key, title: ticketById.get(topTicketId)!.title, hours: round(hoursByTicket.get(topTicketId)!) }
			: null;

		const daySet = new Set(mine.map((d) => d.day));
		let streak = 0;
		let streakDays = 0;
		for (const day of workdaysBetween(wrappedFromISO, wrappedToISO)) {
			if (daySet.has(day)) {
				streak++;
				streakDays = Math.max(streakDays, streak);
			} else streak = 0;
		}

		const myMoodRows = moodVoteRows.filter((r) => r.userId === userId && r.periodStart >= wrappedFromISO && r.periodStart <= wrappedToISO);
		let moodAvg: number | null = null;
		let moodBestMonth: string | null = null;
		let moodWorstMonth: string | null = null;
		if (myMoodRows.length > 0) {
			moodAvg = round(myMoodRows.reduce((s, r) => s + r.score, 0) / myMoodRows.length);
			const byMonth = new Map<string, number[]>();
			for (const r of myMoodRows) {
				const monthKey = r.periodStart.slice(0, 7);
				(byMonth.get(monthKey) ?? byMonth.set(monthKey, []).get(monthKey)!).push(r.score);
			}
			const monthAverages = [...byMonth.entries()]
				.map(([monthKey, scores]) => ({ monthKey, avg: scores.reduce((a, b) => a + b, 0) / scores.length }))
				.sort((a, b) => b.avg - a.avg);
			moodBestMonth = formatMonthLabel(`${monthAverages[0].monthKey}-01`);
			moodWorstMonth = formatMonthLabel(`${monthAverages[monthAverages.length - 1].monthKey}-01`);
		}

		let supportCount = 0;
		for (const start of supportPeriodStarts) {
			const idx = ((supportPeriodIndex('WEEK', start, false) % rotationUserIds.length) + rotationUserIds.length) % rotationUserIds.length;
			const effective = start === currentPeriodStart ? overrideUserId : rotationUserIds[idx];
			if (effective === userId) supportCount++;
		}

		const myTicketIds = new Set(hoursByTicket.keys());
		const duoCounts = new Map<string, number>();
		for (const other of personas) {
			if (other.email === p.email) continue;
			const otherId = userByEmail.get(other.email)!.id;
			const otherTicketIds = new Set(yearDrafts.filter((d) => d.userId === otherId && d.targetType === 'TICKET').map((d) => d.ticketId!));
			const shared = [...myTicketIds].filter((id) => otherTicketIds.has(id)).length;
			if (shared > 0) duoCounts.set(otherId, shared);
		}
		const topDuo = [...duoCounts.entries()].sort((a, b) => b[1] - a[1])[0];
		const duo = topDuo
			? { userId: topDuo[0], displayName: personas.find((x) => userByEmail.get(x.email)!.id === topDuo[0])!.displayName, ticketsInCommon: topDuo[1] }
			: null;

		const payload: WrappedPayload = {
			year: wrappedYear,
			totalHours,
			productivePct,
			topTicket,
			streakDays,
			moodEnabled: true,
			moodAvg,
			moodBestMonth,
			moodWorstMonth,
			supportEnabled: true,
			supportCount,
			duo
		};
		await db
			.insert(wrappedSnapshot)
			.values({ workspaceId: ws.id, userId, year: wrappedYear, payload })
			.onConflictDoUpdate({
				target: [wrappedSnapshot.workspaceId, wrappedSnapshot.userId, wrappedSnapshot.year],
				set: { payload, generatedAt: new Date() }
			});
	}

	const totalTickets =
		insertedTickets.length + insertedRecentTickets.length + Math.max(0, scale.ticketsPerWorkspace - insertedTickets.length);
	const totalAbsences = insertedAbsences.length + clientAbsenceRows.length;
	console.log(
		`✓ "${wsName}" créé — ${totalTickets} tickets sur ${sprintDefs.length} sprints / ${VERSION_NAMES.length} versions, ` +
			`${entryDrafts.length} imputations (${allDays.length} jours ouvrés, du ${allDays[0]} au ${allDays[allDays.length - 1]}), ${snapshotRows.length} snapshots, ${moodVoteRows.length} votes team mood sur 7 semaines, ${totalAbsences} absences (dont 1 membre externe), ${changeLogRows.length} entrées d'historique, 6 objectifs de semaine (dont David en vacances la semaine prochaine, sans objectif), 3 runs de sync Jira (import initial de ${insertedTickets.length} tickets, run récent de ${insertedRecentTickets.length} tickets encore annulables, 1 en échec), perm support activée (${rotationUserIds.length} personnes en rotation, 1 override sur la période courante), ${monthKeys.length} clôtures mensuelles (${monthKeys.length - 1} intégrées + 1 en brouillon sur ${currentMonthKey}), wrapped ${wrappedYear} figé pour ${personas.length} personnes (voir /wrapped?preview=1 en ADMIN).`
	);
	for (const p of personas) console.log(`  ${p.email.padEnd(32)} ${p.password.padEnd(14)} (${p.role})`);
}

async function main() {
	const db = getDb();
	const scale = getSeedScale();
	console.log(`Nettoyage d'un éventuel "${WORKSPACE_NAME}" précédent…`);
	await wipeSandbox(db);

	for (let i = 0; i < scale.workspaces; i++) {
		const wsSuffix = scale.workspaces > 1 ? `+ws${i + 1}` : '';
		const wsName = scale.workspaces > 1 ? `${WORKSPACE_NAME} ${i + 1}` : WORKSPACE_NAME;
		const personas = buildPersonas(scale.usersPerWorkspace, wsSuffix);
		await seedOneWorkspace(db, wsName, personas, scale);
	}

	console.log(`\n${scale.workspaces} espace(s) créé(s). Pour repartir de zéro : npm run db:unseed`);
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
