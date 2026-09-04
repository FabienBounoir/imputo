<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import {
		ABSENCE_TYPES,
		ABSENCE_PERIODS,
		ABSENCE_SPANS,
		ABSENCE_SPAN_LABELS,
		ABSENCE_TYPE_LABELS,
		ABSENCE_PERIOD_LABELS,
		ABSENCE_TYPE_COLORS,
		type AbsenceType,
		type AbsencePeriod
	} from '$lib/absenceTypes';
	import { parseISODate, formatDayRange, formatDateTime, isPublicHolidayFR } from '$lib/utils/date';
	import { SCHOOL_ZONES, SCHOOL_ZONE_LABELS, SCHOOL_ZONE_COLORS, isSchoolHoliday } from '$lib/schoolZones';
	import { downloadSvgAsPng } from '$lib/utils/svgToPng';
	import { beep } from '$lib/sound';

	let { data, form } = $props();
	$effect(() => {
		if (form?.error) toast.error(form.error);
		else if (form?.ok) toast.success('Mis à jour ✓');
	});

	let startDate = $state(data.todayISO);
	let endDate = $state(data.todayISO);
	let type = $state<AbsenceType>('CONGE_PREVISIONNEL');
	let period = $state<AbsencePeriod>('FULL');
	let subject = $state('me');
	let extName = $state('');
	let showExtModal = $state(false);
	let showImageModal = $state(false);
	let showExportMenu = $state(false);
	let imgFrom = $state(data.todayISO);
	let imgTo = $state(data.todayISO);
	let imgRowIds = $state<string[]>([]);
	let imgBusy = $state(false);
	let editingId = $state<string | null>(null);
	let cellPopover = $state<{ top: number; left: number; displayName: string; cell: ClickableCell } | null>(null);

	// Easter egg : ↑↓←→ dans cet ordre transforme la grille des absences en plateau de Snake
	// (une case = un jour × un membre), couleurs reprises de ABSENCE_TYPE_COLORS.
	type Point = { x: number; y: number };
	const SNAKE_SEQUENCE = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
	const SNAKE_COLOR = ABSENCE_TYPE_COLORS.HORS_PROJET;
	// Pouvoirs de la nourriture, un par couleur d'absence (bleu réservé au serpent lui-même) :
	// congé validé = allonge (classique), formation = accélère (on "monte en compétence"),
	// congé prévisionnel = téléporte ailleurs sur le plateau (rien n'est encore confirmé, ça bouge).
	const FOOD_TYPES = ['CONGE_VALIDE', 'FORMATION', 'CONGE_PREVISIONNEL'] as const;
	const SNAKE_MIN_SPEED_MS = 90;
	const SNAKE_START_SPEED_MS = 180;
	let snakeSeqProgress = 0;
	let showSnakeGame = $state(false);
	let snakeOver = $state(false);
	let snakeScore = $state(0);
	let snake = $state<Point[]>([]);
	let snakeFood = $state<Point & { type: (typeof FOOD_TYPES)[number] }>({ x: 0, y: 0, type: 'CONGE_VALIDE' });
	const snakeSet = $derived(new Set(snake.map((p) => `${p.x},${p.y}`)));
	let snakeDir: Point = { x: 1, y: 0 };
	// File d'attente de directions (2 max) : un tick lent (250ms au départ) ne doit pas avaler un
	// changement de direction pressé juste après le précédent — sinon la 2e touche est perdue et le
	// serpent continue tout droit dans le mur (retour utilisateur : "meurt souvent, bouge pas assez vite").
	let snakeDirQueue: Point[] = [];
	let snakeSpeed = SNAKE_START_SPEED_MS;
	let snakeTimer: ReturnType<typeof setInterval>;

	function snakeSpawnFood(cols: number, rows: number): typeof snakeFood {
		let p: Point;
		do {
			p = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) };
		} while (snake.some((s) => s.x === p.x && s.y === p.y));
		return { ...p, type: FOOD_TYPES[Math.floor(Math.random() * FOOD_TYPES.length)] };
	}

	// Téléporte tout le serpent (même forme, translatée) sur une nouvelle case au hasard — les
	// segments qui débordent du plateau réapparaissent de l'autre côté (comme Pac-Man).
	function snakeTeleport(cols: number, rows: number) {
		const newHead = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) };
		snake = snake.map((_, i) => ({
			x: (((newHead.x - i * snakeDir.x) % cols) + cols) % cols,
			y: (((newHead.y - i * snakeDir.y) % rows) + rows) % rows
		}));
	}

	function startSnakeGame() {
		const cols = data.days.length;
		const rows = data.rows.length;
		if (cols < 3 || rows < 1) return;
		snakeDir = { x: 1, y: 0 };
		snakeDirQueue = [];
		snake = [{ x: Math.floor(cols / 2), y: Math.floor(rows / 2) }];
		snakeFood = snakeSpawnFood(cols, rows);
		snakeScore = 0;
		snakeOver = false;
		snakeSpeed = SNAKE_START_SPEED_MS;
		showSnakeGame = true;
		clearInterval(snakeTimer);
		snakeTimer = setInterval(snakeTick, snakeSpeed);
	}

	function stopSnakeGame() {
		showSnakeGame = false;
		snakeOver = false;
		clearInterval(snakeTimer);
	}

	function snakeTick() {
		const cols = data.days.length;
		const rows = data.rows.length;
		if (snakeDirQueue.length) snakeDir = snakeDirQueue.shift()!;
		const head = { x: snake[0].x + snakeDir.x, y: snake[0].y + snakeDir.y };
		const hitWall = head.x < 0 || head.y < 0 || head.x >= cols || head.y >= rows;
		const hitSelf = snake.some((s) => s.x === head.x && s.y === head.y);
		if (hitWall || hitSelf) {
			snakeOver = true;
			beep(110, { duration: 0.3, type: 'sawtooth', volume: 0.15 });
			clearInterval(snakeTimer);
			return;
		}
		const ate = head.x === snakeFood.x && head.y === snakeFood.y;
		if (!ate) {
			snake = [head, ...snake.slice(0, -1)];
			return;
		}
		snakeScore++;
		switch (snakeFood.type) {
			case 'CONGE_VALIDE':
				snake = [head, ...snake];
				beep(660, { duration: 0.08, volume: 0.12 });
				break;
			case 'FORMATION':
				snake = [head, ...snake.slice(0, -1)];
				snakeSpeed = Math.max(SNAKE_MIN_SPEED_MS, snakeSpeed - 20);
				clearInterval(snakeTimer);
				snakeTimer = setInterval(snakeTick, snakeSpeed);
				beep(880, { duration: 0.1, type: 'triangle', volume: 0.12 });
				break;
			case 'CONGE_PREVISIONNEL':
				snake = [head, ...snake.slice(0, -1)];
				snakeTeleport(cols, rows);
				beep(440, { duration: 0.15, type: 'sine', volume: 0.12 });
				break;
		}
		snakeFood = snakeSpawnFood(cols, rows);
	}

	function trackSnakeSequence(e: KeyboardEvent) {
		if (showSnakeGame) {
			if (e.key === 'Enter' && snakeOver) startSnakeGame();
			const dirs: Record<string, Point> = {
				ArrowUp: { x: 0, y: -1 },
				ArrowDown: { x: 0, y: 1 },
				ArrowLeft: { x: -1, y: 0 },
				ArrowRight: { x: 1, y: 0 }
			};
			const d = dirs[e.key];
			if (d && !snakeOver) {
				e.preventDefault();
				const last = snakeDirQueue[snakeDirQueue.length - 1] ?? snakeDir;
				const isReverse = d.x === -last.x && d.y === -last.y;
				const isSameAsLast = d.x === last.x && d.y === last.y;
				if (!isReverse && !isSameAsLast && snakeDirQueue.length < 2) snakeDirQueue.push(d);
			}
			return;
		}
		const target = e.target as HTMLElement;
		if (target.closest('input, textarea, select, [contenteditable]')) return;
		if (e.key === SNAKE_SEQUENCE[snakeSeqProgress]) {
			snakeSeqProgress++;
			if (snakeSeqProgress === SNAKE_SEQUENCE.length) {
				snakeSeqProgress = 0;
				startSnakeGame();
			}
		} else {
			snakeSeqProgress = e.key === SNAKE_SEQUENCE[0] ? 1 : 0;
		}
	}

	// Arrivée depuis "Mon imputation" (clic sur une case verrouillée par une absence, cf. ?highlight=
	// sur imputation/+page.svelte) : amène l'absence d'origine dans le viewport, la surbrillance
	// elle-même est en CSS pur (même principe que tickets/+page.svelte ?highlight=).
	$effect(() => {
		if (!data.highlightId) return;
		document.getElementById(`abs-${data.highlightId}`)?.scrollIntoView({ block: 'center' });
	});

	// Ouverture directe de l'assistant depuis la palette de commandes (?declare=1).
	$effect(() => {
		if (page.url.searchParams.get('declare') === '1') openDeclareModal();
	});

	const sameDay = $derived(startDate === endDate);
	const targetsExternal = $derived(subject.startsWith('ext:'));
	// Un membre ne déclare qu'en prévisionnel — "Congé validé" n'est atteignable que via le bouton
	// "Valider" (admin/manager). Un admin/manager peut en revanche le poser directement. Dans les deux
	// cas on garde la valeur déjà en cours d'édition, pour ne pas la perdre en modifiant juste les dates.
	// Un membre externe n'a personne pour valider en son nom : uniquement "Congé validé", posé direct.
	const typeOptions = $derived(
		targetsExternal
			? ABSENCE_TYPES.filter((t) => t === 'CONGE_VALIDE' || t === 'FORMATION' || t === 'HORS_PROJET')
			: data.canManageOthers
				? ABSENCE_TYPES
				: ABSENCE_TYPES.filter((t) => t !== 'CONGE_VALIDE' || type === 'CONGE_VALIDE')
	);

	// Bascule sur un membre externe : le prévisionnel n'a pas de sens, on repasse sur validé direct.
	$effect(() => {
		if (targetsExternal && type === 'CONGE_PREVISIONNEL') type = 'CONGE_VALIDE';
	});

	// ---------- Modal « Déclarer / Modifier une absence » (assistant en étapes) ----------
	let showDeclareModal = $state(false);
	let wizardStep = $state(0);

	// Étape "Pour qui" seulement pour un admin/manager, et seulement à la création (le sujet d'une
	// absence existante ne se réassigne jamais). Un manager y voit uniquement les membres externes
	// (cf. filtre sur data.rows plus bas) — jamais un autre vrai membre.
	const wizardSteps = $derived(
		!editingId && (data.canManageOthers || data.canManageExternal)
			? [
					{ key: 'subject', label: 'Pour qui' },
					{ key: 'dates', label: 'Dates' },
					{ key: 'type', label: 'Type' }
				]
			: [
					{ key: 'dates', label: 'Dates' },
					{ key: 'type', label: 'Type' }
				]
	);
	const canGoNext = $derived(
		wizardSteps[wizardStep]?.key !== 'dates' || (!!startDate && !!endDate && startDate <= endDate)
	);

	function nextStep() {
		if (canGoNext && wizardStep < wizardSteps.length - 1) wizardStep++;
	}
	function prevStep() {
		if (wizardStep > 0) wizardStep--;
	}

	function openDeclareModal() {
		resetForm();
		wizardStep = 0;
		showDeclareModal = true;
	}
	function closeDeclareModal() {
		showDeclareModal = false;
		resetForm();
	}

	/** Bascule le formulaire en mode édition, préremplit ses champs et ouvre l'assistant. */
	function startEdit(a: { id: string; startDate: string; endDate: string; type: AbsenceType; period: AbsencePeriod }) {
		editingId = a.id;
		startDate = a.startDate;
		endDate = a.endDate;
		type = a.type;
		period = a.period;
		subject = 'me';
		wizardStep = 0;
		showDeclareModal = true;
	}

	type ClickableCell = {
		id: string;
		startDate: string;
		endDate: string;
		type: AbsenceType;
		period: AbsencePeriod;
		createdAt: Date;
		validatedAt: Date | null;
		validatedByName: string | null;
	};

	// Historique (modifications) de l'absence affichée dans le popover — chargé à l'ouverture.
	type HistoryEntry = { field: string | null; oldValue: string | null; newValue: string | null; changedByName: string | null; createdAt: string };
	let popoverHistory = $state<HistoryEntry[]>([]);

	/** Case cliquée dans la grille : popover juste en dessous, avec les infos et les actions (modifier / valider). */
	function handleCellClick(e: MouseEvent, cell: ClickableCell, displayName: string) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		cellPopover = { top: rect.bottom + 6, left: rect.left, displayName, cell };
		popoverHistory = [];
		fetch(`/api/absences/${cell.id}/history`)
			.then((r) => (r.ok ? r.json() : { entries: [] }))
			.then((d) => (popoverHistory = d.entries));
	}

	function editFromPopover() {
		if (!cellPopover) return;
		const cell = cellPopover.cell;
		cellPopover = null;
		startEdit(cell);
	}

	function openImageModal() {
		imgFrom = data.days[0];
		imgTo = data.days[data.days.length - 1];
		imgRowIds = [];
		showImageModal = true;
	}

	/** Coche/décoche une ligne — l'ordre de coche fait l'ordre d'export (décocher/recocher pour réordonner). */
	function toggleImgRow(id: string) {
		imgRowIds = imgRowIds.includes(id) ? imgRowIds.filter((x) => x !== id) : [...imgRowIds, id];
	}
	function selectAllImgRows() {
		imgRowIds = data.rows.map((r) => r.id);
	}

	async function downloadImagePng() {
		// Garde explicite en plus du `disabled` sur le bouton : `rows` vide côté serveur exporterait
		// toute l'équipe, pas rien — un appel sans sélection ne doit jamais partir.
		if (imgRowIds.length === 0) return;
		imgBusy = true;
		const params = new URLSearchParams({ from: imgFrom, to: imgTo, rows: imgRowIds.join(',') });
		try {
			const res = await fetch(`/absences/export-image?${params}`);
			if (!res.ok) return;
			const svgText = await res.text();
			await downloadSvgAsPng(svgText, `absences-${imgFrom}_${imgTo}.png`);
			showImageModal = false;
		} finally {
			imgBusy = false;
		}
	}

	function resetForm() {
		startDate = data.todayISO;
		endDate = data.todayISO;
		type = 'CONGE_PREVISIONNEL';
		period = 'FULL';
		subject = 'me';
		editingId = null;
	}

	function isWeekend(dayISO: string) {
		const dow = parseISODate(dayISO).getUTCDay();
		return dow === 0 || dow === 6;
	}

	function cellStyle(cell: { type: AbsenceType; period: AbsencePeriod } | undefined) {
		if (!cell) return '';
		const color = ABSENCE_TYPE_COLORS[cell.type];
		if (cell.period === 'FULL') return `background:${color};`;
		// Dégradé diagonal (« / »), comme avant — matinée = couleur en haut, après-midi = couleur en
		// bas, en inversant l'ordre des arrêts sur le même axe (135deg). Auparavant le même dégradé
		// pour les deux, impossible à distinguer à l'œil (retour utilisateur).
		return cell.period === 'AM'
			? `background:linear-gradient(135deg, ${color} 0 50%, transparent 50% 100%);`
			: `background:linear-gradient(135deg, transparent 0 50%, ${color} 50% 100%);`;
	}
</script>

<div class="topbar">
	<h1>Absences<small>Congés, formations et hors-projet</small></h1>
</div>

<div class="content abs">
	<div class="declare-cta">
		<button class="btn btn-primary" type="button" data-tour="absences-add" onclick={openDeclareModal}>+ Déclarer une absence</button>
	</div>

	<section class="card block">
		<div class="synth-head">
			<h3>Synthèse équipe — {data.rangeLabel}</h3>
			<div class="spacer"></div>
			{#if data.canManageExternal}
				<button type="button" class="icon-btn-sq" onclick={() => (showExtModal = true)} title="Membres externes" aria-label="Membres externes">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
				</button>
			{/if}
			<div class="span-pick">
				{#each ABSENCE_SPANS as s (s)}
					<a class="span-btn" class:active={data.span === s} href="?m={data.anchorISO}&span={s}">{ABSENCE_SPAN_LABELS[s]}</a>
				{/each}
			</div>
			<div class="wknav">
				<a class="wkbtn" href="?m={data.prevAnchor}&span={data.span}" aria-label="Période précédente">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 18-6-6 6-6"/></svg>
				</a>
				<a class="wkbtn" href="?m={data.nextAnchor}&span={data.span}" aria-label="Période suivante">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m9 18 6-6-6-6"/></svg>
				</a>
			</div>
			<div class="dl-wrap">
				<button type="button" class="icon-btn-sq" onclick={() => (showExportMenu = !showExportMenu)} title="Exporter" aria-label="Exporter">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="3" width="12" height="8" rx="1.5"/><path d="M12 17v-6M9 14l3 3 3-3"/><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/></svg>
				</button>
				{#if showExportMenu}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="dl-menu">
						<a href="/absences/export?m={data.anchorISO}&span={data.span}" onclick={() => (showExportMenu = false)}>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16"/></svg>
							Excel (.xlsx)
						</a>
						<button
							type="button"
							onclick={() => {
								showExportMenu = false;
								openImageModal();
							}}
						>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
							Image (.png)
						</button>
					</div>
				{/if}
			</div>
		</div>
		{#if showSnakeGame}
			<p class="hint" style="margin:0;">
				🐍 Score : {snakeScore}{snakeOver
					? ' — perdu ! Entrée pour rejouer, Échap pour quitter.'
					: ' — Échap pour quitter.'}
			</p>
		{/if}
		{#if data.rows.length === 0}
			<p class="hint" style="margin:0;">Aucun membre actif.</p>
		{:else}
			<div class="grid-wrap">
				<table class="grid">
					<colgroup>
						<col class="name-col-w" />
						{#each data.days as d (d)}<col class="day-col-w" />{/each}
					</colgroup>
					<thead>
						<tr>
							<th class="name-col" rowspan="2">Membre</th>
							{#each data.monthGroups as g (g.label)}
								<th colspan={g.count} class="month-hdr">{g.label}</th>
							{/each}
						</tr>
						<tr>
							{#each data.days as d (d)}
								<th
									class:weekend={isWeekend(d)}
									class:today={d === data.todayISO}
									class:holiday={isPublicHolidayFR(d)}
									title={isPublicHolidayFR(d) ? 'Jour férié' : undefined}>{parseISODate(d).getUTCDate()}</th
								>
							{/each}
						</tr>
						{#each SCHOOL_ZONES as zone (zone)}
							<tr class="zone-row" title="{SCHOOL_ZONE_LABELS[zone]} (vacances scolaires)">
								<th class="name-col zone-label">{zone}</th>
								{#each data.days as d (d)}
									<td
										class="zone-cell"
										style={isSchoolHoliday(d, zone, data.schoolHolidays) ? `background:${SCHOOL_ZONE_COLORS[zone]};` : ''}
									></td>
								{/each}
							</tr>
						{/each}
					</thead>
					<tbody>
						{#each data.rows as m, rowIdx (m.id)}
							<tr
								class:external-row={m.external}
								title={m.external
									? "Membre externe : ce n'est pas un vrai membre de l'équipe. Ses congés sont posés directement en « Congé validé », il n'y a pas de congé prévisionnel pour ces personnes."
									: undefined}
							>
								<td class="name-col" class:self-row={m.id === data.selfId}>{m.displayName}{#if m.external}<span class="ext-dot"></span>{/if}</td>
								{#each data.days as d, dayIdx (d)}
									{@const cell = data.grid[m.id]?.[d]}
									{@const editable = !!cell && (m.external ? data.canManageExternal : m.id === data.selfId || data.canManageOthers)}
									{@const isSnakeCell = showSnakeGame && snakeSet.has(`${dayIdx},${rowIdx}`)}
									{@const isFoodCell = showSnakeGame && snakeFood.x === dayIdx && snakeFood.y === rowIdx}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<td
										class:weekend={isWeekend(d)}
										class:today={d === data.todayISO}
										class:holiday={isPublicHolidayFR(d)}
										class:cell-editable={editable && !showSnakeGame}
										style={isSnakeCell
											? `background:${SNAKE_COLOR};`
											: isFoodCell
												? `background:${ABSENCE_TYPE_COLORS[snakeFood.type]};`
												: cellStyle(cell)}
										title={showSnakeGame
											? ''
											: cell
												? `${m.displayName} — ${ABSENCE_TYPE_LABELS[cell.type]}${cell.period !== 'FULL' ? ' (' + ABSENCE_PERIOD_LABELS[cell.period] + ')' : ''}${data.canManageOthers ? ' · imputé le ' + formatDateTime(cell.createdAt) : ''}${editable ? ' · cliquer pour les actions' : ''}`
												: ''}
										onclick={editable && !showSnakeGame ? (e) => cell && handleCellClick(e, cell, m.displayName) : undefined}
									></td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="legend">
				<div class="legend-row">
					<span class="legend-row-label">Absences</span>
					{#each ABSENCE_TYPES as t (t)}
						<span class="legend-item"><span class="swatch" style="background:{ABSENCE_TYPE_COLORS[t]};"></span>{ABSENCE_TYPE_LABELS[t]}</span>
					{/each}
					<span class="legend-item legend-note"><span class="swatch swatch-half-am"></span>{ABSENCE_PERIOD_LABELS.AM}</span>
					<span class="legend-item legend-note"><span class="swatch swatch-half-pm"></span>{ABSENCE_PERIOD_LABELS.PM}</span>
				</div>
				<div class="legend-row">
					<span class="legend-row-label">Vacances scolaires</span>
					{#each SCHOOL_ZONES as zone (zone)}
						<span class="legend-item"><span class="swatch swatch-bar" style="background:{SCHOOL_ZONE_COLORS[zone]};"></span>{SCHOOL_ZONE_LABELS[zone]}</span>
					{/each}
				</div>
			</div>
		{/if}
	</section>

	{#if data.canManageOthers && data.pendingAbsences.length > 0}
		<section class="card block">
			<h3>À valider <span class="pill">{data.pendingAbsences.length}</span></h3>
			<div class="abs-list">
				{#each data.pendingAbsences as a (a.id)}
					<div class="abs-item">
						<span class="swatch" style={cellStyle({ type: a.type, period: a.period })}></span>
						<span class="abs-range">{a.displayName} — {formatDayRange(a.startDate, a.endDate)}</span>
						{#if a.period !== 'FULL'}<span class="pill">{ABSENCE_PERIOD_LABELS[a.period]}</span>{/if}
						<span class="abs-created hint">imputé le {formatDateTime(a.createdAt)}</span>
						<form method="POST" action="?/validate" use:enhance>
							<input type="hidden" name="id" value={a.id} />
							<button class="ref-btn ref-btn-accept" type="submit">✓ Valider</button>
						</form>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<section class="card block">
		<h3>Mes absences</h3>
		{#if data.myAbsences.length === 0}
			<p class="hint" style="margin:0;">Aucune absence déclarée.</p>
		{:else}
			<div class="abs-list">
				{#each data.myAbsences as a (a.id)}
					<div class="abs-item" id="abs-{a.id}" class:highlighted={a.id === data.highlightId}>
						<span class="swatch" style={cellStyle({ type: a.type, period: a.period })}></span>
						<span class="abs-range">{formatDayRange(a.startDate, a.endDate)}</span>
						<span class="pill">{ABSENCE_TYPE_LABELS[a.type]}</span>
						{#if a.period !== 'FULL'}<span class="pill">{ABSENCE_PERIOD_LABELS[a.period]}</span>{/if}
						<span class="abs-created hint">imputé le {formatDateTime(a.createdAt)}</span>
						<button class="ref-btn" type="button" onclick={() => startEdit(a)}>✏️ Modifier</button>
						<form method="POST" action="?/remove" use:enhance>
							<input type="hidden" name="id" value={a.id} />
							<button class="ref-btn ref-btn-danger" type="submit">🗑 Retirer</button>
						</form>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<svelte:window
	onkeydown={(e) => {
		trackSnakeSequence(e);
		if (e.key !== 'Escape') return;
		if (showSnakeGame) stopSnakeGame();
		if (showDeclareModal) closeDeclareModal();
		showExtModal = false;
		showImageModal = false;
		showExportMenu = false;
		cellPopover = null;
	}}
/>

{#if showDeclareModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={closeDeclareModal}>
		<div class="modal wizard-modal" onclick={(e) => e.stopPropagation()}>
			<h3>{editingId ? "Modifier l'absence" : 'Déclarer une absence'}</h3>

			<div class="wizard-steps">
				{#each wizardSteps as s, i (s.key)}
					<div class="wizard-step" class:done={i < wizardStep} class:current={i === wizardStep}>
						<span class="wizard-dot">{i < wizardStep ? '✓' : i + 1}</span>
						<span class="wizard-label">{s.label}</span>
					</div>
					{#if i < wizardSteps.length - 1}<span class="wizard-line" class:done={i < wizardStep}></span>{/if}
				{/each}
			</div>
			<p class="hint wizard-progress">Étape {wizardStep + 1} sur {wizardSteps.length}</p>

			<form
				method="POST"
				action={editingId ? '?/update' : '?/create'}
				use:enhance={() => async ({ result, update }) => {
					await update();
					if (result.type === 'success') closeDeclareModal();
				}}
			>
				{#if editingId}<input type="hidden" name="id" value={editingId} />{/if}
				<input type="hidden" name="subject" value={subject} />
				<input type="hidden" name="startDate" value={startDate} />
				<input type="hidden" name="endDate" value={endDate} />
				<input type="hidden" name="type" value={type} />
				<input type="hidden" name="period" value={period} />

				{#if wizardSteps[wizardStep].key === 'subject'}
					<div class="field">
						<label for="subject">Pour qui ?</label>
						<select id="subject" bind:value={subject}>
							<option value="me">Moi-même</option>
							{#each data.rows.filter((r) => r.id !== data.selfId && (data.canManageOthers || r.external)) as m (m.id)}
								<option value={m.external ? `ext:${m.id}` : `user:${m.id}`}>{m.displayName}{m.external ? ' (externe)' : ''}</option>
							{/each}
						</select>
					</div>
				{:else if wizardSteps[wizardStep].key === 'dates'}
					<div class="field">
						<label for="startDate">Date de début</label>
						<input id="startDate" type="date" bind:value={startDate} required />
					</div>
					<div class="field">
						<label for="endDate">Date de fin</label>
						<input id="endDate" type="date" bind:value={endDate} min={startDate} required />
					</div>
				{:else if wizardSteps[wizardStep].key === 'type'}
					<div class="field">
						<label for="type">Type</label>
						<select id="type" bind:value={type}>
							{#each typeOptions as t (t)}
								<option value={t}>{ABSENCE_TYPE_LABELS[t]}</option>
							{/each}
						</select>
					</div>
					<div class="field period-field">
						<span>Durée</span>
						{#if sameDay || !editingId}
							<div class="period-pick">
								{#each ABSENCE_PERIODS as p (p)}
									<label class="period-opt" class:active={period === p}>
										<input type="radio" bind:group={period} value={p} />
										{ABSENCE_PERIOD_LABELS[p]}
									</label>
								{/each}
							</div>
							<!-- Sur plusieurs jours, la demi-journée n'a de sens que jour par jour (une ligne par
							     jour côté serveur, cf. actions.create) — rendu explicite ici plutôt que de
							     masquer silencieusement le choix comme avant (retour utilisateur : "pas intuitif").
							     Uniquement à la création : modifier une absence existante reste bornée à SA ligne
							     (actions.update ne peut pas l'éclater en plusieurs lignes après coup). -->
							{#if !sameDay && period !== 'FULL'}
								<p class="hint period-hint">S'appliquera à chaque jour de la plage ({ABSENCE_PERIOD_LABELS[period]?.toLowerCase() ?? ''} tous les jours).</p>
							{/if}
						{:else}
							<p class="hint period-hint">Journée complète — la demi-journée n'est disponible que sur un seul jour en modification.</p>
						{/if}
					</div>
				{/if}

				<div class="wizard-actions">
					<button class="btn btn-ghost" type="button" onclick={wizardStep > 0 ? prevStep : closeDeclareModal}>
						{wizardStep > 0 ? '← Précédent' : 'Annuler'}
					</button>
					{#if wizardStep < wizardSteps.length - 1}
						<button class="btn btn-primary" type="button" disabled={!canGoNext} onclick={nextStep}>Suivant →</button>
					{:else}
						<button class="btn btn-primary" type="submit">{editingId ? 'Enregistrer' : '+ Déclarer'}</button>
					{/if}
				</div>
			</form>
		</div>
	</div>
{/if}

{#if cellPopover}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="popover-backdrop" onclick={() => (cellPopover = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="popover" style="top:{cellPopover.top}px; left:{cellPopover.left}px;" onclick={(e) => e.stopPropagation()}>
			<strong>{cellPopover.displayName}</strong>
			<p>{ABSENCE_TYPE_LABELS[cellPopover.cell.type]}{cellPopover.cell.period !== 'FULL' ? ' · ' + ABSENCE_PERIOD_LABELS[cellPopover.cell.period] : ''}</p>
			{#if cellPopover.cell.type === 'CONGE_VALIDE'}
				{#if cellPopover.cell.validatedAt}
					<p class="hint">Validé le {formatDateTime(cellPopover.cell.validatedAt)}{#if cellPopover.cell.validatedByName} par {cellPopover.cell.validatedByName}{/if}</p>
				{:else}
					<p class="hint">Validé — détails non suivis (absence créée avant l'activation du suivi).</p>
				{/if}
			{:else}
				<p class="hint">Imputé le {formatDateTime(cellPopover.cell.createdAt)}</p>
			{/if}
			{#if popoverHistory.length > 0}
				<p class="hint">Modifié le {formatDateTime(new Date(popoverHistory[0].createdAt))} par {popoverHistory[0].changedByName ?? 'quelqu’un'}</p>
			{/if}
			<div class="popover-actions">
				<button class="ref-btn" type="button" onclick={editFromPopover}>✏️ Modifier</button>
				{#if cellPopover.cell.type === 'CONGE_PREVISIONNEL' && data.canManageOthers}
					<form
						method="POST"
						action="?/validate"
						use:enhance={() => async ({ update }) => {
							await update();
							cellPopover = null;
						}}
					>
						<input type="hidden" name="id" value={cellPopover.cell.id} />
						<button class="ref-btn ref-btn-accept" type="submit">✓ Valider</button>
					</form>
				{/if}
			</div>
		</div>
	</div>
{/if}

{#if showExtModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={() => (showExtModal = false)}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h3>Membres externes</h3>
			<p class="hint">Personnes suivies pour leurs congés sans compte sur l'espace (client, prestataire…). Choisis-les ensuite dans « Pour » du formulaire de déclaration.</p>
			<form
				method="POST"
				action="?/addExternal"
				class="ext-add"
				use:enhance={() => async ({ update }) => {
					await update();
					extName = '';
				}}
			>
				<input name="displayName" bind:value={extName} placeholder="Nom (ex. Client Acme)…" required />
				<button class="btn btn-ghost" type="submit">+ Ajouter</button>
			</form>
			{#if data.externalMembers.length > 0}
				<div class="abs-list">
					{#each data.externalMembers as em (em.id)}
						<div class="abs-item">
							<span class="ext-dot"></span>
							<span class="abs-range">{em.displayName}</span>
							<form method="POST" action="?/removeExternal" use:enhance>
								<input type="hidden" name="id" value={em.id} />
								<button class="ref-btn ref-btn-danger" type="submit">🗑 Retirer</button>
							</form>
						</div>
					{/each}
				</div>
			{:else}
				<p class="hint" style="margin:0;">Aucun membre externe pour l'instant.</p>
			{/if}
			<div class="modal-actions">
				<button class="btn btn-ghost" type="button" onclick={() => (showExtModal = false)}>Fermer</button>
			</div>
		</div>
	</div>
{/if}

{#if showImageModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={() => (showImageModal = false)}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h3>Exporter en image (PNG)</h3>
			<p class="hint">Pratique pour coller un extrait du planning dans une présentation.</p>

			<div class="ex-dates">
				<label class="ex-field">Du<input type="date" bind:value={imgFrom} max={imgTo} /></label>
				<label class="ex-field">Au<input type="date" bind:value={imgTo} min={imgFrom} /></label>
			</div>

			<div class="field">
				<div class="img-rows-head">
					<div class="field-label" id="imgRowsLabel">Lignes (cochées dans l'ordre voulu = ordre d'export)</div>
					{#if imgRowIds.length > 0}
						<button type="button" class="img-rows-all" onclick={() => (imgRowIds = [])}>Tout désélectionner</button>
					{:else}
						<button type="button" class="img-rows-all" onclick={selectAllImgRows}>Tout sélectionner</button>
					{/if}
				</div>
				<div class="img-rows-pick" role="group" aria-labelledby="imgRowsLabel">
					{#each data.rows as r (r.id)}
						<label class="img-row-check">
							<input type="checkbox" checked={imgRowIds.includes(r.id)} onchange={() => toggleImgRow(r.id)} />
							<span class="img-row-name">{r.displayName}{r.external ? ' (externe)' : ''}</span>
							{#if imgRowIds.includes(r.id)}<span class="img-row-pos">{imgRowIds.indexOf(r.id) + 1}</span>{/if}
						</label>
					{/each}
				</div>
			</div>

			<div class="modal-actions">
				<button class="btn btn-ghost" type="button" onclick={() => (showImageModal = false)}>Annuler</button>
				<button class="btn btn-primary" type="button" disabled={imgRowIds.length === 0 || imgBusy} onclick={downloadImagePng}>
					{imgBusy ? 'Génération…' : '⬇ Télécharger le PNG'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.abs {
		max-width: 1180px;
	}
	.block {
		padding: 22px;
		margin-bottom: 18px;
	}
	.block h3 {
		font-family: var(--font-display);
		font-size: 18px;
		font-weight: 600;
		margin-bottom: 14px;
	}
	.hint {
		color: var(--text-mute);
		font-size: 13px;
	}
	.wknav {
		display: flex;
		align-items: center;
		gap: 4px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		padding: 4px;
		box-shadow: var(--shadow-sm);
	}
	.wkbtn {
		width: 30px;
		height: 30px;
		border-radius: 8px;
		display: grid;
		place-items: center;
		color: var(--text-soft);
		transition: background 0.15s;
	}
	.wkbtn:hover {
		background: var(--surface-sunk);
	}
	.icon-btn-sq {
		width: 34px;
		height: 34px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
		color: var(--text-soft);
		display: grid;
		place-items: center;
		flex-shrink: 0;
		transition: border-color 0.15s, color 0.15s;
	}
	.icon-btn-sq:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.dl-wrap {
		position: relative;
	}
	.dl-menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		box-shadow: var(--shadow-lg);
		padding: 6px;
		min-width: 170px;
		z-index: 30;
	}
	.dl-menu a,
	.dl-menu button {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		text-align: left;
		padding: 8px 9px;
		border-radius: var(--r-sm);
		font-size: 13px;
		color: var(--text-soft);
		text-decoration: none;
		white-space: nowrap;
	}
	.dl-menu a:hover,
	.dl-menu button:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.synth-head {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		margin-bottom: 14px;
	}
	.synth-head h3 {
		margin-bottom: 0;
	}
	.span-pick {
		display: flex;
		gap: 2px;
		background: var(--surface-sunk);
		border-radius: var(--r-md);
		padding: 3px;
	}
	.span-btn {
		padding: 6px 11px;
		border-radius: 7px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-soft);
		white-space: nowrap;
	}
	.span-btn.active {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}

	.period-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.period-field span {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-soft);
	}
	.period-pick {
		display: flex;
		gap: 6px;
	}
	.period-opt {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 9px 11px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface-2);
		font-size: 13px;
		white-space: nowrap;
		cursor: pointer;
	}
	.period-opt.active {
		border-color: var(--accent);
		color: var(--accent-ink);
		background: var(--accent-tint);
	}
	.period-opt input {
		accent-color: var(--accent);
	}
	.period-hint {
		margin: 0;
	}

	.ext-add {
		display: flex;
		gap: 8px;
		margin-bottom: 14px;
	}
	.ext-add input {
		flex: 1;
		min-width: 0;
		padding: 9px 11px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13.5px;
	}
	.ext-add input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
	}
	.ext-dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #94a3b8;
		margin-left: 7px;
		vertical-align: middle;
	}

	.abs-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.abs-item {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13.5px;
		border-radius: var(--r-md, 10px);
		padding: 4px 6px;
		margin: -4px -6px;
	}
	/* Arrivée depuis "Mon imputation" (?highlight=, cf. l'effet plus haut) — même principe que
	   tickets/+page.svelte tr.highlighted. */
	.abs-item.highlighted {
		background: color-mix(in srgb, var(--accent) 28%, transparent);
		animation: abs-highlight-fade 2.5s ease-out 1;
	}
	@keyframes abs-highlight-fade {
		from {
			background: color-mix(in srgb, var(--accent) 50%, transparent);
		}
	}
	.abs-range {
		flex: 1;
	}
	.abs-created {
		white-space: nowrap;
	}
	/* < 640px : la ligne (nom/plage + pills + date + bouton) ne rentre plus sur une seule ligne
	   sans wrap -> elle débordait de la card au lieu de passer à la ligne. */
	@media (max-width: 640px) {
		.abs-item {
			flex-wrap: wrap;
		}
		.abs-range {
			flex-basis: 100%;
		}
	}
	.ref-btn {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-soft);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 6px 10px;
		white-space: nowrap;
		transition: border-color 0.15s, color 0.15s;
	}
	.ref-btn-danger:hover {
		border-color: #c0392b;
		color: #c0392b;
	}
	.ref-btn-accept:hover {
		border-color: #2e7d32;
		color: #2e7d32;
	}

	.popover-backdrop {
		position: fixed;
		inset: 0;
		z-index: 45;
	}
	.popover {
		position: fixed;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		box-shadow: var(--shadow-lg);
		padding: 10px 13px;
		font-size: 12.5px;
		max-width: 270px;
		z-index: 46;
	}
	.popover strong {
		display: block;
		margin-bottom: 3px;
	}
	.popover p {
		color: var(--text-soft);
		margin: 0 0 4px;
	}
	.popover p:last-of-type {
		margin-bottom: 0;
	}
	.popover-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 9px;
	}

	.swatch {
		display: inline-block;
		width: 16px;
		height: 16px;
		border-radius: 4px;
		border: 1px solid var(--border);
		flex-shrink: 0;
	}
	.swatch-bar {
		height: 6px;
		border-radius: 3px;
		border: none;
	}

	.grid-wrap {
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
	}
	.grid {
		border-collapse: collapse;
		table-layout: fixed;
		font-size: 12px;
	}
	.name-col-w {
		width: 160px;
	}
	.day-col-w {
		width: 26px;
	}
	.grid th,
	.grid td {
		border: 1px solid var(--border);
		text-align: center;
		height: 26px;
		padding: 0;
		overflow: hidden;
	}
	/* `<col>` widths seuls ne suffisent pas à contraindre les colonnes du corps du tableau une fois
	   qu'un en-tête à colspan (bandeau mois) est présent — on fixe donc aussi la largeur sur les
	   cellules elles-mêmes pour que chaque jour garde exactement la même largeur (1 ou 2 chiffres). */
	.grid th:not(.name-col):not(.month-hdr),
	.grid td:not(.name-col) {
		width: 26px;
		min-width: 26px;
		max-width: 26px;
	}
	.grid th.name-col,
	.grid td.name-col {
		width: 160px;
		min-width: 160px;
		max-width: 160px;
	}
	.grid th {
		background: var(--surface-sunk);
		color: var(--text-soft);
		font-weight: 600;
		position: sticky;
	}
	.grid thead tr:nth-child(1) th {
		top: 0;
	}
	.grid thead tr:nth-child(2) th {
		top: 27px;
	}
	/* Bandeaux vacances scolaires (zones A/B/C) : lignes fines empilées sous l'en-tête jours, elles
	   aussi épinglées pour rester avec le reste de l'en-tête au scroll vertical de la page. */
	.grid thead tr.zone-row th,
	.grid thead tr.zone-row td {
		position: sticky;
	}
	.grid thead tr:nth-child(3) th,
	.grid thead tr:nth-child(3) td {
		top: 54px;
	}
	.grid thead tr:nth-child(4) th,
	.grid thead tr:nth-child(4) td {
		top: 68px;
	}
	.grid thead tr:nth-child(5) th,
	.grid thead tr:nth-child(5) td {
		top: 82px;
	}
	.grid .month-hdr {
		border-left-width: 2px;
	}
	.zone-row th,
	.zone-row td {
		height: 14px;
	}
	.zone-label {
		font-size: 9px;
		color: var(--text-mute);
	}
	.grid td.zone-cell {
		background: var(--surface-sunk);
		border-color: transparent;
	}
	.grid .name-col {
		text-align: left;
		padding: 0 10px;
		white-space: nowrap;
		text-overflow: ellipsis;
		position: sticky;
		left: 0;
		background: var(--surface);
		z-index: 1;
	}
	.grid th.name-col {
		background: var(--surface-sunk);
		z-index: 2;
	}
	.grid td.weekend,
	.grid th.weekend {
		background: var(--surface-sunk);
	}
	.grid td.holiday,
	.grid th.holiday {
		background: color-mix(in srgb, var(--danger, #c0392b) 14%, var(--surface));
	}
	.grid th.holiday {
		color: var(--danger, #c0392b);
	}
	.grid td.today,
	.grid th.today {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	/* Ligne d'un membre externe : teinte très légère, distincte des couleurs de type d'absence. */
	.grid tr.external-row td,
	.grid tr.external-row td.weekend {
		background: rgba(148, 163, 184, 0.12);
	}
	/* name-col est sticky au-dessus des colonnes de jours qui défilent dessous : il lui faut un fond
	   opaque (composé via color-mix, pas un rgba translucide) sinon les couleurs d'absence scrollées
	   en dessous transparaissent à travers la teinte. */
	.grid tr.external-row td.name-col {
		background: color-mix(in srgb, var(--surface) 88%, rgb(148 163 184) 12%);
	}
	/* Ma propre ligne : petit surlignage or sur le nom, pour la repérer d'un coup d'œil (retour
	   utilisateur) — même or que la pilule "Congé prévisionnel" (ABSENCE_TYPE_COLORS), fond opaque
	   pour la même raison que ci-dessus (sticky au-dessus des colonnes de jours qui défilent). */
	.grid td.name-col.self-row {
		background: color-mix(in srgb, var(--surface) 82%, #ffc000 18%);
		font-weight: 700;
		color: color-mix(in srgb, #ffc000 60%, var(--text));
	}
	/* Survol : bascule en bleu + le title du <tr> explique que ce n'est pas un vrai membre. */
	.grid tr.external-row:hover {
		cursor: help;
	}
	.grid tr.external-row:hover td,
	.grid tr.external-row:hover td.weekend {
		background: rgba(59, 130, 246, 0.16);
	}
	.grid tr.external-row:hover td.name-col {
		background: color-mix(in srgb, var(--surface) 84%, rgb(59 130 246) 16%);
	}
	.grid td.cell-editable {
		cursor: pointer;
	}
	.grid td.cell-editable:hover {
		box-shadow: inset 0 0 0 2px var(--accent);
	}

	.legend {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 14px;
		font-size: 12.5px;
		color: var(--text-soft);
	}
	.legend-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px 16px;
	}
	.legend-row + .legend-row {
		padding-top: 8px;
		border-top: 1px solid var(--border);
	}
	.legend-row-label {
		font-size: 10.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-mute);
		margin-right: 2px;
	}
	.legend-item {
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}
	.legend-note {
		color: var(--text-mute);
	}
	.swatch-half-am {
		background: linear-gradient(135deg, var(--text-mute) 0 50%, transparent 50% 100%);
	}
	.swatch-half-pm {
		background: linear-gradient(135deg, transparent 0 50%, var(--text-mute) 50% 100%);
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		z-index: 50;
	}
	.modal {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
		padding: 24px;
		width: 100%;
		max-width: 440px;
	}
	.modal h3 {
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
		margin-bottom: 4px;
	}
	.modal .ext-add {
		margin-top: 16px;
	}
	.modal .field {
		margin-top: 14px;
	}
	.modal .field > label,
	.field-label {
		display: block;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-mute);
		margin-bottom: 6px;
	}
	.img-rows-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 6px;
	}
	.img-rows-head .field-label {
		margin-bottom: 0;
	}
	.img-rows-all {
		font-size: 11.5px;
		font-weight: 600;
		color: var(--accent);
		white-space: nowrap;
	}
	.img-rows-all:hover {
		text-decoration: underline;
	}
	.img-rows-pick {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 1px 8px;
		max-height: 180px;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		padding: 4px;
	}
	.img-row-check {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 5px 6px;
		margin-bottom: 0;
		border-radius: var(--r-sm, 6px);
		font-size: 13px;
		font-weight: 400;
		color: var(--text);
		cursor: pointer;
		min-width: 0;
	}
	/* La checkbox vit dans un `.field` (cf. app.css `.field input`) qui la stylerait sinon comme un
	   champ texte pleine largeur — on la ramène à une case à cocher normale. */
	.img-row-check input[type='checkbox'] {
		width: 15px;
		height: 15px;
		flex-shrink: 0;
		padding: 0;
		margin: 0;
		border-radius: 4px;
		accent-color: var(--accent);
	}
	.img-row-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.img-row-check:has(input:checked) {
		background: var(--accent-tint-2);
	}
	.img-row-check:hover {
		background: var(--surface-2);
	}
	.img-row-pos {
		margin-left: auto;
		min-width: 16px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: var(--accent);
		color: var(--surface);
		font-size: 10px;
		font-weight: 700;
		flex-shrink: 0;
	}
	.ex-dates {
		display: flex;
		gap: 12px;
		margin-top: 16px;
	}
	.ex-field {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.ex-field input {
		padding: 9px 11px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13px;
	}
	.ex-field input:focus {
		outline: none;
		border-color: var(--accent);
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 18px;
	}

	.declare-cta {
		margin-bottom: 18px;
	}

	.wizard-modal {
		max-width: 460px;
	}
	.wizard-steps {
		display: flex;
		align-items: center;
		margin-top: 18px;
	}
	.wizard-step {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 5px;
	}
	.wizard-dot {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: 12px;
		font-weight: 700;
		background: var(--surface-sunk);
		color: var(--text-mute);
		border: 1px solid var(--border);
		transition: background 0.15s, color 0.15s, border-color 0.15s;
	}
	.wizard-step.current .wizard-dot {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}
	.wizard-step.done .wizard-dot {
		background: var(--accent-tint);
		border-color: var(--accent);
		color: var(--accent-ink);
	}
	.wizard-label {
		font-size: 10.5px;
		color: var(--text-mute);
		white-space: nowrap;
	}
	.wizard-step.current .wizard-label {
		color: var(--text);
		font-weight: 600;
	}
	.wizard-line {
		flex: 1;
		height: 2px;
		background: var(--border);
		margin: 0 6px 18px;
	}
	.wizard-line.done {
		background: var(--accent);
	}
	.wizard-progress {
		text-align: center;
		margin: 8px 0 0;
	}
	.wizard-actions {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		margin-top: 20px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
	}
</style>
