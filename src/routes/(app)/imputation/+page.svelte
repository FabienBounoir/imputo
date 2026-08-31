<script lang="ts">
	import {
		dayName,
		dayNum,
		parseISODate,
		isPublicHolidayFR,
		todayInParis,
		isoWeek,
		GRANULARITIES,
		GRANULARITY_LABELS,
		type Granularity,
		type PeriodMode
	} from '$lib/utils/date';
	import { tick } from 'svelte';
	import { goto, afterNavigate, invalidateAll, replaceState } from '$app/navigation';
	import { beep } from '$lib/sound';
	import { Confetti } from 'svelte-confetti';
	import { navigating, page } from '$app/state';
	import ExportModal from '$lib/components/ExportModal.svelte';
	import QuickAddPalette from '$lib/components/QuickAddPalette.svelte';
	import TicketEditModal from '$lib/components/TicketEditModal.svelte';
	import ImputationMobile from '$lib/components/ImputationMobile.svelte';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import { ABSENCE_TYPE_COLORS, ABSENCE_TYPE_LABELS, ABSENCE_PERIOD_LABELS } from '$lib/absenceTypes';
	import type { Row } from '$lib/imputationRow';
	import { jiraTicketUrl } from '$lib/jiraLink';
	import { buildCycle, cycleNext } from '$lib/utils/imputationCycle';

	let { data } = $props();

	const jiraCfg = $derived({
		jiraBaseUrl: data.jiraBaseUrl,
		jiraLinkEnabled: data.workspace!.jiraLinkEnabled,
		jiraLinkKeyRegexPattern: data.workspace!.jiraLinkKeyRegexPattern,
		jiraLinkKeyRegexReplacement: data.workspace!.jiraLinkKeyRegexReplacement
	});
	function ticketJiraUrl(row: Row): string | null {
		return row.targetType === 'TICKET' ? jiraTicketUrl(jiraCfg, row.sublabel) : null;
	}

	// Le tableau (colonnes jour + colonnes figées + navigation clavier) n'est pas utilisable au doigt
	// sur un écran étroit : en dessous de ce seuil on rend ImputationMobile (un jour à la fois) à la
	// place. `innerWidth` est undefined au SSR — on part donc sur le tableau, comme avant.
	let innerWidth = $state(0);
	const isMobile = $derived(innerWidth > 0 && innerWidth <= 720);

	const TASK_COL_W = 320;
	const RAE_COL_W = 74;
	const EST_COL_W = 74;
	const DAY_COL_W = 68;
	const SUM_COL_W = 72;

	// Pas de saisie (§7 admin) : ex. 0.25 → [0, .25, .5, .75, 1] ; 0.5 → [0, .5, 1]. Jamais
	// figé sur .25, sinon un espace qui règle un autre pas ne change rien à la saisie réelle.
	// Arrondi à 3 décimales (pas 2) : un pas de 0.125 (1h/jour) doit survivre intact, sinon il
	// dérive silencieusement vers 0.13 dès la génération du cycle de clic.
	function round(n: number) {
		return Math.round((n + Number.EPSILON) * 1000) / 1000;
	}
	let CYCLE = $derived(buildCycle(data.imputationStep));
	let KEYMAP = $derived.by(() => {
		const map: Record<string, number> = { '0': 0 };
		CYCLE.filter((v) => v > 0).forEach((v, i) => {
			if (i < 9) map[String(i + 1)] = v;
		});
		return map;
	});

	// Clé de ligne (même format que côté serveur, cf. rowKey dans imputation.ts) : comparer sur
	// targetId seul confondrait deux objectifs du même ticket sur la même activité — le 4e segment
	// (objectiveId, seulement pour un TICKET issu d'un objectif) les garde traçables indépendamment.
	function computeRowKey(targetType: string, targetId: string, activityId: string | null, objectiveId: string | null = null) {
		return `${targetType}:${targetId}:${activityId ?? ''}:${objectiveId ?? ''}`;
	}

	function objectiveRowKey(o: (typeof data.weeklyObjectives)[number]) {
		const targetType = o.kind === 'TICKET' ? 'TICKET' : 'OBJECTIVE';
		const targetId = o.kind === 'TICKET' ? (o.ticketId ?? '') : o.id;
		return computeRowKey(targetType, targetId, o.activityId ?? null, o.kind === 'TICKET' ? o.id : null);
	}

	// Lignes de la feuille + objectifs TICKET attribués absents du tableau, fusionnées : appelée dès
	// l'état initial (pas seulement dans l'$effect) pour que le premier rendu ait déjà les lignes
	// attribuées et que le bandeau de rappel ne clignote pas avant de disparaître.
	// Les objectifs CUSTOM (tâche personnalisée, sans ticket donc sans SSP) ne sont volontairement
	// jamais ajoutés ici : ce sont des lignes purement informatives (cf. bandeau "🎯 Attribué sur
	// cette période"), pas des cibles d'imputation — sinon leurs heures échapperaient à la clôture
	// (cf. getConsoBySsp, qui ne peut attribuer un SSP qu'à une imputation liée à un ticket).
	function syncedRows(): Row[] {
		const next: Row[] = data.sheet.rows.map((r) => ({ ...r, amounts: { ...r.amounts } }));
		if (!data.readOnly) {
			for (const o of data.weeklyObjectives) {
				if (o.kind !== 'TICKET' || !o.ticketId || next.some((r) => r.rowKey === objectiveRowKey(o))) continue;
				next.push(buildRow('TICKET', o.ticketId, o.activityId ?? null, undefined, o.id, o.label));
			}
			// Lignes ajoutées via "+ Ajouter" mais jamais remplies (cf. pinRow) : sans ça elles
			// disparaîtraient au prochain chargement faute d'imputation en base. Un pin TICKET déjà
			// couvert par un objectif ci-dessus (même objectiveId) produit la même clé et est ignoré.
			for (const p of data.pinnedRows) {
				const rowKey = computeRowKey(p.targetType, p.targetId, p.activityId, p.objectiveId);
				if (next.some((r) => r.rowKey === rowKey)) continue;
				next.push(buildRow(p.targetType, p.targetId, p.activityId, undefined, p.objectiveId, null));
			}
		}
		return next;
	}

	// (Re)synchronise les lignes quand la plage affichée — ou le membre consulté — change. Le
	// membre fait partie de la clé : `?u=` conserve l'ancre, sans lui on garderait à l'écran les
	// lignes de la personne précédente avec les totaux de la nouvelle.
	const sheetKey = $derived(`${data.period.rangeKey}|${data.viewedId}`);
	let rows = $state<Row[]>(syncedRows());
	let currentKey = $state(`${data.period.rangeKey}|${data.viewedId}`);

	$effect(() => {
		if (sheetKey !== currentKey) {
			currentKey = sheetKey;
			// Les tâches attribuées apparaissent directement dans le tableau : plus besoin de cliquer
			// "+ Ajouter". Si l'utilisateur supprime ensuite une de ces lignes, elle ne revient pas ici
			// (l'effet ne se redéclenche pas tant que la période/le membre ne change pas) — elle réapparaît
			// alors dans le bandeau de rappel pour un ajout manuel.
			rows = syncedRows();
		}
	});

	// Clic sur le sprint/version d'une ligne ticket : va sur Tickets & chiffrage filtré sur ce
	// sprint/version, avec le ticket d'origine mis en surbrillance dans la liste.
	function goToTicketFilter(row: Row, kind: 'sprint' | 'version') {
		const t = data.tickets.find((x) => x.id === row.targetId);
		if (!t) return;
		const id = kind === 'sprint' ? t.sprintId : t.versionId;
		if (!id) return;
		goto(`/tickets?${kind}=${id}&highlight=${encodeURIComponent(t.key)}`);
	}

	const today = todayInParis();
	const days = $derived(data.period.days);

	let dayTotals = $derived.by(() => {
		const t: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));
		for (const r of rows) for (const d of days) t[d] = round(t[d] + (r.amounts[d] ?? 0));
		return t;
	});
	let periodTotal = $derived(round(Object.values(dayTotals).reduce((a, b) => a + b, 0)));
	// Congé prévisionnel sur la période affichée : pas encore imputé (cf. absences.ts
	// syncAbsenceEntries, qui exclut CONGE_PREVISIONNEL) — juste un signal visuel sur "Saisi".
	let hasPendingAbsence = $derived(Object.values(data.absences).some((a) => a.type === 'CONGE_PREVISIONNEL'));

	// Célébrations (jingle du jour + confettis/fanfare de la semaine, ci-dessous) : uniquement sur
	// sa propre feuille. Un admin peut modifier l'imputation d'un autre (readOnly ne couvre que la
	// vue équipe/lecture seule, pas ce cas), mais ce n'est pas à lui qu'on doit "féliciter".
	let isOwnSheet = $derived(!data.viewingTeam && !data.viewingOther);

	// Petit jingle quand un jour atteint pile la capacité — seulement à la transition (pas à
	// l'ouverture de la page si un jour est déjà complet), même timbre que l'easter egg du logo
	// ((app)/+layout.svelte) pour rester cohérent avec le seul autre "succès" sonore de l'app.
	let prevDayTotals: Record<string, number> | null = null;
	// Clé de la feuille au moment du dernier snapshot — sans ça, changer de semaine compare les
	// totaux de la nouvelle période à un snapshot indexé par les dates de l'ancienne : aucune clé ne
	// matche, `prevDayTotals[d]` vaut `undefined`, et "undefined !== capacité" se lit à tort comme
	// une transition tout juste franchie (bug constaté : jingle/confettis en changeant juste de
	// semaine, sans avoir rien rempli).
	let prevDaySheetKey: string | null = null;
	$effect(() => {
		const snapshot = { ...dayTotals };
		if (prevDayTotals && prevDaySheetKey === sheetKey && data.capacity > 0 && isOwnSheet) {
			for (const d of days) {
				const justReached = snapshot[d] === data.capacity && prevDayTotals[d] !== data.capacity;
				if (justReached) {
					[880, 1108.73, 1318.51].forEach((freq, i) =>
						beep(freq, { offset: i * 0.1, duration: i === 2 ? 0.3 : 0.1, type: 'triangle', volume: 0.14 })
					);
					break;
				}
			}
		}
		// Pas de baseline mémorisée hors de sa propre feuille — sinon, en revenant dessus après avoir
		// consulté celle d'un autre, la comparaison porterait sur des chiffres sans rapport.
		prevDayTotals = isOwnSheet ? snapshot : null;
		prevDaySheetKey = sheetKey;
	});
	// Capacité attendue = capacité/jour × jours ouvrés non fériés de la période (miroir de
	// calc.ts:weeklyCapacity/capacityPct côté serveur — dupliqué ici car $lib/server n'est pas
	// importable côté client, cf. le même motif pour totalEst/ecartVsEstime dans tickets/+page.svelte).
	let periodWorkdays = $derived(days.filter((d) => !isPublicHolidayFR(d)).length);
	let periodCapacity = $derived(round(data.capacity * periodWorkdays));
	let capacityPct = $derived(periodCapacity > 0 ? round(periodTotal / periodCapacity) : 0);
	let productive = $derived.by(() => {
		let s = 0;
		for (const r of rows) if (!r.nonProductive) for (const d of days) s += r.amounts[d] ?? 0;
		return round(s);
	});

	// Détail par semaine : sur un mois, un total global à 100 % peut masquer une semaine à 60 % et
	// une à 140 %. C'est ce découpage qui rend la vue longue actionnable.
	let weekStats = $derived.by(() =>
		data.period.weeks.map((w) => {
			let total = 0;
			for (const r of rows) for (const d of w.days) total += r.amounts[d] ?? 0;
			const capacity = round(data.capacity * w.days.filter((d) => !isPublicHolidayFR(d)).length);
			return { ...w, total: round(total), capacity, over: capacity > 0 && total > capacity };
		})
	);
	let multiWeek = $derived(data.period.weeks.length > 1);
	// En vue longue, l'alerte porte sur une semaine en dépassement, pas sur le cumul de la période.
	let overCapacity = $derived(multiWeek ? weekStats.some((w) => w.over) : capacityPct > 1);
	// Dernier jour de chaque semaine : sépare visuellement les blocs quand la période en couvre plusieurs.
	let weekBoundaries = $derived(new Set(data.period.weeks.slice(0, -1).map((w) => w.days[w.days.length - 1])));

	// Semaine complète (pile à la capacité, même transition-only que le jingle du jour ci-dessus) :
	// confettis (respecte prefers-reduced-motion, même garde que l'easter egg Konami dans le layout
	// racine) + un jingle plus fourni qu'un simple jour — gamme montante puis accord tenu.
	const CONFETTI_DURATION = 5000;
	let showWeekConfetti = $state(false);
	let confettiTimer: ReturnType<typeof setTimeout>;
	let prevWeekTotals: Record<string, number> | null = null;
	// Même garde que prevDaySheetKey ci-dessus, même raison : sans elle, arriver sur une semaine déjà
	// complète en changeant simplement de période se lit comme "vient d'être complétée".
	let prevWeekSheetKey: string | null = null;
	function playWeekCompleteSound() {
		const run = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5]; // Do5 → Do6
		run.forEach((freq, i) => beep(freq, { offset: i * 0.06, duration: 0.1, type: 'triangle', volume: 0.12 }));
		const chordAt = run.length * 0.06 + 0.05;
		[523.25, 659.25, 783.99].forEach((freq) => beep(freq, { offset: chordAt, duration: 0.6, type: 'triangle', volume: 0.16 }));
	}
	$effect(() => {
		const snapshot = Object.fromEntries(weekStats.map((w) => [w.days[0], w.total]));
		if (prevWeekTotals && prevWeekSheetKey === sheetKey && isOwnSheet) {
			for (const w of weekStats) {
				const key = w.days[0];
				const justCompleted = w.capacity > 0 && w.total === w.capacity && prevWeekTotals[key] !== w.capacity;
				if (justCompleted) {
					if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
						showWeekConfetti = true;
						clearTimeout(confettiTimer);
						confettiTimer = setTimeout(() => (showWeekConfetti = false), CONFETTI_DURATION);
					}
					playWeekCompleteSound();
					break;
				}
			}
		}
		prevWeekTotals = isOwnSheet ? snapshot : null;
		prevWeekSheetKey = sheetKey;
	});

	function fmt(n: number | undefined) {
		if (!n) return '·';
		return String(n);
	}

	// Dégradé continu (0 = --warn, capacité atteinte = --success) pour le total du jour — remplace
	// l'ancien binaire "ok dès qu'il y a quelque chose" qui affichait la même couleur pleine à 10%
	// qu'à 100% de la capacité. Le dépassement (.over) reste géré à part, en dehors de ce dégradé.
	function dayFillStyle(total: number, capacity: number): string | undefined {
		if (capacity <= 0 || total > capacity) return undefined;
		const pct = (Math.max(0, total) / capacity) * 100;
		return `--fill: color-mix(in srgb, var(--success) ${pct}%, var(--warn)); color: var(--fill); background: color-mix(in srgb, var(--fill) 15%, transparent);`;
	}

	async function setAmount(row: Row, day: string, value: number) {
		row.amounts[day] = value; // optimiste
		const body = new FormData();
		body.set('targetType', row.targetType);
		body.set('targetId', row.targetId);
		if (row.activityId) body.set('activityId', row.activityId);
		if (row.objectiveId) body.set('objectiveId', row.objectiveId);
		body.set('day', day);
		body.set('amount', String(value));
		body.set('targetUserId', data.viewedId);
		await fetch('?/setCell', { method: 'POST', body });
	}

	/** Clic = avance dans CYCLE, Shift+clic = recule (pas de conflit avec le clic droit/molette). */
	function cycle(row: Row, day: string, reverse = false) {
		setAmount(row, day, cycleNext(CYCLE, row.amounts[day] ?? 0, reverse));
	}

	/** Clic droit sur une case : popup au-dessus proposant directement toutes les valeurs du CYCLE
	 * (plus rapide que de cliquer plusieurs fois pour dérouler). */
	let cellPicker = $state<{ row: Row; day: string; top: number; left: number } | null>(null);
	function openCellPicker(e: MouseEvent, row: Row, day: string) {
		e.preventDefault();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		cellPicker = { row, day, top: rect.top, left: rect.left + rect.width / 2 };
	}
	function pickCellValue(value: number) {
		if (!cellPicker) return;
		setAmount(cellPicker.row, cellPicker.day, value);
		cellPicker = null;
	}

	function hasLockedDay(row: Row) {
		return Object.keys(row.lockedDays).length > 0;
	}

	/** Case/ligne verrouillée (cf. lockedDays) : lien vers l'absence source sur la page Absences —
	 * un vrai `<a href>` plutôt qu'un `goto()` programmatique (qui n'aboutit pas de façon fiable
	 * depuis un handler délégué Svelte 5, cf. le même choix sur les flèches ‹›  de période). */
	function absenceHref(absenceId: string) {
		return `/absences?highlight=${encodeURIComponent(absenceId)}`;
	}

	// --- Saisie clavier ---
	const MOVES: Record<string, [number, number]> = {
		ArrowRight: [0, 1],
		ArrowLeft: [0, -1],
		ArrowDown: [1, 0],
		ArrowUp: [-1, 0]
	};
	let scroller: HTMLDivElement | null = $state(null);
	// Un admin voit (et édite) Estimé/RAE même sur l'imputation d'un autre membre — ce sont des
	// valeurs par ticket + activité (ticket_activity_rae), pas par personne, donc rien ne s'écrit
	// "sous son nom" : même donnée que dans Tickets & chiffrage. Masqué seulement pour un non-admin
	// qui consulte un tiers (canViewImputations, lecture seule) et pour la vue "Toute l'équipe"
	// (agrégée, pas de colonnes par activité).
	const showRae = $derived(data.isAdmin || (!data.viewingOther && !data.viewingTeam));
	// Vue "Toute l'équipe" : une ligne par collaborateur, dépliable pour voir ses lignes détaillées.
	let expandedMembers = $state<Set<string>>(new Set());
	function toggleMember(userId: string) {
		const next = new Set(expandedMembers);
		if (next.has(userId)) next.delete(userId);
		else next.add(userId);
		expandedMembers = next;
	}
	const tableMinWidth = $derived(
		TASK_COL_W + (showRae ? EST_COL_W + RAE_COL_W : 0) + days.length * DAY_COL_W + SUM_COL_W
	);

	/**
	 * Ramène une cellule dans la zone réellement visible du défilement horizontal. Le scroll natif
	 * de `focus()` ignore les colonnes figées et garerait volontiers la cellule *sous* le bloc
	 * gauche (tâche + RAE) ou sous la colonne Σ — d'où `preventScroll` partout et ce calcul.
	 */
	function ensureCellVisibleX(el: HTMLElement) {
		if (!scroller) return;
		const leftFrozen = TASK_COL_W + (showRae ? EST_COL_W + RAE_COL_W : 0);
		const rightFrozen = SUM_COL_W;
		const min = el.offsetLeft + el.offsetWidth - (scroller.clientWidth - rightFrozen);
		const max = el.offsetLeft - leftFrozen;
		if (scroller.scrollLeft > max) scroller.scrollLeft = max;
		else if (scroller.scrollLeft < min) scroller.scrollLeft = min;
	}

	function focusCell(ri: number, di: number) {
		if (ri < 0 || ri >= rows.length || di < 0 || di >= days.length) return;
		const el = document.querySelector<HTMLElement>(`[data-cell="${ri}-${di}"]`);
		if (!el) return;
		el.focus({ preventScroll: true });
		ensureCellVisibleX(el);
	}

	// Cadre la période sur aujourd'hui (ou sur sa fin si elle est passée) et pose le focus pour
	// activer la navigation aux flèches sans clic. Dans un $effect, pas un onMount : le cadrage
	// doit rejouer à chaque changement de période.
	let framedKey = $state('');
	$effect(() => {
		const key = data.period.rangeKey;
		// Garde sur la clé : l'ajout d'une ligne ne doit pas re-cadrer la table sous les doigts.
		if (!scroller || framedKey === key) return;
		framedKey = key;
		const di = days.indexOf(today);
		const cell = scroller.querySelector<HTMLElement>(`[data-day="${di >= 0 ? today : days[days.length - 1]}"]`);
		if (cell) scroller.scrollLeft = Math.max(0, cell.offsetLeft - TASK_COL_W - (showRae ? EST_COL_W + RAE_COL_W : 0) - 40);
		if (!data.readOnly && rows.length > 0 && !pendingFocus) focusCell(0, di >= 0 ? di : 0);
	});

	function periodHref(anchor: string, over: { g?: string; mode?: string } = {}) {
		const p = new URLSearchParams({
			w: anchor,
			g: over.g ?? data.period.granularity,
			mode: over.mode ?? data.period.mode
		});
		if (data.viewingTeam) p.set('u', 'team');
		else if (data.viewingOther) p.set('u', data.viewedId);
		return `?${p}`;
	}
	function viewMember(id: string) {
		const p = new URLSearchParams({
			w: data.period.anchorISO,
			g: data.period.granularity,
			mode: data.period.mode
		});
		if (id !== data.selfId) p.set('u', id);
		goto(`?${p}`);
	}
	// Changement de granularité/mode : on reste sur aujourd'hui s'il est dans la période, sinon on
	// garde son point d'entrée — sans quoi passer en « mois » depuis une semaine de fin de mois
	// n'atterrirait pas sur le mois attendu.
	function setPeriod(over: { g?: string; mode?: string }) {
		const anchor = days.includes(today) ? today : data.period.firstDay;
		goto(periodHref(anchor, over), { noScroll: true });
	}
	// Granularité/mode/membre/période naviguent tous en rechargeant les données serveur : le
	// dérivé sert à geler la barre le temps du trajet, pour ne pas confondre l'ancienne période
	// affichée avec la nouvelle sélection pendant que le backend répond.
	const isNavigating = $derived(!!navigating.to);
	function onCellKey(e: KeyboardEvent, ri: number, di: number, row: Row, day: string) {
		// Verrouillée (lien <a> natif, cf. absenceHref) : les touches d'édition ne font rien — Enter
		// suit le lien nativement, la navigation (flèches) reste normale, gérée plus bas.
		if (row.lockedDays[day] && (e.key in KEYMAP || e.key === 'Backspace' || e.key === 'Delete')) {
			e.preventDefault();
			return;
		}
		if (e.key in KEYMAP) {
			e.preventDefault();
			setAmount(row, day, KEYMAP[e.key]);
		} else if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			setAmount(row, day, 0);
		} else if (e.key === 'ArrowLeft' && di === 0) {
			e.preventDefault();
			changePeriod('prev', ri);
		} else if (e.key === 'ArrowRight' && di === days.length - 1) {
			e.preventDefault();
			changePeriod('next', ri);
		} else if (e.key in MOVES) {
			e.preventDefault();
			const [dr, dc] = MOVES[e.key];
			focusCell(ri + dr, di + dc);
		}
	}

	// Navigation clavier entre périodes : on garde la ligne et on vise le bord opposé.
	let pendingFocus: { ri: number; side: 'first' | 'last' } | null = null;
	function changePeriod(dir: 'prev' | 'next', ri: number) {
		pendingFocus = { ri, side: dir === 'prev' ? 'last' : 'first' };
		const anchor = dir === 'prev' ? data.period.prevAnchor : data.period.nextAnchor;
		goto(periodHref(anchor), { keepFocus: true, noScroll: true });
	}
	afterNavigate(async () => {
		if (!pendingFocus) return;
		const { ri, side } = pendingFocus;
		pendingFocus = null;
		await tick(); // attendre la resynchro des lignes + le rendu
		if (rows.length === 0) return;
		const di = side === 'last' ? days.length - 1 : 0;
		focusCell(Math.min(Math.max(0, ri), rows.length - 1), di);
	});

	// --- Ajout de ligne ---
	let pickTarget = $state('');
	let pickActivity = $state('');
	// Ouverture directe depuis n'importe quelle page (Shift+A, cf. CommandPalette.svelte qui navigue
	// ici avec ?quickadd=1 puis nous laisse gérer notre propre état de palette).
	// - afterNavigate, pas $effect : un $effect qui lit page.url peut se redéclencher sur cette page
	//   très réactive (période, cellules…) — à chaque redéclenchement il rouvrait la palette juste
	//   après une fermeture (clic à côté/Échap semblaient ne jamais prendre). afterNavigate ne tourne
	//   qu'après une navigation effective, jamais sur une réactivité interne à la page.
	// - un drapeau non réactif (pas $state) plutôt que de compter sur le seul retrait de ?quickadd de
	//   l'URL : sur un chargement direct (URL tapée/rechargée), replaceState() peut être appelé avant
	//   que le routeur client soit prêt et lever une erreur avant d'avoir pu retirer le paramètre —
	//   sans ce drapeau, l'effet suivant relirait ?quickadd=1 encore présent et rouvrirait en boucle.
	let quickAddPalette: QuickAddPalette | undefined = $state();
	let quickAddConsumed = false;
	afterNavigate(() => {
		if (quickAddConsumed || page.url.searchParams.get('quickadd') !== '1') return;
		quickAddConsumed = true;
		// ticketId : retour depuis la création d'un ticket lancée faute de résultat dans la
		// recherche (cf. QuickAddPalette.svelte) — la palette rouvre direct sur l'activité.
		quickAddPalette?.show(page.url.searchParams.get('ticketId') ?? undefined);
		try {
			const url = new URL(page.url);
			url.searchParams.delete('quickadd');
			url.searchParams.delete('ticketId');
			replaceState(url, {});
		} catch {
			/* routeur pas encore prêt (chargement direct) : le drapeau ci-dessus empêche déjà toute
			   réouverture, le paramètre restera juste visible dans l'URL cette fois-ci. */
		}
	});
	let confirmDelete = $state<Row | null>(null);
	// Édition d'un ticket depuis sa ligne d'imputation — même modal que Tickets & chiffrage. Patch
	// direct de la ligne à chaque sauvegarde (titre/sprint/version) plutôt qu'un invalidateAll : plus
	// rapide, et ça ne touche pas row.amounts/raeReal (indépendants d'une édition de ticket).
	let editTicketId = $state<string | null>(null);
	// Ticket supprimé (créateur de l'espace) : la grille référence ce ticket dans plusieurs lignes,
	// plus simple et sûr de tout recharger que de patcher chaque ligne à la main.
	function onTicketDeleted() {
		invalidateAll();
	}
	function onTicketSaved(ticket: { id: string; title: string; sprintId: string | null; versionId: string | null }) {
		const sprintName = data.sprints.find((s) => s.id === ticket.sprintId)?.name ?? null;
		const versionName = data.versions.find((v) => v.id === ticket.versionId)?.name ?? null;
		for (const row of rows) {
			if (row.targetType === 'TICKET' && row.targetId === ticket.id) {
				row.label = ticket.title;
				row.sprintName = sprintName;
				row.versionName = versionName;
			}
		}
	}

	function hasAmount(row: Row) {
		return Object.values(row.amounts).some((a) => a > 0);
	}

	// Rien à perdre sur une ligne encore vide : on la supprime directement, la modale de confirmation
	// ne sert qu'à éviter d'effacer des heures déjà saisies par erreur.
	function requestDeleteRow(row: Row) {
		if (hasAmount(row)) confirmDelete = row;
		else doDeleteRow(row);
	}

	async function doDeleteRow(row: Row) {
		confirmDelete = null;
		rows = rows.filter((r) => r.rowKey !== row.rowKey); // optimiste
		const body = new FormData();
		body.set('targetType', row.targetType);
		body.set('targetId', row.targetId);
		if (row.activityId) body.set('activityId', row.activityId);
		if (row.objectiveId) body.set('objectiveId', row.objectiveId);
		// Le serveur reconstruit la plage depuis ces trois champs : `fetch('?/…')` perd la query string.
		body.set('anchor', data.period.anchorISO);
		body.set('g', data.period.granularity);
		body.set('mode', data.period.mode);
		body.set('targetUserId', data.viewedId);
		await fetch('?/deleteRow', { method: 'POST', body });
	}

	// Changement d'activité d'une ligne (clic sur son tag, ou sur "+ Activité" quand elle n'en a pas) —
	// même principe optimiste que doDeleteRow : on ne recharge pas la page, on rejoue localement ce que
	// le serveur va faire (fusion avec une ligne existante sur la nouvelle activité, sinon in-place).
	let activityPickerRow = $state<Row | null>(null);
	async function doReassignActivity(toActivityId: string | null) {
		const row = activityPickerRow;
		activityPickerRow = null;
		if (!row || row.activityId === toActivityId) return;

		const destKey = computeRowKey(row.targetType, row.targetId, toActivityId, row.objectiveId);
		const dest = rows.find((r) => r.rowKey !== row.rowKey && r.rowKey === destKey);
		if (dest) {
			for (const d of days) dest.amounts[d] = round((dest.amounts[d] ?? 0) + (row.amounts[d] ?? 0));
			rows = rows.filter((r) => r.rowKey !== row.rowKey);
		} else {
			rows = rows.map((r) =>
				r.rowKey === row.rowKey ? buildRow(row.targetType, row.targetId, toActivityId, r.amounts, row.objectiveId, row.objectiveNote) : r
			);
		}

		const body = new FormData();
		body.set('targetType', row.targetType);
		body.set('targetId', row.targetId);
		if (row.activityId) body.set('fromActivityId', row.activityId);
		if (toActivityId) body.set('toActivityId', toActivityId);
		if (row.objectiveId) body.set('objectiveId', row.objectiveId);
		body.set('anchor', data.period.anchorISO);
		body.set('g', data.period.granularity);
		body.set('mode', data.period.mode);
		body.set('targetUserId', data.viewedId);
		await fetch('?/reassignActivity', { method: 'POST', body });
	}

	// Anti-rafale pour le champ RAE (spinner/molette) : chaque pas déclenche un onchange, donc sans
	// ça une ligne d'historique par pas — on attend que ça se stabilise avant d'enregistrer (même
	// principe que l'onglet « Tickets & chiffrage »).
	const pendingRaeSaves = new Map<string, ReturnType<typeof setTimeout>>();

	/** RAE d'une ligne ticket + activité — même endpoint que l'onglet « Tickets & chiffrage ». */
	async function saveRae(row: Row, value: number) {
		if (!row.activityId) return;
		row.raeReal = value; // optimiste
		const key = `${row.targetId}-${row.activityId}`;
		clearTimeout(pendingRaeSaves.get(key));
		pendingRaeSaves.set(
			key,
			setTimeout(async () => {
				pendingRaeSaves.delete(key);
				await fetch(`/api/tickets/${row.targetId}/activity-rae`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ activityId: row.activityId, field: 'raeReal', value })
				});
			}, 600)
		);
	}

	// Anti-rafale pour le champ Estimé — même principe que le RAE ci-dessus.
	const pendingEstimationSaves = new Map<string, ReturnType<typeof setTimeout>>();

	/** Estimé d'une ligne ticket + activité — modifiable par tout le monde, même endpoint que le RAE. */
	async function saveEstimation(row: Row, value: number) {
		if (!row.activityId) return;
		row.estimation = value; // optimiste
		const key = `${row.targetId}-${row.activityId}`;
		clearTimeout(pendingEstimationSaves.get(key));
		pendingEstimationSaves.set(
			key,
			setTimeout(async () => {
				pendingEstimationSaves.delete(key);
				await fetch(`/api/tickets/${row.targetId}/activity-rae`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ activityId: row.activityId, field: 'estimation', value })
				});
			}, 600)
		);
	}

	function buildRow(
		targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE',
		targetId: string,
		activityId: string | null,
		amounts: Record<string, number> = {},
		objectiveId: string | null = null,
		note: string | null = null
	): Row {
		const rowKey = computeRowKey(targetType, targetId, activityId, objectiveId);
		let label = '';
		let sublabel = '';
		let emoji = '🎫';
		let nonProductive = false;
		let sprintName: string | null = null;
		if (targetType === 'TICKET') {
			const t = data.tickets.find((x) => x.id === targetId);
			label = t?.title ?? '—';
			sublabel = t?.key ?? '';
			sprintName = t?.sprintName ?? null;
		} else if (targetType === 'CATEGORY') {
			const c = data.categories.find((x) => x.id === targetId);
			label = c?.label ?? '—';
			nonProductive = c?.kind === 'NON_PRODUCTIVE';
			emoji = nonProductive ? '🌴' : '🛟';
			sublabel = 'Catégorie';
		} else {
			const o = data.weeklyObjectives.find((x) => x.id === targetId);
			label = o?.label ?? '—';
			emoji = '📝';
			sublabel = 'Tâche assignée';
		}
		// versionName / raeReal ne sont pas connus côté client : la ligne n'existe pas encore en base,
		// ils se peupleront au prochain chargement (le RAE part vide et la première saisie l'écrit).
		return {
			rowKey,
			targetType,
			targetId,
			activityId,
			objectiveId,
			objectiveNote: note,
			label,
			sublabel,
			emoji,
			nonProductive,
			sprintName,
			versionName: null,
			raeReal: targetType === 'TICKET' && activityId ? 0 : null,
			estimation: targetType === 'TICKET' && activityId ? 0 : null,
			amounts,
			lockedDays: {},
			absenceType: null
		};
	}

	function activityLabel(row: Row) {
		return data.activities.find((a) => a.id === row.activityId)?.label ?? null;
	}

	async function addRow() {
		if (!pickTarget) return;
		// Un pick TICKET issu de "🎯 Attribué cette semaine" (cf. TargetPicker) encode un 3e segment
		// (objectiveId) — absent pour un ticket choisi directement dans la liste classique.
		const [targetType, targetId, pickedObjectiveId] = pickTarget.split('::') as [
			'TICKET' | 'CATEGORY' | 'OBJECTIVE',
			string,
			string | undefined
		];
		const activityId = pickActivity || null;
		const objectiveId = targetType === 'TICKET' ? pickedObjectiveId || null : null;
		const rowKey = computeRowKey(targetType, targetId, activityId, objectiveId);
		if (rows.some((r) => r.rowKey === rowKey)) {
			pickTarget = '';
			return;
		}
		const note = objectiveId ? (data.weeklyObjectives.find((o) => o.id === objectiveId)?.label ?? null) : null;
		rows = [...rows, buildRow(targetType, targetId, activityId, undefined, objectiveId, note)];
		pickTarget = '';
		pickActivity = '';

		// Épinglée en base tout de suite : sans imputation dessus, la ligne ne survivrait pas
		// au prochain chargement (cf. syncedRows/pinRow). Seule la poubelle la fait disparaître.
		// anchor/g/mode : le serveur en reconstruit la période pour scoper l'épingle à la période
		// affichée (même principe que doDeleteRow/doReassignActivity).
		const body = new FormData();
		body.set('targetType', targetType);
		body.set('targetId', targetId);
		if (activityId) body.set('activityId', activityId);
		if (objectiveId) body.set('objectiveId', objectiveId);
		body.set('anchor', data.period.anchorISO);
		body.set('g', data.period.granularity);
		body.set('mode', data.period.mode);
		body.set('targetUserId', data.viewedId);
		await fetch('?/pinRow', { method: 'POST', body });
	}

	// Ajout en un clic depuis le bandeau de rappel (contourne le picker) — TICKET uniquement, cf.
	// syncedRows : un CUSTOM n'a rien à ajouter, il reste une information dans le bandeau.
	function quickAddObjective(o: (typeof data.weeklyObjectives)[number]) {
		if (o.kind !== 'TICKET' || !o.ticketId || rows.some((r) => r.rowKey === objectiveRowKey(o))) return;
		rows = [...rows, buildRow('TICKET', o.ticketId, o.activityId ?? null, undefined, o.id, o.label)];
	}

	// Objectifs TICKET auto-ajoutés au chargement mais absents du tableau (supprimés depuis) + tous
	// les objectifs CUSTOM (jamais ajoutés, cf. syncedRows) : c'est ce que le bandeau de rappel remonte.
	let missingObjectives = $derived(
		data.weeklyObjectives.filter((o) => !rows.some((r) => r.rowKey === objectiveRowKey(o)))
	);
</script>

{#snippet ticketIcon()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
		<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z" />
		<path d="M13 6v2M13 11v2M13 16v2" />
	</svg>
{/snippet}

{#snippet taskIcon()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
		<rect x="5" y="4" width="14" height="16" rx="2" />
		<path d="M9 9h6M9 13h6M9 17h3" />
	</svg>
{/snippet}

{#snippet coffeeIcon()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
		<path d="M6 8h10v7a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4V8Z" />
		<path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16" />
	</svg>
{/snippet}

{#snippet lifeRingIcon()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
		<circle cx="12" cy="12" r="9" />
		<circle cx="12" cy="12" r="4" />
		<path d="m7.5 7.5 3 3M13.5 13.5 16.5 16.5M16.5 7.5l-3 3M10.5 13.5l-3 3" />
	</svg>
{/snippet}

{#snippet rowIcon(row: Row)}
	{#if row.targetType === 'TICKET'}
		{@render ticketIcon()}
	{:else if row.targetType === 'CATEGORY'}
		{#if row.nonProductive}{@render coffeeIcon()}{:else}{@render lifeRingIcon()}{/if}
	{:else}
		{@render taskIcon()}
	{/if}
{/snippet}

{#if showWeekConfetti}
	<div class="week-confetti" aria-hidden="true">
		<Confetti
			x={[-5, 5]}
			y={[0, 0.1]}
			delay={[500, 2000]}
			infinite
			duration={CONFETTI_DURATION}
			amount={200}
			fallDistance="100vh"
			rounded
			colorArray={[
				'var(--accent)',
				'var(--accent-ink)',
				'color-mix(in srgb, var(--accent) 55%, white)',
				'color-mix(in srgb, var(--accent) 75%, black)'
			]}
		/>
	</div>
{/if}

<div class="topbar">
	<h1>{data.viewingTeam ? "Imputation de l'équipe" : data.viewingOther ? `Imputation de ${data.viewedName}` : 'Mon imputation'}<small>{data.period.label}</small></h1>
	{#if !data.viewingTeam && data.vacationWeeks.length > 0}
		<span class="vac-badge">
			🏖 En vacances
			{#if multiWeek && data.vacationWeeks.length < data.period.weeks.length}
				{data.vacationWeeks.map((w) => `S${isoWeek(parseISODate(w))}`).join(', ')}
			{/if}
		</span>
	{/if}
	<div class="spacer"></div>
	{#if isNavigating}<span class="loading-hint">Chargement…</span>{/if}
	<fieldset class="periodpick" disabled={isNavigating}>
		<div class="seg">
			{#each GRANULARITIES as g (g)}
				<button class:on={data.period.granularity === g} onclick={() => setPeriod({ g })}>{GRANULARITY_LABELS[g]}</button>
			{/each}
		</div>
		{#if data.period.granularity !== 'WEEK'}
			<div class="seg">
				{#each [['FIXED', 'Fixe'], ['ROLLING', 'Glissant']] as [m, lab] (m)}
					<button class:on={data.period.mode === m} onclick={() => setPeriod({ mode: m })}>{lab}</button>
				{/each}
			</div>
		{/if}
	</fieldset>
	{#if data.canViewOthers}
		<select
			class="member-pick"
			value={data.viewingTeam ? 'team' : data.viewedId}
			disabled={isNavigating}
			onchange={(e) => viewMember(e.currentTarget.value)}
			aria-label="Voir l'imputation de"
		>
			<option value={data.selfId}>Mon imputation</option>
			<option value="team">Toute l'équipe</option>
			{#each data.members.filter((m) => m.id !== data.selfId) as m (m.id)}
				<option value={m.id}>{m.displayName}</option>
			{/each}
		</select>
	{/if}
	{#if data.isAdmin}
		<ExportModal label="Exporter Excel" buttonClass="btn btn-ghost" />
	{/if}
	<div class="wknav" class:disabled={isNavigating}>
		<a class="wkbtn" href={periodHref(data.period.prevAnchor)} aria-label="Période précédente" aria-disabled={isNavigating} onclick={(e) => { if (isNavigating) e.preventDefault(); }}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 18-6-6 6-6"/></svg>
		</a>
		<span class="cur">{data.period.shortLabel}</span>
		<a class="wkbtn" href={periodHref(data.period.nextAnchor)} aria-label="Période suivante" aria-disabled={isNavigating} onclick={(e) => { if (isNavigating) e.preventDefault(); }}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m9 18 6-6-6-6"/></svg>
		</a>
	</div>
</div>

<div class="content">
	{#if data.viewingOther}
		<div class="ro-banner" class:editing={!data.readOnly}>
			{#if data.readOnly}
				👁 Imputation de <b>{data.viewedName}</b> — lecture seule
			{:else}
				✏️ Vous modifiez l'imputation de <b>{data.viewedName}</b>
			{/if}
		</div>
	{/if}
	{#if data.viewingTeam}
	{@const team = data.team}
	<div class="card grid-card">
		<div class="table-scroll">
		<table class="imp no-rae" style="--imp-min-w: {tableMinWidth}px; --task-w: {TASK_COL_W}px;">
			<colgroup>
				<col class="col-task" />
				{#each days as d (d)}<col class="col-day" />{/each}
				<col class="col-sum" />
			</colgroup>
			<thead>
				{#if multiWeek}
					<tr class="wk-head">
						<th class="task-h"></th>
						{#each data.period.weeks as w (w.mondayISO)}<th colspan={w.days.length}>S{w.weekNumber}</th>{/each}
						<th class="sum-h"></th>
					</tr>
				{/if}
				<tr class="day-head" class:below-group={multiWeek}>
					<th class="task-h">Collaborateur</th>
					{#each days as d (d)}
						<th data-day={d} class:today={d === today} class:holiday={isPublicHolidayFR(d)} class:wk-end={weekBoundaries.has(d)}>{dayName(parseISODate(d))}<span class="dnum">{dayNum(parseISODate(d))}</span></th>
					{/each}
					<th class="sum-h">Σ</th>
				</tr>
			</thead>
			<tbody>
				{#each team?.members ?? [] as m (m.userId)}
					{@const isOpen = expandedMembers.has(m.userId)}
					<tr class="team-member-row">
						<td class="task">
							<button type="button" class="team-toggle" onclick={() => toggleMember(m.userId)} aria-expanded={isOpen}>
								<svg class="chev" class:open={isOpen} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6" /></svg>
								<UserAvatar userId={m.userId} name={m.name} size={20} />
					<b>{m.name}</b>
							</button>
						</td>
						{#each days as d (d)}
							<td class="day" class:today={d === today} class:wk-end={weekBoundaries.has(d)}>
								<span class="cell ro" class:val={(m.dayTotals[d] ?? 0) > 0} class:empty={!(m.dayTotals[d] ?? 0)}>{fmt(m.dayTotals[d])}</span>
							</td>
						{/each}
						<td class="sum tabnum">{m.total}</td>
					</tr>
					{#if isOpen}
						{#each m.rows as row (row.rowKey)}
							<tr class="team-detail-row">
								<td class="task">
									<div class="task-cell">
										<span class="pill pill-ico">{@render rowIcon(row)}</span>
										<div class="tt">
											<b>{row.objectiveNote || row.label}</b>
											{#if ticketJiraUrl(row)}
												<a class="sub" href={ticketJiraUrl(row)} target="_blank" rel="noopener noreferrer" title="Ouvrir dans Jira" onclick={(e) => e.stopPropagation()}>{row.sublabel}</a>
											{:else}
												<span class="sub">{row.sublabel}</span>
											{/if}
										</div>
									</div>
								</td>
								{#each days as d (d)}
									<td class="day" class:today={d === today} class:wk-end={weekBoundaries.has(d)}>
										<span class="cell ro" class:val={(row.amounts[d] ?? 0) > 0} class:empty={!(row.amounts[d] ?? 0)}>{fmt(row.amounts[d])}</span>
									</td>
								{/each}
								<td class="sum tabnum">{round(days.reduce((a, d) => a + (row.amounts[d] ?? 0), 0))}</td>
							</tr>
						{/each}
						{#if m.rows.length === 0}
							<tr class="team-detail-row"><td colspan={days.length + 2} class="empty-row">Aucune ligne sur cette période.</td></tr>
						{/if}
					{/if}
				{/each}
				{#if (team?.members.length ?? 0) === 0}
					<tr><td colspan={days.length + 2} class="empty-row">Aucune imputation sur cette période.</td></tr>
				{/if}
			</tbody>
			<tfoot>
				<tr>
					<td class="task foot-lab">Total / jour</td>
					{#each days as d (d)}
						<td class:wk-end={weekBoundaries.has(d)}><span class="day-tot tabnum">{fmt(team?.dayTotals[d] ?? 0)}</span></td>
					{/each}
					<td class="sum tabnum">{team?.total ?? 0}</td>
				</tr>
			</tfoot>
		</table>
		</div>
	</div>
	{:else}
	<div class="summary">
		<div
			class="card stat"
			class:pending-stat={hasPendingAbsence}
			style={hasPendingAbsence ? `--absence-color:${ABSENCE_TYPE_COLORS.CONGE_PREVISIONNEL}` : undefined}
			title={hasPendingAbsence ? 'Congé prévisionnel en attente de validation — pas encore comptabilisé' : undefined}
		>
			<div class="k">Saisi · {data.period.shortLabel}</div>
			<div class="v tabnum">{periodTotal} <small>j</small></div>
		</div>
		<div class="card stat">
			<div class="k">Productif (projet)</div>
			<div class="v tabnum">{productive} <small>j</small></div>
		</div>
		<div class="card stat">
			<div class="k">Capacité / jour</div>
			<div class="v tabnum">{data.capacity} <small>j</small></div>
		</div>
		<div class="card stat" class:warn-stat={overCapacity}>
			<div class="k">% de capacité ({GRANULARITY_LABELS[data.period.granularity].toLowerCase()})</div>
			<div class="v tabnum">{Math.round(capacityPct * 100)} <small>%</small></div>
			<div class="cap-sub tabnum">{periodTotal} / {periodCapacity} j</div>
			{#if overCapacity}
				<div class="cap-warn">⚠ {multiWeek ? 'Une semaine en dépassement' : 'Dépassement — reste possible'}</div>
			{/if}
		</div>
	</div>

	{#if multiWeek}
		<div class="wkstrip">
			{#each weekStats as w (w.mondayISO)}
				<span class="wkchip" class:over={w.over}>
					<b>S{w.weekNumber}</b> <span class="tabnum">{w.total}</span> / {w.capacity} j{w.over ? ' ⚠' : ''}
				</span>
			{/each}
		</div>
	{/if}

	{#if !data.readOnly && missingObjectives.length > 0}
		<div class="card reminder-card">
			<div class="reminder-head">🎯 Attribué sur cette période</div>
			<div class="reminder-list">
				{#each missingObjectives as o, i (o.id)}
					{#if multiWeek && o.weekMonday !== missingObjectives[i - 1]?.weekMonday}
						<div class="reminder-week">S{isoWeek(parseISODate(o.weekMonday))}</div>
					{/if}
					<div class="reminder-item">
						<span class="reminder-label">
							<span class="reminder-ico">
								{#if o.kind === 'TICKET'}{@render ticketIcon()}{:else}{@render taskIcon()}{/if}
							</span>
							{o.kind === 'TICKET' ? `${o.ticketKey} — ${o.ticketTitle}` : o.label}
							{#if o.kind === 'TICKET' && o.label} — {o.label}{/if}
							{#if o.activityLabel}<span class="tag-activity">{o.activityLabel}</span>{/if}
						</span>
						{#if o.kind === 'TICKET'}
							<button class="btn btn-ghost reminder-add" onclick={() => quickAddObjective(o)}>+ Ajouter</button>
						{:else}
							<!-- CUSTOM : pas de ticket donc pas de SSP, jamais imputable — pure information sur
							     ce qui est attendu cette semaine (cf. syncedRows/quickAddObjective). -->
							<span class="reminder-info" title="Tâche sans ticket associé — non imputable directement, impute tes heures sur le ticket concerné.">Info seule</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<div class="card grid-card" class:mobile-card={isMobile}>
		{#if isMobile}
		<ImputationMobile
			{rows}
			{days}
			{today}
			capacity={data.capacity}
			absences={data.absences}
			readOnly={data.readOnly}
			onCycle={(row, day) => cycle(row, day)}
			onSetAmount={setAmount}
			onDelete={requestDeleteRow}
			onPickActivity={(row) => (activityPickerRow = row)}
			{activityLabel}
			{absenceHref}
			{rowIcon}
		/>
		{:else}
		<div class="table-scroll" bind:this={scroller}>
		<table class="imp" class:no-rae={!showRae} style="--imp-min-w: {tableMinWidth}px; --task-w: {TASK_COL_W}px;">
			<colgroup>
				<col class="col-task" />
				{#if showRae}<col class="col-estimation" /><col class="col-rae" />{/if}
				{#each days as d (d)}<col class="col-day" />{/each}
				<col class="col-sum" />
			</colgroup>
			<thead>
				{#if multiWeek}
					<tr class="wk-head">
						<th class="task-h"></th>
						{#if showRae}<th class="est-h"></th><th class="rae-h"></th>{/if}
						{#each data.period.weeks as w (w.mondayISO)}<th colspan={w.days.length}>S{w.weekNumber}</th>{/each}
						<th class="sum-h"></th>
					</tr>
				{/if}
				<tr class="day-head" class:below-group={multiWeek}>
					<th class="task-h">Tâche / catégorie</th>
					{#if showRae}<th class="est-h" title="Estimé de la paire ticket + activité — modifiable par tout le monde">Estimé</th><th class="rae-h" title="Reste à engager de la paire ticket + activité">RAE</th>{/if}
					{#each days as d (d)}
						{@const abs = data.absences[d]}
						<th
							data-day={d}
							class:today={d === today}
							class:holiday={isPublicHolidayFR(d)}
							class:wk-end={weekBoundaries.has(d)}
							class:absent={!!abs}
							style={abs ? `--absence-color:${ABSENCE_TYPE_COLORS[abs.type]}` : undefined}
							title={[
								isPublicHolidayFR(d) ? 'Jour férié' : '',
								abs ? `${ABSENCE_TYPE_LABELS[abs.type]}${abs.period !== 'FULL' ? ' — ' + ABSENCE_PERIOD_LABELS[abs.period] : ''}` : ''
							]
								.filter(Boolean)
								.join(' · ')}
						>{dayName(parseISODate(d))}<span class="dnum">{dayNum(parseISODate(d))}</span></th>
					{/each}
					<th class="sum-h">Σ</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row, ri (row.rowKey)}
					<tr>
						<td class="task">
							<div class="task-cell">
								<span class="pill pill-ico">{@render rowIcon(row)}</span>
								<div class="tt">
									<b>{row.objectiveNote || row.label}</b>
									<span class="sub">
										{#if ticketJiraUrl(row)}
											<a href={ticketJiraUrl(row)} target="_blank" rel="noopener noreferrer" title="Ouvrir dans Jira">{row.sublabel}</a>
										{:else}
											{row.sublabel}
										{/if}
										{#if !data.readOnly}
											{#if activityLabel(row)}
												<button
													type="button"
													class="tag-activity tag-link"
													onclick={() => (activityPickerRow = row)}
													title="Changer l'activité"
												>{activityLabel(row)}</button>
											{:else}
												<button
													type="button"
													class="tag-activity tag-add"
													onclick={() => (activityPickerRow = row)}
													title="Associer une activité à cette ligne"
												>+ Activité</button>
											{/if}
										{:else if activityLabel(row)}
											<span class="tag-activity">{activityLabel(row)}</span>
										{/if}
										{#if row.sprintName}
											<button
												type="button"
												class="tag-activity tag-link"
												onclick={() => goToTicketFilter(row, 'sprint')}
												title="Voir les tickets du sprint {row.sprintName}"
											>{row.sprintName}</button>
										{/if}
										{#if row.versionName}
											<button
												type="button"
												class="tag-activity tag-link"
												onclick={() => goToTicketFilter(row, 'version')}
												title="Voir les tickets de la version {row.versionName}"
											>{row.versionName}</button>
										{/if}
									</span>
								</div>
								{#if row.targetType === 'TICKET'}
									<button class="row-edit" onclick={() => (editTicketId = row.targetId)} aria-label="Modifier le ticket">
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
									</button>
								{/if}
								{#if !data.readOnly}
									{#if hasLockedDay(row)}
										<a
											class="row-del row-del-locked"
											href={absenceHref(Object.values(row.lockedDays)[0])}
											aria-label="Ligne verrouillée par une absence"
											title="Cette ligne contient des jours issus d'une absence validée — à retirer depuis la page Absences."
										>
											<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
										</a>
									{:else}
										<button class="row-del" onclick={() => requestDeleteRow(row)} aria-label="Supprimer la ligne">
											<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
										</button>
									{/if}
								{/if}
							</div>
						</td>
						{#if showRae}
							<td class="estimation">
								{#if row.targetType === 'TICKET' && row.activityId}
									<input
										class="rae-input tabnum"
										type="number"
										step="0.25"
										min="0"
										value={row.estimation ?? 0}
										aria-label="Estimé"
										onchange={(e) => saveEstimation(row, Number(e.currentTarget.value) || 0)}
									/>
								{:else}
									<span
										class="rae-na"
										title={row.targetType === 'TICKET'
											? 'Sélectionnez une activité sur cette ligne pour saisir l’Estimé.'
											: 'L’Estimé ne concerne que les tickets.'}
									>—</span>
								{/if}
							</td>
							<td class="rae">
								{#if row.targetType === 'TICKET' && row.activityId}
									<input
										class="rae-input tabnum"
										type="number"
										step="0.25"
										min="0"
										value={row.raeReal ?? 0}
										aria-label="RAE"
										onchange={(e) => saveRae(row, Number(e.currentTarget.value) || 0)}
									/>
								{:else}
									<span
										class="rae-na"
										title={row.targetType === 'TICKET'
											? 'Sélectionnez une activité sur cette ligne pour saisir le RAE.'
											: 'Le RAE ne concerne que les tickets.'}
									>—</span>
								{/if}
							</td>
						{/if}
						{#each days as d, di (d)}
							{@const lockedAbsenceId = row.lockedDays[d]}
							<td class="day" class:today={d === today} class:wk-end={weekBoundaries.has(d)}>
								{#if data.readOnly}
									<span class="cell ro" class:val={(row.amounts[d] ?? 0) > 0} class:empty={!(row.amounts[d] ?? 0)}>{fmt(row.amounts[d])}</span>
								{:else if lockedAbsenceId}
									<a
										class="cell locked"
										class:val={(row.amounts[d] ?? 0) > 0}
										data-cell="{ri}-{di}"
										href={absenceHref(lockedAbsenceId)}
										style={row.absenceType ? `--absence-color:${ABSENCE_TYPE_COLORS[row.absenceType]}` : undefined}
										onkeydown={(e) => onCellKey(e, ri, di, row, d)}
										title="Imputé automatiquement depuis une absence validée — à modifier depuis la page Absences."
									>{fmt(row.amounts[d])}</a>
								{:else}
									<button
										class="cell"
										class:val={(row.amounts[d] ?? 0) > 0}
										class:empty={!(row.amounts[d] ?? 0)}
										data-cell="{ri}-{di}"
										onclick={(e) => cycle(row, d, e.shiftKey)}
										onkeydown={(e) => onCellKey(e, ri, di, row, d)}
										oncontextmenu={(e) => openCellPicker(e, row, d)}
									>{fmt(row.amounts[d])}</button>
								{/if}
							</td>
						{/each}
						<td class="sum tabnum">{round(days.reduce((a, d) => a + (row.amounts[d] ?? 0), 0))}</td>
					</tr>
				{/each}
				{#if rows.length === 0}
					<tr><td colspan={days.length + (showRae ? 4 : 2)} class="empty-row">{data.readOnly ? 'Aucune imputation sur cette période.' : 'Aucune ligne — ajoutez un ticket ou une catégorie ci-dessous.'}</td></tr>
				{/if}
			</tbody>
			<tfoot>
				<tr>
					<td class="task foot-lab">Total / jour</td>
					{#if showRae}<td class="estimation"></td><td class="rae"></td>{/if}
					{#each days as d (d)}
						<td class:wk-end={weekBoundaries.has(d)}><span class="day-tot tabnum" class:over={dayTotals[d] > data.capacity} style={dayFillStyle(dayTotals[d], data.capacity)}>{fmt(dayTotals[d])}</span></td>
					{/each}
					<td class="sum tabnum">{periodTotal}</td>
				</tr>
			</tfoot>
		</table>
		</div>
		{/if}

		{#if !data.readOnly}
		<div class="addrow" data-tour="imputation-add">
			<QuickAddPalette
				bind:this={quickAddPalette}
				tickets={data.tickets}
				categories={data.categories.filter((c) => !c.linkedAbsenceType)}
				recentTicketIds={data.recentTicketIds}
				versions={data.versions}
				objectives={data.weeklyObjectives.filter((o) => o.kind === 'TICKET')}
				activities={data.activities}
				onadd={(target, activityId) => {
					pickTarget = target;
					pickActivity = activityId ?? '';
					addRow();
				}}
			/>
		</div>
		{/if}
	</div>

	<div class="legend">
		{#if isMobile && !data.readOnly}
			<span class="kbd">Touchez une case pour faire défiler les valeurs · appui long pour vider</span>
		{:else if !data.readOnly}
			{@const keyEntries = Object.entries(KEYMAP).filter(([k]) => k !== '0')}
			<span class="kbd">Clique pour faire défiler <b>·</b> → {CYCLE.slice(1).map((v) => fmt(v)).join(' → ')} <b>·</b> <kbd>Shift</kbd>+clic pour reculer <b>·</b> clic droit pour choisir directement</span>
			<span class="kbd">Clavier : {#each keyEntries as [k] (k)}<kbd>{k}</kbd> {/each}→ {keyEntries.map(([, v]) => fmt(v)).join(' / ')} · <kbd>0</kbd>/<kbd>Suppr</kbd> vide · <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> naviguer · <kbd>←</kbd>/<kbd>→</kbd> en bord = période ±</span>
		{/if}
	</div>
	{/if}
</div>

<svelte:window
	bind:innerWidth
	onkeydown={(e) => e.key === 'Escape' && ((confirmDelete = null), (activityPickerRow = null), (cellPicker = null))}
/>

{#if cellPicker}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="cell-picker-backdrop" onclick={() => (cellPicker = null)} oncontextmenu={(e) => (e.preventDefault(), (cellPicker = null))}>
		<div
			class="cell-picker"
			style="top:{cellPicker.top}px; left:{cellPicker.left}px;"
			onclick={(e) => e.stopPropagation()}
		>
			{#each CYCLE as v (v)}
				<button type="button" class="cell-picker-opt" class:sel={(cellPicker.row.amounts[cellPicker.day] ?? 0) === v} onclick={() => pickCellValue(v)}>
					{fmt(v)}
				</button>
			{/each}
		</div>
	</div>
{/if}

{#if confirmDelete}
	{@const row = confirmDelete}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={() => (confirmDelete = null)}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h3>Supprimer cette ligne ?</h3>
			<p class="hint">
				{row.emoji} <b>{row.label}</b>{row.sublabel ? ` — ${row.sublabel}` : ''} — toutes les heures saisies sur
				<b>{data.period.label}</b> ({data.period.firstDay} → {data.period.lastDay}) pour cette ligne seront supprimées.
			</p>
			<div class="modal-actions">
				<button class="btn btn-ghost" onclick={() => (confirmDelete = null)}>Annuler</button>
				<button class="btn btn-danger" onclick={() => doDeleteRow(row)}>🗑 Supprimer</button>
			</div>
		</div>
	</div>
{/if}

{#if activityPickerRow}
	{@const row = activityPickerRow}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={() => (activityPickerRow = null)}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h3>{row.emoji} {row.label}</h3>
			<p class="hint">
				Activité de cette ligne pour <b>{data.period.label}</b> ({data.period.firstDay} → {data.period.lastDay}).
			</p>
			<div class="activity-options">
				<button type="button" class="activity-option" class:sel={!row.activityId} onclick={() => doReassignActivity(null)}>
					Aucune activité
				</button>
				{#each data.activities as a (a.id)}
					<button type="button" class="activity-option" class:sel={row.activityId === a.id} onclick={() => doReassignActivity(a.id)}>
						{a.label}
					</button>
				{/each}
			</div>
			<div class="modal-actions">
				<button class="btn btn-ghost" onclick={() => (activityPickerRow = null)}>Fermer</button>
			</div>
		</div>
	</div>
{/if}

<TicketEditModal
	ticketId={editTicketId}
	states={data.states}
	projects={data.projects}
	sprints={data.sprints}
	versions={data.versions}
	ssps={data.ssps}
	ticketGroups={data.ticketGroups}
	members={data.assignableMembers}
	testPhase={data.testPhase}
	canEditEstimation={data.canEditEstimation}
	isAdmin={data.isAdmin}
	isOwner={data.isOwner}
	onClose={() => (editTicketId = null)}
	onSaved={onTicketSaved}
	onDeleted={onTicketDeleted}
/>

<style>
	.cell-picker-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: transparent;
	}
	.cell-picker {
		position: fixed;
		z-index: 61;
		transform: translate(-50%, calc(-100% - 6px));
		display: flex;
		gap: 2px;
		padding: 4px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
	}
	.cell-picker-opt {
		padding: 4px 8px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: none;
		cursor: pointer;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.cell-picker-opt:hover {
		background: var(--accent-tint);
	}
	.cell-picker-opt.sel {
		border-color: var(--accent);
		color: var(--accent-ink);
		background: var(--accent-tint);
		font-weight: 600;
	}
	.week-confetti {
		position: fixed;
		top: -50px;
		left: 0;
		height: 100vh;
		width: 100vw;
		display: flex;
		justify-content: center;
		overflow: hidden;
		pointer-events: none;
		z-index: 9999;
	}
	.summary {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 14px;
		margin-bottom: 18px;
	}
	.stat {
		padding: 16px 18px;
	}
	.warn-stat {
		border-color: #c0392b;
	}
	.pending-stat .v {
		color: var(--absence-color);
	}
	.cap-warn {
		margin-top: 4px;
		font-size: 11px;
		font-weight: 600;
		color: #c0392b;
	}
	.stat .k {
		font-size: 12px;
		color: var(--text-mute);
		font-weight: 600;
	}
	.stat .v {
		font-family: var(--font-display);
		font-size: 30px;
		font-weight: 600;
		letter-spacing: -0.02em;
		margin-top: 6px;
	}
	.stat .v small {
		font-size: 14px;
		color: var(--text-mute);
		font-family: var(--font-ui);
		font-weight: 500;
	}

	.member-pick {
		padding: 8px 12px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font-size: 13px;
		box-shadow: var(--shadow-sm);
		max-width: 220px;
	}
	.member-pick:focus {
		outline: none;
		border-color: var(--accent);
	}
	.vac-badge {
		font-size: 11.5px;
		font-weight: 600;
		color: var(--accent-ink);
		background: var(--accent-tint);
		padding: 4px 10px;
		border-radius: 20px;
		white-space: nowrap;
	}
	.reminder-card {
		padding: 14px 18px;
		margin-bottom: 16px;
	}
	.reminder-head {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-mute);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 10px;
	}
	.reminder-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.reminder-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 4px;
	}
	.reminder-label {
		font-size: 13.5px;
		display: flex;
		align-items: baseline;
		gap: 7px;
		min-width: 0;
	}
	.reminder-ico {
		display: inline-flex;
		flex-shrink: 0;
		align-self: center;
		color: var(--text-mute);
	}
	.reminder-ico svg {
		width: 14px;
		height: 14px;
	}
	.tag-activity {
		display: inline-block;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-soft);
		background: var(--surface-sunk);
		padding: 2px 8px;
		border-radius: 20px;
		white-space: nowrap;
	}
	button.tag-link {
		font: inherit;
		border: none;
		cursor: pointer;
	}
	button.tag-link:hover {
		color: var(--accent-ink);
		background: color-mix(in srgb, var(--accent) 18%, var(--surface-sunk));
	}
	button.tag-activity.tag-add {
		background: transparent;
		border: 1px dashed var(--border-strong);
		color: var(--text-mute);
	}
	button.tag-activity.tag-add:hover {
		border-color: var(--accent);
		color: var(--accent-ink);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}
	.activity-options {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 16px;
		max-height: 320px;
		overflow-y: auto;
	}
	.activity-option {
		width: 100%;
		text-align: left;
		padding: 8px 10px;
		border-radius: var(--r-md, 10px);
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text);
	}
	.activity-option:hover {
		background: var(--surface-2);
	}
	.activity-option.sel {
		background: var(--accent-tint-2, color-mix(in srgb, var(--accent) 14%, transparent));
		color: var(--accent-ink);
	}
	.reminder-add {
		flex-shrink: 0;
		padding: 5px 11px;
		font-size: 12px;
	}
	.reminder-info {
		flex-shrink: 0;
		padding: 5px 11px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.ro-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 11px 16px;
		margin-bottom: 16px;
		border-radius: var(--r-md);
		background: var(--accent-tint);
		color: var(--accent-ink);
		font-size: 13.5px;
		font-weight: 500;
	}
	.ro-banner.editing {
		background: var(--warn-tint);
		color: var(--warn);
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
	.wknav.disabled {
		opacity: 0.6;
		pointer-events: none;
	}
	.loading-hint {
		font-size: 12.5px;
		color: var(--text-mute);
	}
	.cur {
		padding: 0 12px;
		font-weight: 600;
		font-size: 13.5px;
	}

	.grid-card {
		padding: 6px;
		/* `clip` et non `hidden` : on garde le rognage sur le rayon de la card sans créer de
		   conteneur de défilement — les cellules sticky doivent se résoudre contre .table-scroll. */
		overflow: clip;
		position: relative;
	}
	/* < 900px : la grille dépasse toujours (colonnes jours fixes) — ce dégradé indique qu'on peut
	   swiper à droite, sinon rien ne le montre (le tableau est juste rogné à l'écran). */
	.grid-card::after {
		content: '';
		display: none;
		position: absolute;
		top: 6px;
		right: 6px;
		bottom: 6px;
		width: 28px;
		pointer-events: none;
		background: linear-gradient(to right, transparent, var(--surface) 70%);
	}
	@media (max-width: 900px) {
		.grid-card::after {
			display: block;
		}
	}
	/* Vue mobile : plus de défilement horizontal à signaler (un jour à la fois, cf. ImputationMobile). */
	.grid-card.mobile-card::after {
		display: none;
	}
	/* Pas de hauteur bornée : le scroll vertical doit rester porté par .main (la page), pas par ce
	   conteneur — sinon un tableau chargé affiche sa propre barre verticale en plus de celle de la
	   page. Seul le défilement horizontal (colonnes jours) reste local à la table. */
	.table-scroll {
		overflow-x: auto;
		overflow-y: visible;
	}
	table.imp {
		width: 100%;
		min-width: var(--imp-min-w);
		border-collapse: separate;
		border-spacing: 0;
		table-layout: fixed; /* largeurs de colonnes fixes : les chiffres ne décalent plus rien */
	}
	.col-task {
		width: var(--task-w);
	}
	.col-estimation {
		width: 74px;
	}
	.col-rae {
		width: 74px;
	}
	.col-day {
		width: 68px;
	}
	.col-sum {
		width: 72px;
	}

	/* --- Colonnes / lignes figées ---
	   Une cellule sticky peint son propre fond : sans `background` opaque elle laisserait défiler
	   les cellules jour dessous, et le fond de survol posé sur le <tr> ne la traverse pas (d'où
	   les règles de hover dupliquées par cellule plus bas). */
	.imp th.task-h,
	.imp td.task {
		position: sticky;
		left: 0;
		z-index: 2;
		background: var(--surface);
	}
	.imp th.est-h,
	.imp td.estimation {
		position: sticky;
		left: var(--task-w);
		z-index: 2;
		background: var(--surface);
	}
	.imp th.rae-h,
	.imp td.rae {
		position: sticky;
		left: calc(var(--task-w) + 74px);
		z-index: 2;
		background: var(--surface);
		border-right: 1px solid var(--border);
		box-shadow: 6px 0 8px -6px rgba(0, 0, 0, 0.12);
	}
	/* Sans colonne RAE, l'affordance de défilement revient à la colonne tâche. */
	.imp.no-rae th.task-h,
	.imp.no-rae td.task {
		border-right: 1px solid var(--border);
		box-shadow: 6px 0 8px -6px rgba(0, 0, 0, 0.12);
	}
	.imp th.sum-h,
	.imp td.sum {
		position: sticky;
		right: 0;
		z-index: 2;
		background: var(--surface);
		box-shadow: -6px 0 8px -6px rgba(0, 0, 0, 0.12);
	}
	.imp thead th {
		position: sticky;
		z-index: 3;
		background: var(--surface);
	}
	.imp thead tr.wk-head th {
		top: 0;
		height: 24px;
		padding: 4px 8px;
		font-size: 10.5px;
		color: var(--text-mute);
		border-bottom: 1px solid var(--border);
	}
	.imp thead tr.day-head th {
		top: 0;
	}
	.imp thead tr.day-head.below-group th {
		top: 24px;
	}
	.imp tfoot td {
		position: sticky;
		bottom: 0;
		z-index: 3;
		background: var(--surface);
	}
	/* Les coins doivent passer au-dessus des deux axes à la fois. */
	.imp thead th.task-h,
	.imp thead th.est-h,
	.imp thead th.rae-h,
	.imp thead th.sum-h,
	.imp tfoot td.task,
	.imp tfoot td.sum {
		z-index: 4;
	}
	/* Séparateur entre deux semaines d'une même période. */
	.imp th.wk-end,
	.imp td.wk-end {
		border-right: 2px solid var(--border-strong);
	}

	.rae-input {
		width: 58px;
		padding: 5px 6px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13px;
		text-align: center;
	}
	.rae-input:focus {
		outline: none;
		border-color: var(--accent);
	}
	.imp td.rae,
	.imp td.estimation {
		text-align: center;
		border-top: 1px solid var(--border);
	}
	.rae-na {
		color: var(--text-mute);
		opacity: 0.5;
		font-size: 13px;
	}

	.periodpick {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}
	.periodpick:disabled {
		opacity: 0.6;
	}
	.seg {
		display: flex;
		background: var(--surface-sunk);
		border-radius: var(--r-md);
		padding: 3px;
	}
	.seg button {
		padding: 5px 11px;
		border-radius: 7px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-mute);
		transition: background 0.15s, color 0.15s;
	}
	.seg button.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}

	.wkstrip {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: -6px 2px 16px;
	}
	.wkchip {
		font-size: 11.5px;
		color: var(--text-mute);
		background: var(--surface-sunk);
		padding: 3px 10px;
		border-radius: 20px;
	}
	.wkchip b {
		color: var(--text-soft);
	}
	.wkchip.over {
		color: var(--warn);
		background: var(--warn-tint);
	}
	.cap-sub {
		margin-top: 2px;
		font-size: 11.5px;
		color: var(--text-mute);
	}
	.reminder-week {
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--text-mute);
		margin-top: 6px;
	}
	.imp thead th {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-mute);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 14px 8px 12px;
		text-align: center;
	}
	.imp thead th.task-h {
		text-align: left;
		padding-left: 18px;
	}
	.imp thead th .dnum {
		display: block;
		font-family: var(--font-display);
		font-size: 15px;
		color: var(--text);
		text-transform: none;
		font-weight: 600;
	}
	.imp thead th.today,
	.imp thead th.today .dnum {
		color: var(--accent);
	}
	.imp thead th.holiday,
	.imp thead th.holiday .dnum {
		color: var(--danger, #c0392b);
	}
	.imp thead th.holiday::after {
		content: '';
		display: inline-block;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--danger, #c0392b);
		margin-left: 4px;
		vertical-align: middle;
	}
	/* Absence (congé/formation/hors-projet) remontée depuis la page Absences — couleur par type. */
	.imp thead th.absent,
	.imp thead th.absent .dnum {
		color: var(--absence-color);
	}
	.imp thead th.absent::after {
		content: '';
		display: inline-block;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--absence-color);
		margin-left: 4px;
		vertical-align: middle;
	}
	.imp tbody tr:hover td {
		background: var(--surface-2);
	}
	.imp td.task {
		padding: 11px 14px 11px 18px;
		border-top: 1px solid var(--border);
	}
	.imp tbody tr:first-child td {
		border-top: none;
	}
	.task-cell {
		display: flex;
		align-items: center;
		gap: 11px;
	}
	/* Icône de type (ticket/tâche/catégorie) dans son rond — un peu plus grande que la même icône
	   utilisée sur la page Objectifs, cette pastille est un repère visuel plus proéminent en tête
	   de ligne du tableau. */
	.pill-ico {
		width: 28px;
		height: 28px;
		padding: 0;
		flex-shrink: 0;
		justify-content: center;
	}
	.pill-ico svg {
		width: 17px;
		height: 17px;
	}
	.task-cell .tt {
		flex: 1;
		min-width: 0;
	}
	.task-cell .tt b {
		font-size: 14px;
		font-weight: 600;
		display: block;
		letter-spacing: -0.01em;
	}
	.task-cell .tt .sub {
		display: flex;
		align-items: baseline;
		gap: 6px;
		font-size: 11.5px;
		color: var(--text-mute);
		font-variant-numeric: tabular-nums;
		min-width: 0;
	}
	.task-cell .tt .sub .tag-activity {
		font-size: 10px;
		padding: 1px 7px;
		flex-shrink: 0;
	}
	.row-del,
	.row-edit {
		flex-shrink: 0;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: 7px;
		color: var(--text-mute);
		opacity: 0;
		transition: opacity 0.15s, background 0.15s, color 0.15s;
	}
	.imp tbody tr:hover .row-del,
	.imp tbody tr:hover .row-edit {
		opacity: 1;
	}
	.row-del:hover,
	.row-del:focus-visible {
		background: color-mix(in srgb, var(--danger, #c0392b) 12%, transparent);
		color: var(--danger, #c0392b);
	}
	.row-del-locked:hover,
	.row-del-locked:focus-visible {
		background: color-mix(in srgb, var(--text-mute) 18%, transparent);
		color: var(--text);
	}
	.row-edit:hover,
	.row-edit:focus-visible {
		background: var(--accent-tint-2);
		color: var(--accent);
	}
	.imp td.day {
		border-top: 1px solid var(--border);
		text-align: center;
	}
	.cell {
		width: 46px;
		height: 38px;
		margin: 4px auto;
		border-radius: 10px;
		display: grid;
		place-items: center;
		font-size: 14px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		border: 1.5px solid transparent;
		transition: all 0.15s;
		color: var(--text);
	}
	.cell.val {
		background: var(--accent-tint-2);
		border-color: color-mix(in srgb, var(--accent) 28%, transparent);
		color: var(--accent-ink);
	}
	:global([data-theme='dark']) .cell.val {
		color: color-mix(in srgb, var(--accent) 80%, #fff);
	}
	.cell.empty {
		color: var(--text-mute);
		opacity: 0.5;
		font-weight: 500;
	}
	button.cell:hover {
		border-color: var(--accent);
		background: var(--accent-tint-2);
		transform: translateY(-1px);
	}
	.cell.ro {
		cursor: default;
	}
	/* Verrouillée par une absence validée (cf. Row.lockedDays) : fond grisé (jamais la teinte accent
	   de .cell.val), mais le chiffre reprend la couleur du type d'absence (--absence-color, posée en
	   inline style) pour identifier le type d'un coup d'œil — repli sur le gris si l'absence n'a pas
	   de type résolu (ne devrait pas arriver, cf. server). Répété sous le sélecteur `[data-theme=
	   'dark']` du dessus (même spécificité que lui, 3 sélecteurs) : sans ça, la case locked+val garde
	   la teinte accent en thème sombre, `:global([data-theme='dark']) .cell.val` étant plus spécifique
	   qu'un simple `.cell.locked`. */
	.cell.locked,
	:global([data-theme='dark']) .cell.locked {
		color: var(--absence-color, var(--text-mute));
		background: color-mix(in srgb, var(--text-mute) 12%, transparent);
		border-color: transparent;
		text-decoration: none;
	}
	a.cell.locked:hover {
		border-color: var(--text-mute);
		background: color-mix(in srgb, var(--text-mute) 20%, transparent);
		transform: none;
	}
	.team-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		font: inherit;
		width: 100%;
		text-align: left;
	}
	.team-toggle .chev {
		flex-shrink: 0;
		color: var(--text-mute);
		transition: transform 0.15s;
	}
	.team-toggle .chev.open {
		transform: rotate(90deg);
	}
	.team-member-row:hover td {
		background: var(--surface-2);
	}
	.team-detail-row td.task {
		padding-left: 40px;
	}
	.team-detail-row .task-cell .tt b {
		font-size: 13px;
		font-weight: 500;
	}
	.team-detail-row td {
		background: var(--surface-sunk);
	}
	td.day.today {
		background: color-mix(in srgb, var(--accent) 5%, transparent);
	}
	.imp td.sum {
		border-top: 1px solid var(--border);
		text-align: center;
		font-weight: 700;
		font-size: 14px;
		color: var(--text-soft);
		padding-right: 14px;
	}
	.empty-row {
		text-align: center;
		color: var(--text-mute);
		padding: 28px;
		font-size: 13.5px;
	}
	.imp tfoot td {
		border-top: 1.5px solid var(--border-strong);
		padding: 13px 8px;
		text-align: center;
		font-weight: 700;
		font-size: 13.5px;
	}
	.imp tfoot td.foot-lab {
		text-align: left;
		padding-left: 18px;
		color: var(--text-soft);
		text-transform: uppercase;
		font-size: 11px;
		letter-spacing: 0.06em;
	}
	.day-tot {
		display: inline-grid;
		place-items: center;
		min-width: 34px;
		padding: 3px 6px;
		border-radius: 8px;
	}
	.day-tot.over {
		color: var(--warn);
		background: var(--warn-tint);
	}

	.addrow {
		padding: 13px 18px;
		border-top: 1px dashed var(--border-strong);
		color: var(--text-mute);
	}

	.legend {
		display: flex;
		gap: 18px;
		align-items: center;
		margin: 16px 4px 0;
		flex-wrap: wrap;
		font-size: 12px;
		color: var(--text-mute);
	}
	.legend .warn {
		margin-left: auto;
		color: var(--warn);
	}
	.legend kbd {
		display: inline-block;
		min-width: 16px;
		padding: 1px 5px;
		border-radius: 5px;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		color: var(--text-soft);
		font-family: var(--font-ui);
		font-size: 11px;
		font-weight: 600;
		line-height: 1.4;
		text-align: center;
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
		max-width: 420px;
	}
	.modal h3 {
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
		margin-bottom: 10px;
	}
	.modal .hint {
		color: var(--text-mute);
		font-size: 13px;
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 20px;
	}
	.btn-danger {
		background: var(--danger, #c0392b);
		color: #fff;
	}
	.btn-danger:hover {
		background: color-mix(in srgb, var(--danger, #c0392b) 88%, black);
	}

	@media (max-width: 720px) {
		.summary {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (max-width: 420px) {
		.summary {
			grid-template-columns: 1fr;
		}
	}
</style>
