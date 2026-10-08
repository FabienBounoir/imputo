import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, exists, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { alias, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import {
	db,
	ticket,
	ticketImport,
	project,
	sprint,
	ssp,
	state,
	membership,
	user,
	timeEntry,
	imputationPin,
	ticketActivityRae,
	ticketGroupMember,
	weeklyObjective
} from '$lib/server/db';
import { FLAG_KEYS, FLAG_VALUES, type FlagKey } from './tickets';
import { JIRA_PRIORITY_MAP } from './jiraSync';

// Import en masse de tickets depuis un .xlsx ou un .csv (page /admin/import). Création seule : une
// clé déjà connue est ignorée, jamais modifiée. Aucun état côté serveur entre l'aperçu et la
// validation — le fichier est renvoyé et replanifié à chaque fois par planImport(), si bien que ce
// qui est affiché et ce qui est écrit sortent du même calcul.

/** Plafond par fichier — au-delà, refus avant toute vérification. */
export const IMPORT_MAX_ROWS = 500;
/** adapter-node coupe les requêtes à 512 Ko par défaut (BODY_SIZE_LIMIT) : on refuse avant, avec un
 *  message lisible plutôt qu'un 413 opaque. */
export const IMPORT_MAX_BYTES = 480 * 1024;

type RefKind = 'project' | 'sprint' | 'version' | 'ssp';
type NumField =
	| 'estimationReal'
	| 'raeReal'
	| 'estimationTest'
	| 'prepa'
	| 'raeTest'
	| 'estimationPrev'
	| 'enveloppeTotale';
type Field = RefKind | NumField | FlagKey | 'key' | 'title' | 'state' | 'priority' | 'assignee' | 'parent' | 'comment';

const REF_KINDS: RefKind[] = ['project', 'sprint', 'version', 'ssp'];
const NUM_FIELDS: NumField[] = [
	'estimationReal',
	'raeReal',
	'estimationTest',
	'prepa',
	'raeTest',
	'estimationPrev',
	'enveloppeTotale'
];

/** En-tête comparé sans casse, sans accents ni ponctuation (« Est. Réal » = « est real »). */
const norm = (s: string) =>
	s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
const lower = (s: string) => s.toLowerCase();

/** Colonnes reconnues : libellé affiché dans l'app + autres en-têtes acceptés (déjà normalisés).
 *  `test` : lue seulement si la phase Test est activée dans l'espace. */
export const IMPORT_FIELDS: { field: Field; label: string; aliases: string[]; test?: true }[] = [
	{ field: 'key', label: 'Clé', aliases: ['key', 'issue key'] },
	{ field: 'title', label: 'Titre', aliases: ['resume', 'summary'] },
	{ field: 'project', label: 'Projet', aliases: ['project'] },
	{ field: 'sprint', label: 'Sprint', aliases: [] },
	{ field: 'version', label: 'Version', aliases: ['fix version'] },
	{ field: 'ssp', label: 'Code SSP', aliases: ['ssp'] },
	{ field: 'state', label: 'État', aliases: ['statut', 'status'] },
	{ field: 'priority', label: 'Priorité', aliases: ['priority'] },
	{ field: 'assignee', label: 'Assigné à', aliases: ['responsable', 'assignee'] },
	{ field: 'parent', label: 'Parent', aliases: ['cle parent'] },
	{ field: 'estimationReal', label: 'Estimé', aliases: ['est real', 'estimation'] },
	{ field: 'raeReal', label: 'RAE Réal', aliases: ['rae'] },
	{ field: 'estimationTest', label: 'Est. Test', aliases: [], test: true },
	{ field: 'prepa', label: 'Prépa', aliases: [], test: true },
	{ field: 'raeTest', label: 'RAE Test', aliases: [], test: true },
	{ field: 'estimationPrev', label: 'Estimation prévisionnel', aliases: ['est prev'] },
	{ field: 'enveloppeTotale', label: 'Enveloppe totale', aliases: ['enveloppe', 'budget'] },
	{ field: 'comment', label: 'Commentaire', aliases: ['note'] },
	{ field: 'cypress', label: 'Cypress', aliases: [] },
	{ field: 'docTech', label: 'Doc technique', aliases: [] },
	{ field: 'prepaQualif', label: 'Prépa qualif', aliases: [] }
];
const labelOf = (f: Field) => IMPORT_FIELDS.find((x) => x.field === f)!.label;

// ---------- Lecture du fichier ----------

export type ParsedFile = { headers: string[]; rows: { line: number; cells: string[] }[] };

/** Texte d'une cellule quel que soit son type Excel — une formule rend sa valeur calculée, pas
 *  l'objet `{ formula, result }` (qui sortirait en « [object Object] »). */
function cellText(v: unknown): string {
	if (v == null) return '';
	if (v instanceof Date) return v.toISOString().slice(0, 10);
	if (typeof v !== 'object') return String(v).trim();
	const o = v as { richText?: { text: string }[]; result?: unknown; text?: unknown };
	if (o.richText) return o.richText.map((r) => r.text).join('').trim();
	if ('result' in o) return cellText(o.result);
	if ('text' in o) return cellText(o.text); // lien hypertexte
	return ''; // erreur Excel (#N/A…) ou formule jamais calculée
}

/** Un CSV enregistré par Excel sous Windows est en Windows-1252, pas en UTF-8. */
function decodeCsv(data: ArrayBuffer): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(data);
	} catch {
		return new TextDecoder('windows-1252').decode(data);
	}
}

export async function parseImportFile(data: ArrayBuffer, filename: string): Promise<ParsedFile> {
	const wb = new ExcelJS.Workbook();
	let ws: ExcelJS.Worksheet | undefined;
	if (/\.csv$/i.test(filename)) {
		const text = decodeCsv(data);
		const firstLine = text.split(/\r?\n/, 1)[0];
		// Excel français sépare par « ; » : on prend le séparateur le plus fréquent de la 1re ligne.
		const delimiter = [';', '\t', ','].reduce((a, b) => (firstLine.split(b).length > firstLine.split(a).length ? b : a));
		// map identité : par défaut exceljs convertit « 009922 » en nombre et mange les zéros de tête.
		ws = await wb.csv.read(Readable.from([text]), { parserOptions: { delimiter }, map: (v: string) => v });
	} else {
		await wb.xlsx.load(data);
		ws = wb.getWorksheet('Tickets') ?? wb.worksheets[0];
	}
	const parsed: ParsedFile = { headers: [], rows: [] };
	if (!ws) return parsed;
	// ponytail: 100 colonnes lues au plus (21 reconnues) — borne les classeurs mis en forme jusqu'à XFD.
	const width = Math.min(ws.columnCount, 100);
	ws.eachRow((row, n) => {
		const cells = Array.from({ length: width }, (_, c) => cellText(row.getCell(c + 1).value));
		if (n === 1) parsed.headers = cells;
		else if (cells.some(Boolean)) parsed.rows.push({ line: n, cells });
	});
	return parsed;
}

// ---------- Plan (pur, sans accès base) ----------

export type ImportContext = {
	testPhase: boolean;
	tickets: { id: string; key: string; archived: boolean }[];
	projects: { id: string; name: string }[];
	sprints: { id: string; name: string }[];
	versions: { id: string; name: string }[];
	ssps: { id: string; code: string; label: string; archived: boolean }[];
	states: { id: string; label: string }[];
	members: { id: string; name: string; email: string }[];
};

export type RefToCreate = {
	name: string;
	tickets: number;
	/** Code SSP existant dont celui-ci est à une faute de frappe. */
	similarTo?: string;
	/** Un SSP archivé porte déjà ce code. */
	archived?: boolean;
};

export type ImportLine = {
	line: number;
	status: 'new' | 'skip' | 'err';
	key: string;
	title: string;
	/** Remarques (ticket créé quand même) ou raison du rejet. */
	notes: string[];
	/** Classement et estimé affichés sur la ligne ; `add` = valeur qui sera créée. */
	tags: { text: string; add: boolean }[];
};

export type ImportPlan = {
	/** Fichier inexploitable (colonne obligatoire absente, trop de lignes) : rien d'autre n'est rempli. */
	fatal: string | null;
	/** `why` : raison pour laquelle une colonne pourtant connue n'est pas lue. */
	columns: { header: string; label: string | null; why?: string }[];
	lines: ImportLine[];
	counts: { total: number; new: number; skip: number; err: number; noted: number };
	toCreate: Record<RefKind, RefToCreate[]>;
	/** États et assignés inconnus — jamais créés par un import. */
	neverCreated: string[];
};

type Draft = {
	key: string;
	title: string;
	refs: Partial<Record<RefKind, string>>;
	nums: Partial<Record<NumField, string | null>>;
	stateId: string | null;
	assigneeId: string | null;
	priority?: number;
	parentKey: string | null;
	comment: string | null;
	flags: Partial<Record<FlagKey, string>>;
};

/** `3`, `3,5` ou `3.5` → nombre ; vide → null ; illisible, négatif ou hors numeric(7,2) → undefined. */
function parseDays(raw: string): number | null | undefined {
	if (!raw) return null;
	const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
	return Number.isFinite(n) && n >= 0 && n <= 99999.99 ? n : undefined;
}

/** 0 à 4, P0 à P4, ou le nom Jira (même table que le sync). */
function parsePriority(raw: string): number | undefined {
	const m = /^p?([0-4])$/i.exec(raw);
	return m ? Number(m[1]) : JIRA_PRIORITY_MAP[lower(raw)];
}

/**
 * Faute de frappe probable entre deux codes : un caractère en trop ou en moins, ou deux voisins
 * inversés. Un seul caractère différent n'est PAS signalé — …0083 et …0084 sont deux vrais codes
 * d'une même famille, les marquer noierait le signal.
 */
export function looksLikeTypo(a: string, b: string): boolean {
	a = lower(a);
	b = lower(b);
	if (a.length > b.length) [a, b] = [b, a];
	if (b.length - a.length === 1) {
		for (let i = 0; i < b.length; i++) if (b.slice(0, i) + b.slice(i + 1) === a) return true;
		return false;
	}
	if (a.length !== b.length) return false;
	const diff = [...a].flatMap((c, i) => (c === b[i] ? [] : [i]));
	return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

const emptyPlan = (fatal: string): ImportPlan => ({
	fatal,
	columns: [],
	lines: [],
	counts: { total: 0, new: 0, skip: 0, err: 0, noted: 0 },
	toCreate: { project: [], sprint: [], version: [], ssp: [] },
	neverCreated: []
});

/**
 * Calcule ce que l'import ferait, sans rien écrire. `skip` : jetons « type:nom en minuscules » des
 * versions / sprints / projets que l'admin a décochés — la valeur n'est alors pas créée et le champ
 * reste vide. Un code SSP inconnu est toujours créé : s'il est dans le fichier, c'est voulu.
 */
export function planImport(file: ParsedFile, ctx: ImportContext, skip: ReadonlySet<string> = new Set()) {
	const known: Record<RefKind, Map<string, string>> = {
		project: new Map(ctx.projects.map((p) => [lower(p.name), p.id])),
		sprint: new Map(ctx.sprints.map((s) => [lower(s.name), s.id])),
		version: new Map(ctx.versions.map((v) => [lower(v.name), v.id])),
		ssp: new Map(ctx.ssps.filter((s) => !s.archived).map((s) => [lower(s.code), s.id]))
	};
	const drafts: Draft[] = [];
	const fatal = (message: string) => ({ plan: emptyPlan(message), drafts, known });

	const byHeader = new Map(IMPORT_FIELDS.flatMap((f) => [norm(f.label), ...f.aliases].map((h) => [h, f] as const)));
	const col = new Map<Field, number>();
	const columns = file.headers
		.map((header, i) => {
			const f = byHeader.get(norm(header));
			if (!f) return { header, label: null };
			// Une colonne connue mais non lue dit pourquoi, plutôt que de passer pour une inconnue.
			if (f.test && !ctx.testPhase) return { header, label: null, why: 'phase Test désactivée dans l’espace' };
			// Deux colonnes pour le même champ : la première gagne.
			if (col.has(f.field)) return { header, label: null, why: `en double, « ${f.label} » est déjà lue plus à gauche` };
			col.set(f.field, i);
			return { header, label: f.label };
		})
		.filter((c) => c.header);

	for (const f of ['key', 'title'] as const)
		if (!col.has(f)) return fatal(`Colonne « ${labelOf(f)} » introuvable sur la première ligne du fichier.`);
	if (file.rows.length === 0) return fatal('Aucune ligne à importer sous les en-têtes.');
	if (file.rows.length > IMPORT_MAX_ROWS)
		return fatal(`Le fichier contient ${file.rows.length} lignes : ${IMPORT_MAX_ROWS} au plus par import.`);

	const states = new Map(ctx.states.map((s) => [lower(s.label), s.id]));
	const members = new Map(ctx.members.flatMap((m) => [[lower(m.name), m.id] as const, [lower(m.email), m.id] as const]));
	const existing = new Map(ctx.tickets.map((t) => [t.key, t]));
	const toCreate: Record<RefKind, Map<string, RefToCreate>> = {
		project: new Map(),
		sprint: new Map(),
		version: new Map(),
		ssp: new Map()
	};
	const never = new Map<string, number>();
	const firstLine = new Map<string, number>();
	const lines: ImportLine[] = [];
	const pending: [Draft, ImportLine][] = [];

	for (const row of file.rows) {
		const get = (f: Field) => row.cells[col.get(f) ?? -1] ?? '';
		const key = get('key');
		const out: ImportLine = { line: row.line, status: 'new', key, title: get('title'), notes: [], tags: [] };
		lines.push(out);
		const reject = (status: 'skip' | 'err', why: string) => Object.assign(out, { status, notes: [why], tags: [] });

		if (!key) { reject('err', 'Clé vide.'); continue; }
		const dup = firstLine.get(key);
		if (dup) { reject('err', `Clé déjà présente à la ligne ${dup}.`); continue; }
		firstLine.set(key, row.line);
		// Avant le contrôle du titre : un ticket déjà créé reste « ignoré » quand on redépose le
		// fichier corrigé, quel que soit l'état du reste de sa ligne.
		const hit = existing.get(key);
		if (hit) { reject('skip', hit.archived ? 'Déjà dans l’espace, ticket archivé.' : 'Déjà dans l’espace.'); continue; }
		if (!out.title) { reject('err', 'Titre vide.'); continue; }

		const d: Draft = { key, title: out.title, refs: {}, nums: {}, stateId: null, assigneeId: null, parentKey: null, comment: null, flags: {} };
		const unreadable = NUM_FIELDS.find((f) => {
			const n = parseDays(get(f));
			d.nums[f] = n == null ? null : String(n);
			return n === undefined;
		});
		if (unreadable) { reject('err', `${labelOf(unreadable)} « ${get(unreadable)} » illisible : écrivez 3 ou 3,5.`); continue; }
		// Même règle que la création à la main (tickets/+page.server.ts) : sans RAE, l'avancement
		// démarrerait à 100 %.
		d.nums.raeReal ??= d.nums.estimationReal;
		d.nums.raeTest ??= d.nums.estimationTest;

		for (const kind of REF_KINDS) {
			const name = get(kind);
			if (!name) continue;
			const k = lower(name);
			const isNew = !known[kind].has(k);
			if (isNew) {
				if (kind !== 'ssp' && skip.has(`${kind}:${k}`)) continue;
				const entry = toCreate[kind].get(k) ?? { name, tickets: 0 };
				entry.tickets++;
				toCreate[kind].set(k, entry);
			}
			d.refs[kind] = k;
			out.tags.push({ text: name, add: isNew });
		}

		const unknown = (label: string, raw: string, why: string) => {
			out.notes.push(`${label} « ${raw} » ${why} : champ laissé vide.`);
			never.set(`${label} « ${raw} »`, (never.get(`${label} « ${raw} »`) ?? 0) + 1);
		};
		const st = get('state');
		if (st && !(d.stateId = states.get(lower(st)) ?? null)) unknown('État', st, 'inconnu');
		const who = get('assignee');
		if (who && !(d.assigneeId = members.get(lower(who)) ?? null)) unknown('Assigné', who, 'introuvable');

		const prio = get('priority');
		if (prio && (d.priority = parsePriority(prio)) === undefined)
			out.notes.push(`Priorité « ${prio} » inconnue : Normal par défaut.`);
		for (const f of FLAG_KEYS) {
			const raw = get(f);
			if (!raw) continue;
			const v = FLAG_VALUES.find((x) => lower(x) === lower(raw));
			if (v) d.flags[f] = v;
			else out.notes.push(`${labelOf(f)} « ${raw} » : valeur inconnue, champ laissé vide.`);
		}
		d.comment = get('comment') || null;
		d.parentKey = get('parent') || null;
		if (d.nums.estimationReal) out.tags.push({ text: `${d.nums.estimationReal.replace('.', ',')} j`, add: false });
		drafts.push(d);
		pending.push([d, out]);
	}

	// Parent : cherché dans l'espace et parmi les tickets que ce fichier crée (il peut venir plus bas).
	const created = new Set(drafts.map((d) => d.key));
	for (const [d, out] of pending) {
		if (!d.parentKey || (d.parentKey !== d.key && (created.has(d.parentKey) || existing.has(d.parentKey)))) continue;
		out.notes.push(`Parent ${d.parentKey} introuvable : champ laissé vide.`);
		d.parentKey = null;
	}

	for (const r of toCreate.ssp.values()) {
		const twin = ctx.ssps.find((s) => !s.archived && looksLikeTypo(s.code, r.name));
		if (twin) r.similarTo = twin.label === twin.code ? twin.code : `${twin.code} (${twin.label})`;
		if (ctx.ssps.some((s) => s.archived && lower(s.code) === lower(r.name))) r.archived = true;
	}

	const count = (s: ImportLine['status']) => lines.filter((l) => l.status === s).length;
	const plan: ImportPlan = {
		fatal: null,
		columns,
		lines,
		counts: {
			total: lines.length,
			new: count('new'),
			skip: count('skip'),
			err: count('err'),
			noted: lines.filter((l) => l.status === 'new' && l.notes.length > 0).length
		},
		toCreate: {
			project: [...toCreate.project.values()],
			sprint: [...toCreate.sprint.values()],
			version: [...toCreate.version.values()],
			ssp: [...toCreate.ssp.values()]
		},
		neverCreated: [...never].map(([what, n]) => `${what} (${n} ticket${n > 1 ? 's' : ''})`)
	};
	return { plan, drafts, known };
}

// ---------- Accès base ----------

export async function loadImportContext(workspaceId: string, testPhase: boolean): Promise<ImportContext> {
	const [tickets, projects, sprintRows, ssps, states, members] = await Promise.all([
		db.select({ id: ticket.id, key: ticket.key, archivedAt: ticket.archivedAt }).from(ticket).where(eq(ticket.workspaceId, workspaceId)),
		db.select({ id: project.id, name: project.name }).from(project).where(and(eq(project.workspaceId, workspaceId), isNull(project.archivedAt))),
		db.select({ id: sprint.id, name: sprint.name, kind: sprint.kind }).from(sprint).where(and(eq(sprint.workspaceId, workspaceId), isNull(sprint.archivedAt))),
		db.select({ id: ssp.id, code: ssp.code, label: ssp.label, archivedAt: ssp.archivedAt }).from(ssp).where(eq(ssp.workspaceId, workspaceId)),
		db.select({ id: state.id, label: state.label }).from(state).where(eq(state.workspaceId, workspaceId)),
		db
			.select({ id: user.id, name: user.displayName, email: user.email })
			.from(membership)
			.innerJoin(user, eq(membership.userId, user.id))
			.where(and(eq(membership.workspaceId, workspaceId), eq(membership.active, true)))
	]);
	return {
		testPhase,
		tickets: tickets.map((t) => ({ id: t.id, key: t.key, archived: t.archivedAt !== null })),
		projects,
		sprints: sprintRows.filter((s) => s.kind === 'SPRINT'),
		versions: sprintRows.filter((s) => s.kind === 'VERSION'),
		ssps: ssps.map((s) => ({ id: s.id, code: s.code, label: s.label, archived: s.archivedAt !== null })),
		states,
		members
	};
}

export type ImportResult = {
	/** Lot créé — null si aucun ticket n'a été créé (rien à annuler). */
	importId: string | null;
	created: number;
	refs: Record<RefKind, number>;
	skipped: number;
	errors: ImportLine[];
};

/** Rejoue le plan sur l'état courant de la base puis écrit tout dans une seule transaction. */
export async function applyImport(
	workspaceId: string,
	file: ParsedFile,
	testPhase: boolean,
	meta: { fileName: string; userId: string },
	skip: ReadonlySet<string> = new Set()
): Promise<ImportResult | { fatal: string }> {
	const ctx = await loadImportContext(workspaceId, testPhase);
	const { plan, drafts, known } = planImport(file, ctx, skip);
	if (plan.fatal) return { fatal: plan.fatal };

	// Une course avec un autre import ou le sync Jira (même clé, même version créée entre le plan et
	// l'écriture) heurte un index unique : la transaction entière tombe, rien n'est écrit à moitié, et
	// la vérification suivante montre la ligne comme « déjà dans l'espace ».
	const importId = await db.transaction(async (tx) => {
		// Référentiels : insert direct, le plan vient d'établir qu'ils n'existent pas.
		const names = (kind: RefKind) => plan.toCreate[kind].map((r) => r.name);
		const remember = (kind: RefKind, rows: { id: string; name: string }[]) => {
			for (const r of rows) known[kind].set(lower(r.name), r.id);
		};
		if (names('project').length)
			remember('project', await tx.insert(project).values(names('project').map((name) => ({ workspaceId, name }))).returning({ id: project.id, name: project.name }));
		for (const kind of ['sprint', 'version'] as const)
			if (names(kind).length)
				remember(kind, await tx.insert(sprint).values(names(kind).map((name) => ({ workspaceId, name, kind: kind === 'version' ? ('VERSION' as const) : ('SPRINT' as const) }))).returning({ id: sprint.id, name: sprint.name }));
		if (names('ssp').length)
			// Libellé = code, comme createSsp() quand le libellé est vide — à renommer dans Référentiels.
			remember('ssp', await tx.insert(ssp).values(names('ssp').map((code) => ({ workspaceId, code, label: code }))).returning({ id: ssp.id, name: ssp.code }));

		if (drafts.length === 0) return null;
		const [lot] = await tx
			.insert(ticketImport)
			.values({ workspaceId, fileName: meta.fileName, ticketsCreated: drafts.length, createdById: meta.userId })
			.returning({ id: ticketImport.id });

		// Ids posés ici plutôt que par la base : le lien parent (une clé du fichier, parfois plus bas)
		// part dans le même insert, sans seconde passe — et updated_at reste égal à created_at, ce sur
		// quoi undoImport s'appuie pour reconnaître un ticket jamais retouché.
		const idByKey = new Map(ctx.tickets.map((t) => [t.key, t.id]));
		for (const d of drafts) idByKey.set(d.key, randomUUID());
		const ref = (d: Draft, kind: RefKind) => (d.refs[kind] ? (known[kind].get(d.refs[kind]) ?? null) : null);
		await tx.insert(ticket).values(
			drafts.map((d) => ({
				id: idByKey.get(d.key),
				workspaceId,
				key: d.key,
				title: d.title,
				parentId: d.parentKey ? (idByKey.get(d.parentKey) ?? null) : null,
				projectId: ref(d, 'project'),
				sprintId: ref(d, 'sprint'),
				versionId: ref(d, 'version'),
				sspId: ref(d, 'ssp'),
				stateId: d.stateId,
				assigneeId: d.assigneeId,
				priority: d.priority ?? 2,
				comment: d.comment,
				flags: Object.keys(d.flags).length > 0 ? JSON.stringify(d.flags) : null,
				createdByImportId: lot.id,
				...d.nums
			}))
		);
		return lot.id;
	});

	return {
		importId,
		created: drafts.length,
		refs: {
			project: plan.toCreate.project.length,
			sprint: plan.toCreate.sprint.length,
			version: plan.toCreate.version.length,
			ssp: plan.toCreate.ssp.length
		},
		skipped: plan.counts.skip,
		errors: plan.lines.filter((l) => l.status === 'err')
	};
}

// ---------- Lots : historique et annulation ----------

/** Dix derniers imports de l'espace, le plus récent d'abord. */
export async function listImports(workspaceId: string) {
	return db
		.select({
			id: ticketImport.id,
			fileName: ticketImport.fileName,
			ticketsCreated: ticketImport.ticketsCreated,
			createdAt: ticketImport.createdAt,
			createdByName: user.displayName,
			undoneAt: ticketImport.undoneAt
		})
		.from(ticketImport)
		.leftJoin(user, eq(ticketImport.createdById, user.id))
		.where(eq(ticketImport.workspaceId, workspaceId))
		.orderBy(desc(ticketImport.createdAt))
		.limit(10);
}

/**
 * « Annuler ce lot » : supprime les tickets de l'import restés tels qu'importés, garde les autres.
 * Un ticket est gardé dès qu'il porte une trace d'usage — modifié depuis (updated_at a bougé :
 * édition, indicateur, sync Jira), archivé, imputé, épinglé, chiffré par activité, groupé, mis en
 * objectif, ou parent d'un ticket qui reste. Les versions, sprints, projets et codes SSP créés par
 * l'import ne sont pas retirés : d'autres tickets ont pu s'y rattacher depuis.
 */
export async function undoImport(workspaceId: string, importId: string, actorId: string) {
	return db.transaction(async (tx) => {
		const [lot] = await tx
			.select({ undoneAt: ticketImport.undoneAt })
			.from(ticketImport)
			.where(and(eq(ticketImport.id, importId), eq(ticketImport.workspaceId, workspaceId)));
		if (!lot) throw new Error('Import introuvable dans cet espace.');
		if (lot.undoneAt) throw new Error('Ce lot a déjà été annulé.');

		const child = alias(ticket, 'child_ticket');
		const usedIn = (table: PgTable, column: PgColumn) => exists(tx.select({ n: sql`1` }).from(table).where(eq(column, ticket.id)));
		const rows = await tx
			.select({
				id: ticket.id,
				parentId: ticket.parentId,
				touched: sql<boolean>`${or(
					ne(ticket.updatedAt, ticket.createdAt),
					isNotNull(ticket.archivedAt),
					usedIn(timeEntry, timeEntry.ticketId),
					usedIn(imputationPin, imputationPin.ticketId),
					usedIn(ticketActivityRae, ticketActivityRae.ticketId),
					usedIn(ticketGroupMember, ticketGroupMember.ticketId),
					usedIn(weeklyObjective, weeklyObjective.ticketId),
					// Enfant hors du lot (rattaché à la main, ou venu d'un autre import) : il resterait orphelin.
					exists(
						tx
							.select({ n: sql`1` })
							.from(child)
							.where(and(eq(child.parentId, ticket.id), sql`${child.createdByImportId} is distinct from ${importId}`))
					)
				)}`
			})
			.from(ticket)
			.where(and(eq(ticket.workspaceId, workspaceId), eq(ticket.createdByImportId, importId)));

		// Un ticket gardé fait garder toute sa lignée de parents dans le lot.
		const byId = new Map(rows.map((r) => [r.id, r]));
		const kept = new Set(rows.filter((r) => r.touched).map((r) => r.id));
		for (const r of rows) {
			if (!kept.has(r.id)) continue;
			for (let p = r.parentId; p && byId.has(p) && !kept.has(p); p = byId.get(p)!.parentId) kept.add(p);
		}

		const doomed = rows.filter((r) => !kept.has(r.id)).map((r) => r.id);
		if (doomed.length > 0) await tx.delete(ticket).where(inArray(ticket.id, doomed));
		await tx.update(ticketImport).set({ undoneAt: new Date(), undoneById: actorId }).where(eq(ticketImport.id, importId));
		return { deleted: doomed.length, kept: kept.size };
	});
}

// ---------- Modèle à remplir ----------

/** Classeur vide aux bons en-têtes, avec en listes déroulantes les valeurs de l'espace. */
export async function buildImportTemplate(workspaceId: string, testPhase: boolean): Promise<ArrayBuffer> {
	const ctx = await loadImportContext(workspaceId, testPhase);
	const fields = IMPORT_FIELDS.filter((f) => testPhase || !f.test);
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Tickets', { views: [{ state: 'frozen', ySplit: 1 }] });
	ws.columns = fields.map((f) => ({ header: f.label, width: Math.max(14, f.label.length + 4) }));
	ws.getRow(1).font = { bold: true };

	const lists = wb.addWorksheet('Listes');
	const sources: [Field, string[]][] = [
		['project', ctx.projects.map((p) => p.name)],
		['sprint', ctx.sprints.map((s) => s.name)],
		['version', ctx.versions.map((v) => v.name)],
		['ssp', ctx.ssps.filter((s) => !s.archived).map((s) => s.code)],
		['state', ctx.states.map((s) => s.label)],
		['priority', ['P0', 'P1', 'P2', 'P3', 'P4']],
		['assignee', ctx.members.map((m) => m.name)],
		...FLAG_KEYS.map((f): [Field, string[]] => [f, [...FLAG_VALUES]])
	];
	sources.forEach(([field, values], i) => {
		const target = fields.findIndex((f) => f.field === field) + 1;
		if (!target || values.length === 0) return;
		const column = lists.getColumn(i + 1);
		column.values = [labelOf(field), ...values];
		column.width = 24;
		const range = `Listes!$${column.letter}$2:$${column.letter}$${values.length + 1}`;
		// showErrorMessage: false — la liste propose, elle n'interdit pas : une version ou un code SSP
		// absent de l'espace doit rester saisissable, c'est l'import qui le créera.
		for (let r = 2; r <= IMPORT_MAX_ROWS + 1; r++)
			ws.getCell(r, target).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [range] };
	});
	return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
