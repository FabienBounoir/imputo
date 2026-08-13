<script lang="ts">
	import { enhance, deserialize } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page, navigating } from '$app/state';
	import { formatDateTime } from '$lib/utils/date';
	import { TICKET_FIELD_LABELS } from '$lib/changeLogLabels';
	import { confirmDialog } from '$lib/confirm.svelte';
	import ModalErrorToast from '$lib/components/ModalErrorToast.svelte';
	let { data, form } = $props();

	let showCreate = $state(false);
	let savedFlash = $state(false);
	let flashTimer: ReturnType<typeof setTimeout>;

	// Ouverture directe du formulaire depuis la palette de commandes (?new=1).
	$effect(() => {
		if (page.url.searchParams.get('new') === '1') showCreate = true;
	});
	function autofocus(node: HTMLInputElement) {
		node.focus();
	}

	// Anti-rafale pour les champs numériques à spinner (flèches/molette) : chaque clic déclenche un
	// onchange, donc sans ça une simple ligne d'historique par champ devient une ligne par pas — on
	// attend que ça se stabilise avant d'enregistrer (et donc de tracer un seul changement net).
	const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
	function debouncedSave(key: string, fn: () => void, delay = 600) {
		clearTimeout(pendingSaves.get(key));
		pendingSaves.set(
			key,
			setTimeout(() => {
				pendingSaves.delete(key);
				fn();
			}, delay)
		);
	}

	// Filtres/vue/pagination pilotés par l'URL (le serveur filtre + pagine désormais — cf. retour
	// utilisateur : tout charger d'un coup devient lourd quand l'espace a beaucoup de tickets).
	// `queryInput` reste local pour ne pas déclencher une requête à chaque frappe (debounce).
	let queryInput = $state(data.filters.query ?? '');
	$effect(() => {
		queryInput = data.filters.query ?? '';
	});
	let searchDebounce: ReturnType<typeof setTimeout>;
	function onSearchInput() {
		clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => navigateWith({ q: queryInput }), 350);
	}
	function navigateWith(partial: Record<string, string>) {
		const merged: Record<string, string> = {
			q: data.filters.query ?? '',
			state: data.filters.stateId ?? '',
			project: data.filters.projectId ?? '',
			sprint: data.filters.sprintId ?? '',
			version: data.filters.versionId ?? '',
			view: data.view,
			page: '1', // tout changement de filtre/vue revient en page 1 (sauf override explicite)
			...partial
		};
		const p = new URLSearchParams();
		for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
		goto(`?${p.toString()}`, { keepFocus: true, noScroll: true });
	}
	// exactKey : arrivée via un lien direct depuis un dashboard sprint/version (?ticket=…) — sans
	// ça le bouton Réinitialiser reste invisible et on ne peut plus revenir à la liste complète.
	const hasFilters = $derived(!!(data.filters.query || data.filters.stateId || data.filters.projectId || data.filters.sprintId || data.filters.versionId || data.filters.exactKey));
	// Filtres/vue/pagination naviguent tous via goto() (rechargement serveur) : un fieldset désactive
	// la barre d'un coup pendant le trajet, pour qu'on ne confonde jamais l'ancienne liste avec la nouvelle.
	const isNavigating = $derived(!!navigating.to);
	function resetFilters() {
		navigateWith({ q: '', state: '', project: '', sprint: '', version: '' });
	}

	type Row = {
		id: string;
		key: string;
		title: string;
		isChild: boolean;
		stateId: string | null;
		projectId: string | null;
		sprintId: string | null;
		versionId: string | null;
		prepa: number;
		comment: string | null;
		flags: Record<string, string>;
		estimationReal: number;
		raeReal: number;
		estimationTest: number;
		raeTest: number;
		consumed: number;
		sspCode: string | null;
		estimationPrev: number | null;
		enveloppeTotale: number | null;
		hasActivityEstimation: boolean;
		groupIds: string[];
		activityBreakdown: ActivityBreakdownRow[];
	};

	type ActivityBreakdownRow = {
		activityId: string;
		label: string;
		raeReal: number;
		raeTest: number;
		estimation: number;
		budget: number;
		contributors: { userId: string; displayName: string; consumed: number }[];
	};

	const FLAG_VALUES = ['Oui', 'Non', 'N/A', 'À MAJ', 'MAJ', 'OK'];
	const FLAG_FIELDS = [
		{ key: 'cypress', label: 'Cypress' },
		{ key: 'docTech', label: 'Doc technique' },
		{ key: 'prepaQualif', label: 'Prépa qualif' }
	] as const;

	// data.ticketsPage est streamé (non-awaité côté serveur, cf. +page.server.ts) : le shell (filtres,
	// chrome) s'affiche tout de suite, rows/total/pageCount arrivent dès que la requête résout —
	// `ticketsLoading` distingue ce vrai chargement du cas "0 résultat" pour le rendu (skeleton vs
	// message vide, cf. plus bas).
	let rows = $state<Row[]>([]);
	let total = $state(0);
	let pageCount = $state(1);
	let ticketsLoading = $state(true);
	const colCount = $derived(7 + (data.testPhase ? 2 : 0) + (data.isAdmin ? 2 : 0));

	// Chiffrage : verrouillé pour un USER standard (retour utilisateur). Le RAE d'une activité reste
	// éditable par ses contributeurs — `contributors` est déjà chargé, aucun appel supplémentaire.
	// Le serveur applique la même règle (canEditActivityRae), ceci n'est que l'affordance visuelle.
	const estTitle = $derived(
		data.canEditEstimation ? '' : "Estimation réservée aux profils Manager et Admin."
	);
	const RAE_LOCKED = 'RAE réservé aux personnes ayant imputé sur cette activité.';
	// Doit rester synchronisé avec NO_ACTIVITY_ID dans $lib/server/services/tickets.ts (pas de
	// ticket_activity_rae possible pour ce bucket synthétique : rien à éditer ici, jamais un vrai id).
	const NO_ACTIVITY_ID = '__no_activity__';
	const NO_ACTIVITY_HINT = "Regroupe les imputations sans activité renseignée — pas d'activité réelle à éditer ici.";
	function canEditRae(ar: { contributors: { userId: string }[] }) {
		return data.canEditEstimation || ar.contributors.some((c) => c.userId === data.selfId);
	}

	// RAE/Estimé/Budget par activité : lignes fines toujours visibles sous le ticket (plus de
	// collapse/fetch à l'ouverture — le détail arrive déjà avec chaque ticket, cf. data.ticketsPage).
	async function saveActivityField(
		row: Row,
		activityId: string,
		field: 'raeReal' | 'raeTest' | 'estimation' | 'budget',
		value: number
	) {
		const res = await fetch(`/api/tickets/${row.id}/activity-rae`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ activityId, field, value })
		});
		if (!res.ok) return;
		row.activityBreakdown = (await res.json()).rows;
		// RAE Réal/Test et Estimé global = compilation des activités (jamais saisis à la main).
		if (row.activityBreakdown.length > 0) {
			row.raeReal = round(row.activityBreakdown.reduce((s, a) => s + a.raeReal, 0));
			row.raeTest = round(row.activityBreakdown.reduce((s, a) => s + a.raeTest, 0));
			row.estimationReal = round(row.activityBreakdown.reduce((s, a) => s + a.estimation, 0));
			row.hasActivityEstimation = true;
		}
		flash();
	}
	function toRow(t: Awaited<typeof data.ticketsPage>['tickets'][number]): Row {
		return {
			id: t.id,
			key: t.key,
			title: t.title,
			isChild: t.isChild,
			stateId: t.stateId,
			projectId: t.projectId,
			sprintId: t.sprintId,
			versionId: t.versionId,
			prepa: t.prepa,
			comment: t.comment,
			flags: { ...t.flags },
			estimationReal: t.estimationReal,
			raeReal: t.raeReal,
			estimationTest: t.estimationTest,
			raeTest: t.raeTest,
			consumed: t.consumed,
			sspCode: t.sspCode,
			estimationPrev: t.estimationPrev,
			enveloppeTotale: t.enveloppeTotale,
			hasActivityEstimation: t.hasActivityEstimation,
			groupIds: [...t.groupIds],
			activityBreakdown: t.activityBreakdown.map((a) => ({ ...a, contributors: [...a.contributors] }))
		};
	}

	// Scroll infini (retour utilisateur : les boutons de pagination sont remplacés par un
	// chargement automatique des pages suivantes). `loadedPage`/`hasMore` sont locaux car on
	// ajoute des tickets sans re-déclencher le load serveur (qui, lui, repart toujours en page 1).
	let loadedPage = $state(data.page);
	let hasMore = $state(false);
	let loadingMore = $state(false);
	let sentinel = $state<HTMLElement | null>(null);

	// (Re)synchronise quand les données serveur changent (filtre, vue, recherche, arrivée sur la page)
	// — `data.ticketsPage` est une nouvelle promesse à chaque nouveau `load`, ce qui redéclenche cet
	// effet. `cancelled` évite qu'une réponse en retard (navigation encore plus récente) écrase des
	// données déjà à jour.
	$effect(() => {
		ticketsLoading = true;
		let cancelled = false;
		data.ticketsPage.then((r) => {
			if (cancelled) return;
			rows = r.tickets.map(toRow);
			total = r.total;
			pageCount = r.pageCount;
			loadedPage = data.page;
			hasMore = data.view === 'table' && data.page < r.pageCount;
			ticketsLoading = false;
		});
		return () => {
			cancelled = true;
		};
	});

	async function loadMore() {
		if (loadingMore || !hasMore) return;
		loadingMore = true;
		try {
			const p = new URLSearchParams();
			if (data.filters.query) p.set('q', data.filters.query);
			if (data.filters.stateId) p.set('state', data.filters.stateId);
			if (data.filters.projectId) p.set('project', data.filters.projectId);
			if (data.filters.sprintId) p.set('sprint', data.filters.sprintId);
			if (data.filters.versionId) p.set('version', data.filters.versionId);
			p.set('page', String(loadedPage + 1));
			const res = await fetch(`/api/tickets?${p}`);
			if (!res.ok) return;
			const d = await res.json();
			rows = [...rows, ...d.tickets.map(toRow)];
			loadedPage = d.page;
			hasMore = d.page < d.pageCount;
		} finally {
			loadingMore = false;
		}
	}

	$effect(() => {
		if (!sentinel || data.view !== 'table') return;
		const obs = new IntersectionObserver((es) => {
			if (es[0].isIntersecting) loadMore();
		});
		obs.observe(sentinel);
		return () => obs.disconnect();
	});

	// Arrivée depuis l'imputation (clic sur le sprint/version d'une ligne, cf. ?highlight=) :
	// amène le ticket d'origine dans le viewport, la surbrillance elle-même est en CSS pur.
	$effect(() => {
		if (!data.highlightKey) return;
		const row = rows.find((r) => r.key === data.highlightKey);
		if (row) document.getElementById(`ticket-${row.id}`)?.scrollIntoView({ block: 'center' });
	});

	const stateById = $derived(new Map(data.ref.states.map((s) => [s.id, s])));

	// --- calculs dérivés (mêmes formules que le serveur) ---
	const n = (v: number | string | null) => (v == null || v === '' ? 0 : Number(v) || 0);
	const round = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
	const totalEst = (r: Row) => round(n(r.estimationReal) + (data.testPhase ? n(r.estimationTest) : 0));
	const totalRae = (r: Row) => round(n(r.raeReal) + (data.testPhase ? n(r.raeTest) : 0));
	// Écarts : Réel uniquement, jamais Test (cf. calc.ts:ecartVsEstime/ecartVsBudget côté serveur).
	const ecartVsEstime = (r: Row) => round(n(r.raeReal) + r.consumed - n(r.estimationReal));
	const ecartVsBudget = (r: Row) => (r.enveloppeTotale == null ? null : round(n(r.raeReal) + r.consumed - r.enveloppeTotale));
	// Sans estimation : 100 % si du temps est consommé et qu'il ne reste rien à faire (RAE nul),
	// plutôt que 0 % qui laissait croire à un ticket non démarré — même règle que calc.ts:avancement.
	const avancement = (r: Row) => {
		const te = totalEst(r);
		const tr = totalRae(r);
		if (te <= 0) return tr <= 0 && r.consumed > 0 ? 1 : 0;
		return Math.min(1, Math.max(0, (te - tr) / te));
	};
	const raeSugg = (r: Row) => round(Math.max(0, totalEst(r) - r.consumed));
	const pct = (x: number) => Math.round(x * 100);

	// --- Vue Kanban --- (data.view piloté par l'URL — le serveur charge le board complet non
	// paginé dans ce mode, cf. +page.server.ts)
	let dragId = $state<string | null>(null);
	// Modal d'édition (ouverte au clic sur une carte Kanban).
	let editId = $state<string | null>(null);
	const editRow = $derived(rows.find((r) => r.id === editId) ?? null);
	let actionError = $state('');
	$effect(() => {
		editId;
		actionError = '';
	});

	// Suppression réservée au créateur de l'espace (super admin, cf. data.isOwner). `rows` n'a pas le
	// nombre d'imputations liées (pas ajouté à listTicketsPage pour ne pas alourdir le chargement de
	// toute la liste) — on le vérifie à la demande, seulement au moment de supprimer.
	async function confirmDeleteTicket(row: Row, { cancel }: { cancel: () => void }) {
		actionError = '';
		const res = await fetch(`/api/tickets/${row.id}`);
		const t = res.ok ? await res.json() : null;
		if (!t || t.imputationCount > 0) {
			actionError = t ? 'Des imputations sont liées à ce ticket : suppression impossible.' : 'Erreur lors de la vérification.';
			return cancel();
		}
		const ok = await confirmDialog({
			title: 'Supprimer le ticket',
			message: `Supprimer définitivement ${row.key} — « ${row.title} » ? Cette action est irréversible.`,
			confirmLabel: 'Supprimer'
		});
		if (!ok) return cancel();
		return async ({ result }: { result: { type: string; data?: Record<string, unknown> } }) => {
			if (result.type === 'failure') {
				actionError = (result.data?.error as string) ?? 'Erreur lors de la suppression.';
			} else {
				rows = rows.filter((r) => r.id !== row.id);
				editId = null;
			}
		};
	}

	// Historique (champs budget/estimation) — chargé à la demande à l'ouverture de la modal, pas
	// avec la liste des tickets (rarement consulté, autant ne pas alourdir le chargement initial).
	type HistoryEntry = {
		field: string | null;
		action: 'UPDATE' | 'DELETE';
		oldValue: string | null;
		newValue: string | null;
		changedByName: string | null;
		createdAt: string;
	};
	let historyEntries = $state<HistoryEntry[]>([]);
	let historyLoading = $state(false);
	$effect(() => {
		if (!editId) {
			historyEntries = [];
			return;
		}
		historyLoading = true;
		fetch(`/api/tickets/${editId}/history`)
			.then((r) => (r.ok ? r.json() : { entries: [] }))
			.then((d) => (historyEntries = d.entries))
			.finally(() => (historyLoading = false));
	});
	const kanbanCols = $derived([
		...data.ref.states.map((s) => ({
			id: s.id as string | null,
			label: s.label,
			emoji: s.emoji,
			color: s.color
		})),
		{ id: null as string | null, label: 'Sans état', emoji: '∅', color: null as string | null }
	]);
	const colTickets = (id: string | null) => rows.filter((t) => t.stateId === id);
	function onColumnDrop(stateId: string | null) {
		const r = rows.find((x) => x.id === dragId);
		dragId = null;
		stopAutoScroll();
		if (!r || r.stateId === stateId) return;
		r.stateId = stateId; // optimiste
		save(r, 'stateId', stateId);
	}

	// Auto-scroll horizontal du board quand on drague une carte près d'un bord.
	let kanbanEl = $state<HTMLElement | null>(null);
	let scrollDir = 0;
	let rafId = 0;
	const EDGE = 90; // zone sensible (px) à gauche/droite
	const SPEED = 18; // px par frame
	function autoScrollStep() {
		if (scrollDir !== 0 && kanbanEl) {
			kanbanEl.scrollLeft += scrollDir * SPEED;
			rafId = requestAnimationFrame(autoScrollStep);
		} else {
			rafId = 0;
		}
	}
	function onKanbanDragOver(e: DragEvent) {
		e.preventDefault();
		if (!kanbanEl) return;
		const r = kanbanEl.getBoundingClientRect();
		if (e.clientX < r.left + EDGE) scrollDir = -1;
		else if (e.clientX > r.right - EDGE) scrollDir = 1;
		else scrollDir = 0;
		if (scrollDir !== 0 && !rafId) rafId = requestAnimationFrame(autoScrollStep);
	}
	function stopAutoScroll() {
		scrollDir = 0;
		if (rafId) {
			cancelAnimationFrame(rafId);
			rafId = 0;
		}
	}

	async function save(row: Row, field: string, value: string | number | null) {
		const body = new FormData();
		body.set('ticketId', row.id);
		body.set('field', field);
		body.set('value', value == null ? '' : String(value));
		const res = await fetch('?/update', { method: 'POST', body });
		const result = deserialize(await res.text());
		if (result.type === 'failure') {
			actionError = (result.data?.error as string) ?? 'Erreur lors de l’enregistrement.';
		} else {
			flash();
		}
	}
	// Saisie d'une estimation : pré-remplit le RAE correspondant s'il est encore vide
	// (sinon un ticket estimé mais sans RAE afficherait 100 % d'avancement).
	async function saveEst(row: Row, which: 'real' | 'test') {
		if (which === 'real') {
			await save(row, 'estimationReal', row.estimationReal);
			if (!row.raeReal) {
				row.raeReal = row.estimationReal;
				await save(row, 'raeReal', row.raeReal);
			}
		} else {
			await save(row, 'estimationTest', row.estimationTest);
			if (!row.raeTest) {
				row.raeTest = row.estimationTest;
				await save(row, 'raeTest', row.raeTest);
			}
		}
	}
	async function saveFlag(row: Row, key: string, value: string) {
		const body = new FormData();
		body.set('ticketId', row.id);
		body.set('key', key);
		body.set('value', value ?? '');
		await fetch('?/flag', { method: 'POST', body });
		flash();
	}
	async function toggleGroup(row: Row, groupId: string) {
		const member = !row.groupIds.includes(groupId);
		row.groupIds = member ? [...row.groupIds, groupId] : row.groupIds.filter((g) => g !== groupId);
		const body = new FormData();
		body.set('ticketId', row.id);
		body.set('groupId', groupId);
		body.set('member', String(member));
		await fetch('?/groupToggle', { method: 'POST', body });
		flash();
	}
	function flash() {
		savedFlash = true;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (savedFlash = false), 1400);
	}
</script>

<div class="topbar">
	<h1>Tickets &amp; chiffrage<small>{ticketsLoading ? 'Chargement…' : `${total} ticket${total > 1 ? 's' : ''}${data.view === 'table' && rows.length < total ? ` · ${rows.length} chargés` : ''}`} · édition directe</small></h1>
	<div class="spacer"></div>
	{#if savedFlash}<span class="saved">Enregistré ✓</span>{/if}
	<a class="btn btn-ghost" href="/export" data-sveltekit-reload>
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="3" width="12" height="8" rx="1.5"/><path d="M12 17v-6M9 14l3 3 3-3"/><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/></svg>
		Exporter Excel
	</a>
	<button class="btn btn-primary" onclick={() => (showCreate = !showCreate)}>
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>
		Nouveau ticket
	</button>
</div>

<div class="content">
	{#if form?.error}<div class="flash error">{form.error}</div>{/if}

	{#if showCreate}
		<div class="card create">
			<form method="POST" action="?/create" use:enhance={() => async ({ update }) => { await update(); showCreate = false; }}>
				<div class="grid2">
					<div class="field"><label for="key">Clé</label><input id="key" name="key" placeholder="BLM-1234" use:autofocus required /></div>
					<div class="field"><label for="title">Titre</label><input id="title" name="title" placeholder="Intitulé du ticket" required /></div>
				</div>
				<div class="grid4">
					<div class="field"><label for="project">Projet</label>
						<select id="project" name="projectId"><option value="">—</option>{#each data.ref.projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select>
					</div>
					<div class="field"><label for="sprint">Sprint</label>
						<select id="sprint" name="sprintId"><option value="">—</option>{#each data.ref.sprints as s (s.id)}<option value={s.id}>{s.name}</option>{/each}</select>
					</div>
					<div class="field"><label for="version">Version</label>
						<select id="version" name="versionId"><option value="">—</option>{#each data.ref.versions as v (v.id)}<option value={v.id}>{v.name}</option>{/each}</select>
					</div>
					<div class="field"><label for="state">État</label>
						<select id="state" name="stateId"><option value="">—</option>{#each data.ref.states as s (s.id)}<option value={s.id}>{s.emoji} {s.label}</option>{/each}</select>
					</div>
				</div>
				{#if data.canEditEstimation}
					<div class="grid2">
						<div class="field"><label for="er">Estimé</label><input id="er" name="estimationReal" type="number" step="0.25" min="0" /></div>
						{#if data.testPhase}<div class="field"><label for="et">Est. Test</label><input id="et" name="estimationTest" type="number" step="0.25" min="0" /></div>{/if}
					</div>
				{/if}
				<div class="grid2">
					<div class="field"><label for="ssp">Code SSP</label><input id="ssp" name="sspCode" /></div>
					{#if data.isAdmin}<div class="field"><label for="eprev">Estimation prévisionnel</label><input id="eprev" name="estimationPrev" type="number" step="0.25" min="0" /></div>{/if}
				</div>
				{#if data.isAdmin}
					<div class="grid2">
						<div class="field"><label for="env">Enveloppe totale</label><input id="env" name="enveloppeTotale" type="number" step="0.25" min="0" /></div>
					</div>
				{/if}
				<div class="actions-row">
					<button type="button" class="btn btn-ghost" onclick={() => (showCreate = false)}>Annuler</button>
					<button type="submit" class="btn btn-primary">Créer</button>
				</div>
			</form>
		</div>
	{/if}

	<div class="filters">
		<!-- Recherche exclue du fieldset : elle reste tapable pendant qu'une frappe précédente
		     est encore en vol (le goto suivant, debouncé, remplace l'ancien de toute façon). -->
		<fieldset class="filter-fields" disabled={isNavigating}>
			<div class="seg2">
				<button class:on={data.view === 'table'} onclick={() => navigateWith({ view: 'table' })}>Tableau</button>
				<button class:on={data.view === 'kanban'} onclick={() => navigateWith({ view: 'kanban' })}>Kanban</button>
			</div>
			<select class="filter-sel" value={data.filters.stateId ?? ''} onchange={(e) => navigateWith({ state: e.currentTarget.value })} aria-label="Filtrer par état">
				<option value="">Tous les états</option>
				{#each data.ref.states as s (s.id)}<option value={s.id}>{s.emoji} {s.label}</option>{/each}
			</select>
			<select class="filter-sel" value={data.filters.projectId ?? ''} onchange={(e) => navigateWith({ project: e.currentTarget.value })} aria-label="Filtrer par projet">
				<option value="">Tous les projets</option>
				{#each data.ref.projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
			<select class="filter-sel" value={data.filters.sprintId ?? ''} onchange={(e) => navigateWith({ sprint: e.currentTarget.value })} aria-label="Filtrer par sprint">
				<option value="">Tous les sprints</option>
				{#each data.ref.sprints as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
			</select>
			<select class="filter-sel" value={data.filters.versionId ?? ''} onchange={(e) => navigateWith({ version: e.currentTarget.value })} aria-label="Filtrer par version">
				<option value="">Toutes les versions</option>
				{#each data.ref.versions as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
			</select>
			{#if hasFilters}
				<button class="reset-btn" onclick={resetFilters}>✕ Réinitialiser</button>
			{/if}
		</fieldset>
		{#if hasFilters && !ticketsLoading}<span class="count">{total} résultat{total > 1 ? 's' : ''}</span>{/if}
		{#if isNavigating}<span class="loading-hint">Chargement…</span>{/if}
		<div class="search">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
			<!-- svelte-ignore a11y_autofocus -->
			<input placeholder="Rechercher une US…" bind:value={queryInput} oninput={onSearchInput} autofocus />
		</div>
	</div>

	{#if data.view === 'table'}
	{#snippet skeletonRow()}
		<tr class="ticket-row skeleton-row">
			<td><div class="cell-select state-select skeleton-bar" style="height:16px;"></div></td>
			<td class="ttl">
				<div class="ttl-wrap">
					<div class="skeleton-bar" style="width:22px;height:22px;border-radius:6px;flex-shrink:0;"></div>
					<div class="ttl-main">
						<div class="skeleton-bar" style="width:44px;height:8px;margin:4px 0 6px 7px;border-radius:4px;"></div>
						<!-- largeur en px, pas % : le tableau est en table-layout:auto, un % ne compte pas
						     dans le calcul de la largeur de colonne et donnait une barre minuscule. -->
						<div class="cell-input title-input skeleton-bar" style="width:240px;height:16px;"></div>
					</div>
				</div>
			</td>
			{#if data.isAdmin}<td class="num"><div class="cell-input num-input skeleton-bar" style="height:16px;"></div></td>{/if}
			<td class="num"><div class="cell-input num-input skeleton-bar" style="height:16px;"></div></td>
			<td class="num"><div class="cell-input num-input skeleton-bar" style="height:16px;"></div></td>
			{#if data.testPhase}
				<td class="num"><div class="cell-input num-input skeleton-bar" style="height:16px;"></div></td>
				<td class="num"><div class="cell-input num-input skeleton-bar" style="height:16px;"></div></td>
			{/if}
			<td class="num tabnum"><div class="skeleton-bar" style="width:32px;height:13px;margin-left:auto;border-radius:4px;"></div></td>
			{#if data.isAdmin}<td class="num"><div class="skeleton-bar" style="width:40px;height:13px;margin-left:auto;border-radius:4px;"></div></td>{/if}
			<td class="num"><div class="skeleton-bar" style="width:40px;height:13px;margin-left:auto;border-radius:4px;"></div></td>
			<td>
				<div class="prog">
					<div class="bar skeleton-bar"></div>
					<span class="skeleton-bar" style="width:28px;height:12px;border-radius:4px;"></span>
				</div>
			</td>
		</tr>
	{/snippet}
	<div class="card tk-card">
	<div class="tk-scroll">
		<table class="tk">
			<thead>
				<tr>
					<th style="width:170px;">État</th><th>Ticket</th>
					{#if data.isAdmin}<th class="num">Budget</th>{/if}
					<th class="num">Estimé</th><th class="num">RAE Réal</th>
					{#if data.testPhase}<th class="num">Est. Test</th><th class="num">RAE Test</th>{/if}<th class="num">Conso.</th>
					{#if data.isAdmin}<th class="num" title="Écart vs budget : RAE Réel + consommé − Budget">Écart vs budget</th>{/if}
					<th class="num" title="Écart vs estimé : RAE Réel + consommé − Estimé">Écart vs estimé</th><th class="num" style="width:130px;">Avancement</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.id)}
					{@const st = r.stateId ? stateById.get(r.stateId) : null}
					<tr class="ticket-row" id="ticket-{r.id}" class:highlighted={r.key === data.highlightKey}>
						<td>
							<select
								class="cell-select state-select"
								style={st?.color ? `color:${st.color};font-weight:600;` : ''}
								bind:value={r.stateId}
								onchange={() => save(r, 'stateId', r.stateId)}
							>
								<option value={null}>—</option>
								{#each data.ref.states as s (s.id)}<option value={s.id}>{s.emoji} {s.label}</option>{/each}
							</select>
						</td>
						<td class="ttl" class:sub={r.isChild}>
							<div class="ttl-wrap">
								<button class="expand-btn" onclick={() => (editId = r.id)} aria-label="Voir le détail du ticket">
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
							</button>
								<div class="ttl-main">
									<div class="key tabnum">{r.key}</div>
									<input class="cell-input title-input" bind:value={r.title} onchange={() => save(r, 'title', r.title)} />
								</div>
							</div>
						</td>
						{#if data.isAdmin}
							<td class="num">
								<input
									class="cell-input num-input"
									type="number"
									step="0.25"
									min="0"
									bind:value={r.enveloppeTotale}
									onchange={() => debouncedSave(`env-${r.id}`, () => save(r, 'enveloppeTotale', r.enveloppeTotale))}
								/>
							</td>
						{/if}
						<td class="num">
							<input
								class="cell-input num-input"
								type="number"
								step="0.25"
								min="0"
								bind:value={r.estimationReal}
								disabled={!data.canEditEstimation || r.hasActivityEstimation}
								title={r.hasActivityEstimation ? "Estimé = compilation des Estimés par activité ci-dessous (non éditable ici)" : estTitle}
								onchange={() => debouncedSave(`est-${r.id}-real`, () => saveEst(r, 'real'))}
							/>
						</td>
						<td class="num">
							<input
								class="cell-input num-input"
								type="number"
								step="0.25"
								min="0"
								value={r.raeReal}
								disabled
								title="RAE Réal = compilation des RAE par activité ci-dessous (non éditable ici)"
							/>
						</td>
						{#if data.testPhase}
							<td class="num"><input class="cell-input num-input" type="number" step="0.25" min="0" bind:value={r.estimationTest} disabled={!data.canEditEstimation} title={estTitle} onchange={() => debouncedSave(`est-${r.id}-test`, () => saveEst(r, 'test'))} /></td>
							<td class="num"><input class="cell-input num-input" type="number" step="0.25" min="0" value={r.raeTest} disabled title="RAE Test = compilation des RAE par activité ci-dessous (non éditable ici)" /></td>
						{/if}
						<td class="num tabnum consumed">{r.consumed || '—'}</td>
						{#if data.isAdmin}
							<td class="num tabnum" class:gap-pos={(ecartVsBudget(r) ?? 0) > 0} class:gap-neg={(ecartVsBudget(r) ?? 0) < 0}>{ecartVsBudget(r) == null ? '—' : `${ecartVsBudget(r)! > 0 ? '+' : ''}${ecartVsBudget(r) || 0}`}</td>
						{/if}
						<td class="num tabnum" class:gap-pos={ecartVsEstime(r) > 0} class:gap-neg={ecartVsEstime(r) < 0}>{ecartVsEstime(r) > 0 ? '+' : ''}{ecartVsEstime(r) || 0}</td>
						<td>
							<div class="prog">
								<div class="bar"><i style="width:{pct(avancement(r))}%"></i></div>
								<span class="pct tabnum">{pct(avancement(r))}%</span>
							</div>
						</td>
					</tr>
					{#each r.activityBreakdown as ar (ar.activityId)}
						{@const canRae = canEditRae(ar)}
						{@const isOther = ar.activityId === NO_ACTIVITY_ID}
						<tr class="activity-subrow">
							<td></td>
							<td class="ar-name">↳ {ar.label}
								{#if ar.contributors.length > 0}
									<span class="ar-contrib">{#each ar.contributors as c, i (c.userId)}{i > 0 ? ', ' : ''}{c.displayName} <b class="tabnum">{c.consumed}</b>j{/each}</span>
								{/if}
							</td>
							{#if data.isAdmin}
								<td class="num">
									{#if isOther}
										<span class="cell-readonly" title={NO_ACTIVITY_HINT}>—</span>
									{:else}
										<input
											class="cell-input num-input"
											type="number"
											step="0.25"
											min="0"
											value={ar.budget}
											disabled={!data.isStrictAdmin}
											title={data.isStrictAdmin ? '' : 'Budget par activité réservé aux administrateurs.'}
											onchange={(e) => {
												const value = Number(e.currentTarget.value) || 0;
												debouncedSave(`ar-${r.id}-${ar.activityId}-budget`, () => saveActivityField(r, ar.activityId, 'budget', value));
											}}
										/>
									{/if}
								</td>
							{/if}
							<td class="num">
								{#if isOther}
									<span class="cell-readonly" title={NO_ACTIVITY_HINT}>—</span>
								{:else}
									<input
										class="cell-input num-input"
										type="number"
										step="0.25"
										min="0"
										value={ar.estimation}
										onchange={(e) => {
											const value = Number(e.currentTarget.value) || 0;
											debouncedSave(`ar-${r.id}-${ar.activityId}-estimation`, () => saveActivityField(r, ar.activityId, 'estimation', value));
										}}
									/>
								{/if}
							</td>
							<td class="num">
								{#if isOther}
									<span class="cell-readonly" title={NO_ACTIVITY_HINT}>—</span>
								{:else}
									<input
										class="cell-input num-input"
										type="number"
										step="0.25"
										min="0"
										value={ar.raeReal}
										disabled={!canRae}
										title={canRae ? '' : RAE_LOCKED}
										onchange={(e) => {
											const value = Number(e.currentTarget.value) || 0;
											debouncedSave(`ar-${r.id}-${ar.activityId}-raeReal`, () => saveActivityField(r, ar.activityId, 'raeReal', value));
										}}
									/>
								{/if}
							</td>
							{#if data.testPhase}
								<td></td>
								<td class="num">
									{#if isOther}
										<span class="cell-readonly" title={NO_ACTIVITY_HINT}>—</span>
									{:else}
										<input
											class="cell-input num-input"
											type="number"
											step="0.25"
											min="0"
											value={ar.raeTest}
											disabled={!canRae}
											title={canRae ? '' : RAE_LOCKED}
											onchange={(e) => {
											const value = Number(e.currentTarget.value) || 0;
											debouncedSave(`ar-${r.id}-${ar.activityId}-raeTest`, () => saveActivityField(r, ar.activityId, 'raeTest', value));
										}}
										/>
									{/if}
								</td>
							{/if}
							<td class="num tabnum consumed">{round(ar.contributors.reduce((s, c) => s + c.consumed, 0)) || '—'}</td>
							{#if data.isAdmin}<td></td>{/if}
							<td></td>
							<td></td>
						</tr>
					{/each}
				{/each}
				{#if loadingMore}
					{#each { length: 4 } as _, i (i)}
						{@render skeletonRow()}
					{/each}
				{/if}
				{#if rows.length === 0}
					{#if isNavigating || ticketsLoading}
						{#each { length: 8 } as _, i (i)}
							{@render skeletonRow()}
						{/each}
					{:else}
						<tr><td colspan={colCount} class="empty-row">Aucun ticket. Créez-en un pour démarrer.</td></tr>
					{/if}
				{/if}
			</tbody>
		</table>
	</div>
		{#if hasMore}
			<div class="pager" bind:this={sentinel}></div>
		{/if}
	</div>
	{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="kanban" bind:this={kanbanEl} ondragover={onKanbanDragOver}>
		{#each kanbanCols as col (col.id ?? 'none')}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="kcol" ondragover={(e) => e.preventDefault()} ondrop={() => onColumnDrop(col.id)}>
				<div class="kcol-head">
					<span class="kdot" style={col.color ? `background:${col.color}` : 'background:var(--text-mute)'}></span>
					<span class="klabel">{col.emoji ?? ''} {col.label}</span>
					<span class="kcount">{colTickets(col.id).length}</span>
				</div>
				<div class="kcards">
					{#each colTickets(col.id) as t (t.id)}
						<div
							class="kcard"
							class:dragging={dragId === t.id}
							draggable="true"
							role="button"
							tabindex="0"
							ondragstart={() => (dragId = t.id)}
							ondragend={() => {
								dragId = null;
								stopAutoScroll();
							}}
							onclick={() => (editId = t.id)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									editId = t.id;
								}
							}}
						>
							<div class="kkey tabnum">{t.key}</div>
							<div class="ktitle">{t.title}</div>
							<div class="kmeta">
								<span class="kbar"><i style="width:{pct(avancement(t))}%"></i></span>
								<span class="kpct tabnum">{pct(avancement(t))}%</span>
							</div>
						</div>
					{/each}
					{#if ticketsLoading}<div class="kempty">Chargement…</div>{:else if colTickets(col.id).length === 0}<div class="kempty">Aucun ticket</div>{/if}
				</div>
			</div>
		{/each}
	</div>
	{/if}
</div>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (editId = null)} />

{#if actionError}<ModalErrorToast message={actionError} />{/if}

{#if editRow}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="tk-backdrop" onclick={(e) => { if (e.target === e.currentTarget) editId = null; }}>
		<div class="tk-modal">
			<div class="tk-modal-head">
				{#if data.isOwner}
					<input class="tk-key-input tabnum" bind:value={editRow.key} onchange={() => save(editRow!, 'key', editRow!.key)} aria-label="Clé du ticket" />
				{:else}
					<span class="tk-key tabnum">{editRow.key}</span>
				{/if}
				<button class="tk-x" onclick={() => (editId = null)} aria-label="Fermer">✕</button>
			</div>
			<input class="tk-title" bind:value={editRow.title} onchange={() => save(editRow!, 'title', editRow!.title)} aria-label="Titre" />
			<div class="tk-grid">
				<label class="dfield"><span>État</span>
					<select class="cell-select" bind:value={editRow.stateId} onchange={() => save(editRow!, 'stateId', editRow!.stateId)}>
						<option value={null}>—</option>{#each data.ref.states as s (s.id)}<option value={s.id}>{s.emoji} {s.label}</option>{/each}
					</select>
				</label>
				<label class="dfield"><span>Projet</span>
					<select class="cell-select" bind:value={editRow.projectId} onchange={() => save(editRow!, 'projectId', editRow!.projectId)}>
						<option value={null}>—</option>{#each data.ref.projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</select>
				</label>
				<label class="dfield"><span>Sprint</span>
					<select class="cell-select" bind:value={editRow.sprintId} onchange={() => save(editRow!, 'sprintId', editRow!.sprintId)}>
						<option value={null}>—</option>{#each data.ref.sprints as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
					</select>
				</label>
				<label class="dfield"><span>Version</span>
					<select class="cell-select" bind:value={editRow.versionId} onchange={() => save(editRow!, 'versionId', editRow!.versionId)}>
						<option value={null}>—</option>{#each data.ref.versions as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
					</select>
				</label>
				<label class="dfield"><span>Estimé</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={editRow.estimationReal} disabled={!data.canEditEstimation || editRow.hasActivityEstimation} title={editRow.hasActivityEstimation ? "Estimé = compilation des Estimés par activité ci-dessous (non éditable ici)" : estTitle} onchange={() => debouncedSave(`est-${editRow!.id}-real`, () => saveEst(editRow!, 'real'))} /></label>
				<label class="dfield"><span>RAE Réal</span><input class="cell-input" type="number" step="0.25" min="0" value={editRow.raeReal} disabled title="Compilation des RAE par activité (voir le tableau)" /></label>
				{#if data.testPhase}
					<label class="dfield"><span>Est. Test</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={editRow.estimationTest} disabled={!data.canEditEstimation} title={estTitle} onchange={() => debouncedSave(`est-${editRow!.id}-test`, () => saveEst(editRow!, 'test'))} /></label>
					<label class="dfield"><span>Prépa</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={editRow.prepa} disabled={!data.canEditEstimation} title={estTitle} onchange={() => debouncedSave(`f-${editRow!.id}-prepa`, () => save(editRow!, 'prepa', editRow!.prepa))} /></label>
					<label class="dfield"><span>RAE Test</span><input class="cell-input" type="number" step="0.25" min="0" value={editRow.raeTest} disabled title="Compilation des RAE par activité (voir le tableau)" /></label>
					{#each FLAG_FIELDS as fl (fl.key)}
						<label class="dfield"><span>{fl.label}</span>
							<select class="cell-select" bind:value={editRow.flags[fl.key]} onchange={() => saveFlag(editRow!, fl.key, editRow!.flags[fl.key])}>
								<option value="">—</option>{#each FLAG_VALUES as v (v)}<option value={v}>{v}</option>{/each}
							</select>
						</label>
					{/each}
				{/if}
				<label class="dfield"><span>Code SSP</span><input class="cell-input" placeholder="—" bind:value={editRow.sspCode} onchange={() => save(editRow!, 'sspCode', editRow!.sspCode)} /></label>
				{#if data.isAdmin}
					<label class="dfield"><span>Estimation prévisionnel</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={editRow.estimationPrev} onchange={() => debouncedSave(`f-${editRow!.id}-estimationPrev`, () => save(editRow!, 'estimationPrev', editRow!.estimationPrev))} /></label>
					<label class="dfield"><span>Enveloppe totale</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={editRow.enveloppeTotale} onchange={() => debouncedSave(`f-${editRow!.id}-enveloppeTotale`, () => save(editRow!, 'enveloppeTotale', editRow!.enveloppeTotale))} /></label>
				{/if}
				<label class="dfield wide"><span>Commentaire</span><input class="cell-input" placeholder="Note libre…" bind:value={editRow.comment} onchange={() => save(editRow!, 'comment', editRow!.comment)} /></label>
				{#if data.ref.ticketGroups.length > 0}
					<div class="dfield wide">
						<span>Groupes</span>
						<div class="group-chips">
							{#each data.ref.ticketGroups as g (g.id)}
								<button
									type="button"
									class="group-chip"
									class:on={editRow.groupIds.includes(g.id)}
									onclick={() => toggleGroup(editRow!, g.id)}
								>{g.label}</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>
			<div class="tk-foot">
				<span>Consommé <b class="tabnum">{editRow.consumed || '—'}</b></span>
				<span>Écart vs estimé <b class="tabnum" class:gap-pos={ecartVsEstime(editRow) > 0} class:gap-neg={ecartVsEstime(editRow) < 0}>{ecartVsEstime(editRow) > 0 ? '+' : ''}{ecartVsEstime(editRow) || 0}</b></span>
				{#if ecartVsBudget(editRow) !== null}
					<span>Écart vs budget <b class="tabnum" class:gap-pos={(ecartVsBudget(editRow) ?? 0) > 0} class:gap-neg={(ecartVsBudget(editRow) ?? 0) < 0}>{(ecartVsBudget(editRow) ?? 0) > 0 ? '+' : ''}{ecartVsBudget(editRow) || 0}</b></span>
				{/if}
				<span>Avancement <b class="tabnum">{pct(avancement(editRow))}%</b></span>
			</div>
			<div class="tk-history">
				<h4>Historique</h4>
				{#if historyLoading}
					<p class="hint">Chargement…</p>
				{:else if historyEntries.length === 0}
					<p class="hint">Aucune modification tracée pour l'instant.</p>
				{:else}
					<ul>
						{#each historyEntries as h, i (i)}
							<li>
								<span class="hf">{TICKET_FIELD_LABELS[h.field ?? ''] ?? h.field}</span>
								<span class="hv">{h.oldValue ?? '—'} → {h.newValue ?? '—'}</span>
								<span class="hm hint">{h.changedByName ?? 'Quelqu’un'} · {formatDateTime(new Date(h.createdAt))}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			{#if data.isOwner}
				<div class="tk-danger">
					<form method="POST" action="?/delete" use:enhance={(opts) => confirmDeleteTicket(editRow!, opts)}>
						<input type="hidden" name="ticketId" value={editRow.id} />
						<button class="tk-delete-link" type="submit">🗑 Supprimer ce ticket</button>
					</form>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.saved {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--accent);
		background: var(--accent-tint-2);
		padding: 6px 12px;
		border-radius: 30px;
	}
	.create {
		padding: 18px;
		margin-bottom: 18px;
	}
	.grid2 {
		display: grid;
		grid-template-columns: 180px 1fr;
		gap: 14px;
	}
	.grid4 {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 14px;
	}
	@media (max-width: 640px) {
		.grid2,
		.grid4 {
			grid-template-columns: 1fr;
		}
	}
	.actions-row {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 4px;
	}
	.filters {
		display: flex;
		align-items: center;
		gap: 9px;
		margin-bottom: 16px;
		flex-wrap: wrap;
	}
	.filter-fields {
		display: flex;
		align-items: center;
		gap: 9px;
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
		flex-wrap: wrap;
	}
	.filter-fields:disabled {
		opacity: 0.6;
	}
	.filter-fields:disabled .filter-sel,
	.filter-fields:disabled .seg2 button {
		cursor: wait;
	}
	.loading-hint {
		font-size: 12.5px;
		color: var(--text-mute);
	}
	.filter-sel {
		padding: 7px 11px;
		border-radius: 30px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font-size: 12.5px;
		box-shadow: var(--shadow-sm);
		max-width: 170px;
	}
	.filter-sel:focus {
		outline: none;
		border-color: var(--accent);
	}
	.reset-btn {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-soft);
		padding: 7px 12px;
		border-radius: 30px;
		border: 1px solid var(--border);
		transition: border-color 0.15s, color 0.15s;
	}
	.reset-btn:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.count {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-mute);
		font-variant-numeric: tabular-nums;
	}
	.search {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 13px;
		border-radius: 30px;
		background: var(--surface);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-sm);
		color: var(--text-mute);
		min-width: 240px;
	}
	.search input {
		border: none;
		background: none;
		outline: none;
		color: var(--text);
		font-size: 13px;
		width: 100%;
	}
	/* Coins arrondis de .card : overflow:hidden casserait le thead sticky (le clip devient le
	   référentiel de la position sticky au lieu de .main) — on arrondit directement les 2 cellules
	   d'angle du thead pour suivre les coins de la carte sans toucher au clipping. */
	.tk thead th:first-child {
		border-top-left-radius: var(--r-lg);
	}
	.tk thead th:last-child {
		border-top-right-radius: var(--r-lg);
	}
	/* `clip`, pas de scroll ici : le rognage suit le rayon de la card sans créer de 2e ancêtre
	   scrollable, qui casserait le sticky du thead ci-dessous (vise .main). Le scroll horizontal
	   reste local à .tk-scroll (overflow-y:visible, même raison). */
	.tk-card {
		overflow: clip;
		position: relative;
	}
	.tk-scroll {
		overflow-x: auto;
		overflow-y: visible;
	}
	/* < 900px : le tableau dépasse toujours (colonnes fixes) — dégradé indiquant qu'on peut swiper
	   à droite, sinon rien ne le montre (coupé net au bord de l'écran). */
	.tk-card::after {
		content: '';
		display: none;
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 28px;
		pointer-events: none;
		background: linear-gradient(to right, transparent, var(--surface) 70%);
	}
	@media (max-width: 900px) {
		.tk-card::after {
			display: block;
		}
	}
	table.tk {
		width: 100%;
		min-width: 820px;
		border-collapse: separate;
		border-spacing: 0;
	}
	.tk thead th {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-mute);
		padding: 14px 10px 12px;
		text-align: left;
		white-space: nowrap;
		/* Header figé au scroll (relatif à .main, seul ancêtre scrollable) : on voit toujours
		   à quoi correspond chaque colonne, même en bas d'une longue page de tickets. */
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--surface);
		box-shadow: 0 1px 0 var(--border);
	}
	.tk thead th.num {
		text-align: right;
	}
	.tk tbody td {
		padding: 6px 8px;
		border-top: 1px solid var(--border);
		font-size: 13.5px;
		vertical-align: middle;
	}
	.tk tbody td.num {
		text-align: right;
	}
	.tk tbody tr:hover {
		background: var(--surface-2);
	}
	/* Ligne US toujours mise en évidence (peu importe la hiérarchie parent/enfant) pour bien la
	   distinguer des lignes fines d'activité juste en dessous. */
	.tk tr.ticket-row td {
		background: var(--surface-2);
		border-top: 1px solid var(--border-strong);
	}
	/* Le fond est posé sur les <td> ci-dessus (opaque), donc la surbrillance doit aussi cibler
	   les <td> — un simple background sur <tr> serait invisible, recouvert par celui des cellules. */
	.tk tr.ticket-row.highlighted td {
		background: color-mix(in srgb, var(--accent) 28%, var(--surface-2));
		animation: highlight-fade 2.5s ease-out 1;
	}
	@keyframes highlight-fade {
		from {
			background: color-mix(in srgb, var(--accent) 50%, var(--surface-2));
		}
	}
	.tk .key {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-mute);
		padding-left: 7px;
	}
	.ttl-wrap {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.ttl-main {
		flex: 1;
		min-width: 0;
	}
	.tk .ttl.sub .key,
	.tk .ttl.sub .title-input {
		margin-left: 20px;
	}
	.expand-btn {
		flex-shrink: 0;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		border: 1px solid transparent;
		color: var(--text-mute);
		font-size: 16px;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: transform 0.15s, color 0.15s, background 0.15s;
	}
	.expand-btn:hover {
		background: var(--surface);
		border-color: var(--border-strong);
		color: var(--text);
	}
	.group-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.group-chip {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-soft);
		border: 1px solid var(--border);
		border-radius: 20px;
		padding: 4px 12px;
		background: var(--surface);
		transition: border-color 0.15s, color 0.15s, background 0.15s;
	}
	.group-chip:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.group-chip.on {
		background: var(--accent-tint);
		border-color: var(--accent);
		color: var(--accent-ink);
	}
	/* Fond nettement plus sombre/creusé que la ligne US (surface-2) juste au-dessus, pour bien
	   marquer où finit un ticket et où commence le suivant. */
	.activity-subrow {
		background: var(--surface-sunk);
	}
	.activity-subrow td {
		padding: 2px 14px;
		border-top: none;
		line-height: 1.6;
	}
	.activity-subrow .ar-name {
		font-size: 11.5px;
		color: var(--text-soft);
		padding-left: 34px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.activity-subrow .ar-contrib {
		margin-left: 10px;
		color: var(--text-mute);
	}
	.activity-subrow .num-input {
		height: 22px;
		padding: 0 6px;
		font-size: 11.5px;
	}
	.activity-subrow .consumed {
		font-size: 11.5px;
	}
	.dfield {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.dfield > span {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-mute);
	}
	.dfield .cell-input,
	.dfield .cell-select {
		border-color: var(--border);
		background: var(--surface);
	}
	.consumed {
		font-weight: 700;
		color: var(--text-soft);
		padding-right: 14px !important;
	}

	/* contrôles inline */
	.cell-input,
	.cell-select {
		width: 100%;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 7px;
		padding: 6px 7px;
		font: inherit;
		font-size: 13.5px;
		color: var(--text);
		transition: border-color 0.15s, background 0.15s;
	}
	.cell-input:hover:not(:disabled),
	.cell-select:hover:not(:disabled) {
		border-color: var(--border-strong);
		background: var(--surface);
	}
	.cell-input:disabled,
	.cell-select:disabled {
		cursor: not-allowed;
	}
	.cell-input:focus,
	.cell-select:focus {
		border-color: var(--accent);
		background: var(--surface);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
		outline: none;
	}
	/* Bucket "Autre" (imputations sans activité) : rien à éditer, cf. NO_ACTIVITY_ID. */
	.cell-readonly {
		display: block;
		width: 100%;
		padding: 6px 7px;
		font-size: 13.5px;
		color: var(--text-mute);
		text-align: center;
		cursor: default;
	}
	.title-input {
		font-weight: 500;
	}
	.num-input {
		width: 68px;
		text-align: right;
		font-variant-numeric: tabular-nums;
		margin-left: auto;
	}
	.state-select {
		font-size: 12.5px;
	}
	.prog {
		display: flex;
		align-items: center;
		gap: 9px;
		justify-content: flex-end;
		padding-right: 6px;
	}
	.prog .bar {
		width: 60px;
		height: 7px;
		border-radius: 20px;
		background: var(--surface-sunk);
		overflow: hidden;
	}
	.prog .bar i {
		display: block;
		height: 100%;
		border-radius: 20px;
		background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 70%, #000), var(--accent));
	}
	.prog .pct {
		font-size: 12.5px;
		font-weight: 700;
		color: var(--text-soft);
		min-width: 34px;
		text-align: right;
	}
	.gap-pos {
		color: var(--warn) !important;
		font-weight: 700;
	}
	.gap-neg {
		color: var(--accent) !important;
		font-weight: 700;
	}
	.empty-row {
		text-align: center;
		color: var(--text-mute);
		padding: 30px;
	}
	.pager {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 16px;
		padding: 14px;
		border-top: 1px solid var(--border);
	}
	/* Pas de padding/border dédiés : .skeleton-row réutilise .ticket-row (même <td>, mêmes classes
	   cell-input/num-input) pour tomber pile sur la hauteur d'une vraie ligne, sans la deviner. */
	.skeleton-bar {
		height: 14px;
		border-radius: 6px;
		/* Mélangé à --text (pas --surface/--surface-2, quasi identiques ici) pour rester visible sur
		   le fond de la ligne dans les deux thèmes — clair ou sombre, --text s'inverse déjà pour ça. */
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--text) 12%, var(--surface-2)) 25%,
			color-mix(in srgb, var(--text) 26%, var(--surface-2)) 50%,
			color-mix(in srgb, var(--text) 12%, var(--surface-2)) 75%
		);
		background-size: 200% 100%;
		animation: skeleton-shimmer 1.4s ease-in-out infinite;
	}
	@keyframes skeleton-shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}
	.seg2 {
		display: flex;
		gap: 2px;
		padding: 3px;
		border-radius: 30px;
		background: var(--surface-sunk);
		border: 1px solid var(--border);
	}
	.seg2 button {
		padding: 6px 14px;
		border-radius: 30px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-mute);
		transition: background 0.15s, color 0.15s;
	}
	.seg2 button.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}

	/* Kanban */
	.kanban {
		display: flex;
		gap: 14px;
		overflow: auto;
		padding-bottom: 8px;
		align-items: stretch;
		/* Hauteur bornée (et non min-height) : une colonne longue faisait dépasser le board, et sa
		   barre de défilement horizontale partait en bas de page, hors de portée sans tout dérouler.
		   Le débordement vertical est repris colonne par colonne (.kcards). */
		height: calc(100dvh - 13rem);
	}
	.kcol {
		flex: 0 0 280px;
		max-height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		padding: 12px;
	}
	.kcol-head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 4px 12px;
		/* La colonne défile sous son titre : il doit rester lisible. */
		position: sticky;
		top: 0;
		background: var(--surface-2);
		z-index: 1;
	}
	.kdot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.klabel {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-soft);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
	}
	.kcount {
		font-size: 11.5px;
		font-weight: 700;
		color: var(--text-mute);
		background: var(--surface-sunk);
		padding: 1px 8px;
		border-radius: 20px;
	}
	.kcards {
		display: flex;
		flex-direction: column;
		gap: 9px;
		flex: 1;
		overflow-y: auto;
		/* Zone de dépôt utilisable même quand la colonne est vide ou courte. */
		min-height: 40px;
	}
	.kcard {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		padding: 11px 12px;
		cursor: grab;
		box-shadow: var(--shadow-sm);
		transition: border-color 0.15s, transform 0.1s, opacity 0.15s;
	}
	.kcard:hover {
		border-color: var(--border-strong);
	}
	.kcard:active {
		cursor: grabbing;
	}
	.kcard.dragging {
		opacity: 0.45;
		border-color: var(--accent);
	}
	.kkey {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.ktitle {
		font-size: 13.5px;
		font-weight: 500;
		margin: 3px 0 9px;
		line-height: 1.35;
	}
	.kmeta {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.kbar {
		flex: 1;
		height: 6px;
		border-radius: 20px;
		background: var(--surface-sunk);
		overflow: hidden;
	}
	.kbar i {
		display: block;
		height: 100%;
		border-radius: 20px;
		background: var(--accent);
	}
	.kpct {
		font-size: 11.5px;
		font-weight: 700;
		color: var(--text-soft);
		min-width: 30px;
		text-align: right;
	}
	.kempty {
		font-size: 12px;
		color: var(--text-mute);
		text-align: center;
		padding: 14px 0;
	}
	/* Modal d'édition de ticket */
	.tk-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		z-index: 50;
	}
	.tk-modal {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
		padding: 22px 24px;
		width: 100%;
		max-width: 600px;
		max-height: 86vh;
		overflow-y: auto;
	}
	.tk-modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.tk-danger {
		margin-top: 14px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
		display: flex;
		justify-content: flex-end;
	}
	.tk-delete-link {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-mute);
		border-radius: 7px;
		padding: 5px 10px;
	}
	.tk-delete-link:hover {
		color: var(--warn);
		background: var(--warn-tint);
	}
	.tk-key {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-mute);
	}
	.tk-key-input {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-mute);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 3px 6px;
		width: 110px;
	}
	.tk-key-input:hover,
	.tk-key-input:focus {
		border-color: var(--border-strong);
		background: var(--surface-2);
		color: var(--text);
		outline: none;
	}
	.tk-x {
		font-size: 15px;
		color: var(--text-mute);
		width: 28px;
		height: 28px;
		border-radius: 8px;
	}
	.tk-x:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.tk-title {
		width: 100%;
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
		color: var(--text);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 8px;
		padding: 6px 8px;
		margin: 2px 0 16px;
	}
	.tk-title:hover,
	.tk-title:focus {
		border-color: var(--border-strong);
		background: var(--surface-2);
		outline: none;
	}
	.tk-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}
	.tk-grid .dfield.wide {
		grid-column: 1 / -1;
	}
	.tk-foot {
		display: flex;
		gap: 22px;
		margin-top: 18px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
		font-size: 13px;
		color: var(--text-mute);
	}
	.tk-foot b {
		color: var(--text-soft);
		margin-left: 4px;
	}
	.tk-history {
		margin-top: 14px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
	}
	.tk-history h4 {
		margin: 0 0 8px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-soft);
	}
	.tk-history ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 160px;
		overflow-y: auto;
	}
	.tk-history li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 8px;
		font-size: 12.5px;
	}
	.tk-history .hf {
		font-weight: 600;
		color: var(--text-soft);
	}
	.tk-history .hv {
		color: var(--text);
	}
	.tk-history .hm {
		margin-left: auto;
		white-space: nowrap;
	}
	@media (max-width: 560px) {
		.tk-grid {
			grid-template-columns: 1fr 1fr;
		}
	}
	.hint-edit {
		font-size: 12.5px;
		color: var(--text-mute);
		margin: 14px 4px 0;
	}
</style>
