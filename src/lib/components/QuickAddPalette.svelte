<script lang="ts">
	import { tick } from 'svelte';
	import { visualViewportFit } from '$lib/visualViewport';
	import { goto } from '$app/navigation';

	// Palette d'ajout rapide (Mon imputation) — remplace TargetPicker + <select> activité + bouton
	// "Ajouter" par un seul flux : Shift+A (ou clic) ouvre une fenêtre centrée — pas Ctrl/Cmd+K, déjà
	// pris par le spotlight global de l'appli (cf. CommandPalette.svelte) — on tape/navigue au clavier
	// pour choisir le ticket ou la catégorie (même logique de recherche/suggestions/objectifs que
	// TargetPicker, dupliquée plutôt que réutilisée : TargetPicker sert aussi ailleurs — cf. objectifs
	// admin — sans étape activité, l'y greffer aurait complexifié un composant qui n'en a pas besoin),
	// puis l'activité (« Aucune activité » toujours pré-surlignée en premier, jamais une activité au
	// hasard), et Entrée ajoute la ligne et referme — on n'ajoute jamais plusieurs lignes d'une traite.
	// sprintId/sprintName voyagent depuis la recherche serveur jusqu'au parent (via onfetched), qui
	// en a besoin pour construire la ligne : la palette ne les affiche pas mais ne doit pas les perdre.
	type Ticket = {
		id: string;
		key: string;
		title: string;
		versionId?: string | null;
		sprintId?: string | null;
		sprintName?: string | null;
	};
	type Category = { id: string; label: string };
	type Version = { id: string; name: string };
	type Objective = {
		id: string;
		kind: 'TICKET' | 'CUSTOM';
		ticketId: string | null;
		ticketKey: string | null;
		ticketTitle: string | null;
		label: string | null;
		activityId: string | null;
	};
	type Activity = { id: string; label: string };

	let {
		tickets,
		categories,
		recentTicketIds,
		versions = [],
		objectives = [],
		activities,
		onadd,
		/** Voir TargetPicker : remonte au parent les tickets ramenés par la recherche serveur, dont il
		 *  a besoin pour résoudre le ticket choisi (titre, sprint) au moment de créer la ligne. */
		onfetched
	}: {
		tickets: Ticket[];
		categories: Category[];
		recentTicketIds: string[];
		versions?: Version[];
		objectives?: Objective[];
		activities: Activity[];
		/** `pickTarget` suit exactly l'encodage TargetPicker (`TICKET::id[::objectiveId]`, `CATEGORY::id`,
		 * `OBJECTIVE::id`) — le parent le passe tel quel à sa logique addRow() existante. */
		onadd: (pickTarget: string, activityId: string | null) => void;
		onfetched?: (tickets: Ticket[]) => void;
	} = $props();

	type FlatItem =
		| { kind: 'objective-ticket'; objectiveId: string; ticketId: string; ticketKey: string; ticketTitle: string; activityId: string | null }
		| { kind: 'objective-custom'; objectiveId: string; label: string }
		| { kind: 'ticket'; ticket: Ticket }
		| { kind: 'create-ticket'; query: string }
		| { kind: 'category'; category: Category };

	let open = $state(false);
	let stage = $state<'target' | 'activity'>('target');
	let query = $state('');
	let versionFilter = $state('');
	let activeIndex = $state(0);
	let chosenTarget = $state<{ value: string; label: string } | null>(null);
	let root: HTMLDivElement | null = $state(null);
	let searchInput: HTMLInputElement | null = $state(null);
	let listEl: HTMLDivElement | null = $state(null);

	const suggested = $derived(
		recentTicketIds.map((id) => tickets.find((t) => t.id === id)).filter((t): t is Ticket => !!t)
	);
	// Recherche serveur, comme TargetPicker : `tickets` n'est plus qu'une graine bornée (cf.
	// imputation/+page.server.ts), filtrer en local ne trouverait rien au-delà.
	const MIN_QUERY = 2;
	let remote = $state<Ticket[]>([]);
	let searching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let searchToken = 0;

	$effect(() => {
		const q = query.trim();
		const version = versionFilter;
		clearTimeout(searchTimer);
		// Étape activité : `query` sert alors à filtrer les activités, pas les tickets.
		if (stage !== 'target' || (q.length < MIN_QUERY && !version)) {
			remote = [];
			searching = false;
			return;
		}
		searching = true;
		const token = ++searchToken;
		searchTimer = setTimeout(async () => {
			try {
				const params = new URLSearchParams();
				if (q) params.set('q', q);
				if (version) params.set('version', version);
				const res = await fetch(`/api/tickets/search?${params}`);
				const found = res.ok ? ((await res.json()).tickets as Ticket[]) : [];
				if (token !== searchToken) return;
				remote = found;
				if (found.length > 0) onfetched?.(found);
			} catch {
				if (token === searchToken) remote = [];
			} finally {
				if (token === searchToken) searching = false;
			}
		}, 200);
		return () => clearTimeout(searchTimer);
	});

	// Même règle que TargetPicker : un filtre version actif montre toute la version plutôt que les
	// suggestions récentes, sinon le filtre semblerait ne rien faire tant qu'on n'a pas tapé de texte.
	const filteredTickets = $derived.by(() => {
		// Recherche en cours : on n'affiche PAS les résultats de la frappe précédente — le squelette
		// prend leur place dans le rendu. Sinon les barres s'ajoutaient sous une liste périmée et se
		// lisaient comme des lignes supplémentaires plutôt que comme une recherche en cours.
		if (searching) return [];
		const q = query.trim();
		if (q.length >= MIN_QUERY || versionFilter) return remote;
		if (q) return [];
		return suggested;
	});
	// Catégories jamais filtrées par la recherche (comme TargetPicker) : une poignée de valeurs,
	// toujours utile de les garder visibles pendant qu'on tape un ticket.
	const showObjectives = $derived(objectives.length > 0 && !query.trim() && !versionFilter);

	const stage1Items = $derived.by((): FlatItem[] => {
		const out: FlatItem[] = [];
		if (showObjectives) {
			for (const o of objectives) {
				if (o.kind === 'TICKET' && o.ticketId) {
					out.push({
						kind: 'objective-ticket',
						objectiveId: o.id,
						ticketId: o.ticketId,
						ticketKey: o.ticketKey ?? '',
						ticketTitle: o.ticketTitle ?? '',
						activityId: o.activityId
					});
				} else if (o.kind === 'CUSTOM') {
					out.push({ kind: 'objective-custom', objectiveId: o.id, label: o.label ?? '' });
				}
			}
		}
		// Aucun ticket trouvé sur une recherche non vide : proposer d'aller le créer plutôt que de
		// laisser une section "Tickets" vide (les catégories restent affichées en dessous, elles).
		const q = query.trim();
		// `!searching` : pendant le debounce + l'aller-retour, la liste est momentanément vide — sans
		// cette garde, "Créer le ticket …" clignoterait avant l'arrivée des résultats.
		if (filteredTickets.length === 0 && q && !searching) {
			out.push({ kind: 'create-ticket', query: q });
		} else {
			for (const t of filteredTickets) out.push({ kind: 'ticket', ticket: t });
		}
		for (const c of categories) out.push({ kind: 'category', category: c });
		return out;
	});
	const stage2Items = $derived.by((): { id: string | null; label: string }[] => {
		const q = query.trim().toLowerCase();
		const filtered = activities.filter((a) => !q || a.label.toLowerCase().includes(q));
		if (q) return filtered.map((a) => ({ id: a.id, label: a.label }));
		return [{ id: null, label: 'Aucune activité' }, ...filtered.map((a) => ({ id: a.id, label: a.label }))];
	});

	function sectionOf(it: FlatItem): 'objective' | 'ticket' | 'category' {
		if (it.kind === 'objective-ticket' || it.kind === 'objective-custom') return 'objective';
		if (it.kind === 'category') return 'category';
		return 'ticket'; // 'ticket' et 'create-ticket' partagent la même section/en-tête
	}
	function isFirstOfSection(i: number): boolean {
		return i === 0 || sectionOf(stage1Items[i - 1]) !== sectionOf(stage1Items[i]);
	}
	function sectionLabel(it: FlatItem): string {
		const s = sectionOf(it);
		if (s === 'objective') return '🎯 Attribué cette semaine';
		if (s === 'ticket') return query.trim() || versionFilter ? 'Tickets' : 'Suggestions';
		return 'Catégories';
	}
	function itemKey(it: FlatItem): string {
		if (it.kind === 'objective-ticket') return 'ot:' + it.objectiveId;
		if (it.kind === 'objective-custom') return 'oc:' + it.objectiveId;
		if (it.kind === 'ticket') return 't:' + it.ticket.id;
		if (it.kind === 'create-ticket') return 'ct:' + it.query;
		return 'c:' + it.category.id;
	}
	function resolveTargetValue(it: FlatItem): { value: string; label: string } {
		if (it.kind === 'objective-ticket')
			return { value: `TICKET::${it.ticketId}::${it.objectiveId}`, label: `${it.ticketKey} — ${it.ticketTitle}` };
		if (it.kind === 'objective-custom') return { value: `OBJECTIVE::${it.objectiveId}`, label: it.label };
		if (it.kind === 'ticket') return { value: `TICKET::${it.ticket.id}`, label: `${it.ticket.key} — ${it.ticket.title}` };
		if (it.kind === 'category') return { value: `CATEGORY::${it.category.id}`, label: it.category.label };
		// 'create-ticket' n'arrive jamais ici : intercepté plus tôt dans pickActive() (ça navigue vers
		// /tickets, ce n'est pas une cible à choisir) — juste de quoi satisfaire le typage.
		return { value: '', label: '' };
	}

	async function scrollActiveIntoView() {
		await tick();
		listEl?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
	}
	/** `preselect` : arrivée directe à l'étape activité, ticket déjà choisi (retour de création de
	 * ticket, cf. show() ci-dessous) — sinon repart normalement de la recherche. */
	function openPalette(preselect: { value: string; label: string } | null = null) {
		open = true;
		chosenTarget = preselect;
		stage = preselect ? 'activity' : 'target';
		query = '';
		versionFilter = '';
		activeIndex = 0;
		queueMicrotask(() => searchInput?.focus());
	}
	function closePalette() {
		open = false;
	}
	/** Ouverture depuis l'extérieur (raccourci Shift+A global, cf. CommandPalette.svelte, qui navigue
	 * ici puis appelle cette méthode via bind:this) — jamais nommée `open`, ce serait un doublon avec
	 * l'état `open` ci-dessus. Ignore l'appel si déjà ouverte : sinon une réactivité externe fortuite
	 * réinitialiserait en plein milieu d'une saisie en cours.
	 * `preselectTicketId` : retour depuis la création d'un ticket lancée faute de résultat (cf.
	 * pickActive ci-dessous) — on saute direct à l'étape activité plutôt que de tout refaire taper. */
	export function show(preselectTicketId?: string) {
		if (open) return;
		const t = preselectTicketId ? tickets.find((x) => x.id === preselectTicketId) : undefined;
		openPalette(t ? { value: `TICKET::${t.id}`, label: `${t.key} — ${t.title}` } : null);
	}
	function backToTarget() {
		stage = 'target';
		chosenTarget = null;
		query = '';
		activeIndex = 0;
		queueMicrotask(() => searchInput?.focus());
	}
	function commit(activityId: string | null) {
		if (!chosenTarget) return;
		onadd(chosenTarget.value, activityId);
		closePalette();
	}
	function pickActive() {
		if (stage === 'target') {
			const it = stage1Items[activeIndex];
			if (!it) return;
			if (it.kind === 'create-ticket') {
				// Titre repris là-bas, pas la clé (jamais devinée) — retour direct ici avec le ticket
				// choisi une fois créé, cf. le ?returnTo=imputation géré sur /tickets.
				goto(`/tickets?new=1&title=${encodeURIComponent(it.query)}&returnTo=imputation`);
				return;
			}
			chosenTarget = resolveTargetValue(it);
			// Un objectif TICKET a une activité fixe (attribuée par l'admin) : laisser le choix ici
			// créerait une ligne sur une autre activité que celle de l'objectif, avec le même
			// objectiveId — la ligne "attribuée" (syncedRows, activité de l'objectif) resterait alors
			// non couverte et réapparaîtrait à côté, dupliquant la note sur les deux lignes.
			if (it.kind === 'objective-ticket') {
				commit(it.activityId);
				return;
			}
			stage = 'activity';
			query = '';
			activeIndex = 0;
			queueMicrotask(() => searchInput?.focus());
		} else {
			const it = stage2Items[activeIndex];
			if (!it) return;
			commit(it.id);
		}
	}
	function pick(i: number) {
		activeIndex = i;
		pickActive();
	}
	function onInput(e: Event) {
		query = (e.currentTarget as HTMLInputElement).value;
		activeIndex = 0;
	}
	function onVersionChange(e: Event) {
		versionFilter = (e.currentTarget as HTMLSelectElement).value;
		activeIndex = 0;
	}
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Backspace' && stage === 'activity' && query === '') {
			e.preventDefault();
			backToTarget();
			return;
		}
		const len = stage === 'target' ? stage1Items.length : stage2Items.length;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIndex = len === 0 ? 0 : Math.min(len - 1, activeIndex + 1);
			scrollActiveIntoView();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIndex = Math.max(0, activeIndex - 1);
			scrollActiveIntoView();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			// Recherche en vol : la section tickets est un squelette, seules les catégories restent à
			// l'écran — et `activeIndex` a été remis à 0, donc valider ajouterait une catégorie à la
			// place du ticket qu'on cherchait.
			if (stage === 'target' && searching) return;
			pickActive();
		}
	}
	/** Un seul <svelte:window> par composant : Échap (n'importe où) et Shift+A global partagent celui-ci. */
	function isTypingElsewhere(e: KeyboardEvent): boolean {
		const el = e.target as HTMLElement | null;
		if (!el) return false;
		const tag = el.tagName;
		return (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) && !root?.contains(el);
	}
	function onWindowKeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			e.preventDefault();
			closePalette();
			return;
		}
		// Shift+A ("Ajouter") : ni Ctrl/Cmd+K (spotlight global, cf. CommandPalette.svelte) ni Shift+N
		// (déjà "Nouveau ticket" sur /tickets) — même garde-fou que ce dernier : jamais voler la frappe
		// d'un champ texte en cours d'édition ailleurs sur la page.
		if (
			!open &&
			e.key.toLowerCase() === 'a' &&
			e.shiftKey &&
			!e.metaKey &&
			!e.ctrlKey &&
			!e.altKey &&
			!isTypingElsewhere(e)
		) {
			e.preventDefault();
			openPalette();
		}
	}
</script>

{#snippet searchSkeleton()}
	<!-- Squelette plutôt qu'un simple "Recherche…" : la liste se remplit au même endroit et à la même
	     forme que les résultats à venir, donc rien ne saute quand ils arrivent. Largeurs volontairement
	     inégales pour que ça se lise comme des lignes de contenu, pas comme un tableau vide. -->
	{#each [64, 58, 70, 54] as w, i (i)}
		<div class="qa-skel">
			<span class="qa-skel-bar" style="width:{w}px;flex-shrink:0;"></span>
			<span class="qa-skel-bar" style="width:{100 - i * 12}%;"></span>
		</div>
	{/each}
{/snippet}

<svelte:window onkeydown={onWindowKeydown} />

<div class="qa-root" bind:this={root}>
	<button type="button" class="qa-launcher" onclick={() => openPalette()}>
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
			><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg
		>
		<span class="qa-launcher-text">Ajouter un ticket ou une catégorie…</span>
		<kbd class="qa-kbd"><span class="qa-kbd-shift">⇧</span>A</kbd>
	</button>

	{#if open}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="qa-veil" onclick={closePalette} use:visualViewportFit>
			<div class="qa-palette" onclick={(e) => e.stopPropagation()}>
				<div class="qa-input-row">
					{#if chosenTarget}
						<div class="qa-chip-row">
							<span class="qa-chip">
								<span class="qa-chip-label">{chosenTarget.label}</span>
								<button type="button" class="qa-chip-remove" onclick={backToTarget} aria-label="Changer de ticket/catégorie">✕</button>
							</span>
						</div>
					{/if}
					<input
						bind:this={searchInput}
						value={query}
						oninput={onInput}
						onkeydown={onKeydown}
						type="text"
						inputmode="search"
						autocomplete="off"
						autocapitalize="off"
						autocorrect="off"
						spellcheck="false"
						class="qa-input"
						class:qa-input-pill={stage === 'activity'}
						placeholder={stage === 'target' ? 'Rechercher un ticket ou une catégorie…' : 'Activité — Entrée pour valider sans'}
					/>
					{#if stage === 'target' && versions.length > 0}
						<select class="qa-version" value={versionFilter} onchange={onVersionChange} aria-label="Filtrer par version">
							<option value="">Toutes versions</option>
							{#each versions as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
						</select>
					{/if}
				</div>

				<div class="qa-list" bind:this={listEl}>
					{#if stage === 'target'}
						{#if searching}
							<!-- Les catégories restent, elles : locales, jamais filtrées par la recherche
							     (cf. showObjectives). Seule la section tickets passe en squelette. -->
							<div class="qa-section-label">Tickets</div>
							{@render searchSkeleton()}
						{/if}
						{#each stage1Items as it, i (itemKey(it))}
							{#if isFirstOfSection(i)}<div class="qa-section-label">{sectionLabel(it)}</div>{/if}
							{#if it.kind === 'objective-ticket'}
								<button type="button" class="qa-item" class:active={activeIndex === i} onclick={() => pick(i)}>
									<span class="qa-key">{it.ticketKey}</span><span class="qa-title">{it.ticketTitle}</span>
								</button>
							{:else if it.kind === 'objective-custom'}
								<button type="button" class="qa-item" class:active={activeIndex === i} onclick={() => pick(i)}>
									<span class="qa-title">{it.label}</span>
								</button>
							{:else if it.kind === 'ticket'}
								<button type="button" class="qa-item" class:active={activeIndex === i} onclick={() => pick(i)}>
									<span class="qa-key">{it.ticket.key}</span><span class="qa-title">{it.ticket.title}</span>
								</button>
							{:else if it.kind === 'create-ticket'}
								<button type="button" class="qa-item qa-item-create" class:active={activeIndex === i} onclick={() => pick(i)}>
									<span class="qa-title">+ Créer le ticket « {it.query} » sur Tickets &amp; chiffrage</span>
								</button>
							{:else}
								<button type="button" class="qa-item" class:active={activeIndex === i} onclick={() => pick(i)}>
									<span class="qa-title">{it.category.label}</span>
								</button>
							{/if}
						{/each}
						{#if !searching && stage1Items.length === 0}
							<div class="qa-empty">Aucun résultat.</div>
						{/if}
					{:else}
						<div class="activity-options">
							{#each stage2Items as it, i (it.id ?? 'none')}
								<button type="button" class="activity-option" class:sel={activeIndex === i} onclick={() => pick(i)}>
									{it.label}
								</button>
							{/each}
							{#if stage2Items.length === 0}<div class="qa-empty">Aucune activité ne correspond.</div>{/if}
						</div>
					{/if}
				</div>

				<div class="qa-footer">
					<span>↑↓ naviguer · Entrée choisir/valider</span>
					<span>Échap fermer</span>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.qa-root {
		width: 100%;
	}
	.qa-launcher {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 11px 14px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface-2, var(--surface));
		color: var(--text-mute);
		font: inherit;
		font-size: 13.5px;
		text-align: left;
		transition: border-color 0.15s, background 0.15s;
	}
	.qa-launcher:hover {
		border-color: var(--border-strong);
	}
	.qa-launcher svg {
		flex-shrink: 0;
	}
	.qa-launcher-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.qa-kbd {
		font-family: ui-monospace, monospace;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: 5px;
		border: 1px solid var(--border-strong);
		background: var(--surface);
		color: var(--text-mute);
	}
	/* ⇧ n'existe pas dans les polices monospace : le navigateur retombe sur une police système/emoji,
	   plus fine et mal alignée à côté du "N" (même correctif que .shortcut-shift sur /tickets). */
	.qa-kbd-shift {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		font-size: 1.3em;
		line-height: 1;
		margin-right: 1px;
	}
	@media (max-width: 640px) {
		/* Pas de clavier physique sur mobile : le raccourci n'a rien à indiquer. */
		.qa-kbd {
			display: none;
		}
	}

	.qa-veil {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 0 16px;
		padding-top: min(14vh, 100px);
		z-index: 60;
	}
	.qa-palette {
		width: 100%;
		max-width: 460px;
		/* Le haut reste fixe (padding-top du voile, inchangé) : seule la hauteur s'adapte, jusqu'à ne
		   plus laisser que 3vh en bas — pas un plafond fixe qui gâcherait la place dispo sur un grand
		   écran, ni un vide qui touche le bord sur un petit. */
		max-height: calc(100vh - min(14vh, 100px) - 3vh);
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
		overflow: hidden;
	}
	.qa-input-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--border);
		flex-wrap: wrap;
		flex-shrink: 0;
	}
	/* Occupe toute la ligne à elle seule (flex-basis 100%) — le champ activité qui suit est ainsi
	   toujours poussé à la ligne suivante, jamais serré à côté d'un ticket au titre long.
	   min-width:0 : sans lui, un flex-item garde pour largeur minimale le min-content de son texte
	   non wrappé (le titre du ticket) — il refuse alors de rétrécir sous cette largeur et pousse la
	   croix de suppression hors de l'écran au lieu de laisser l'ellipsis de .qa-chip-label faire son
	   travail. Même correctif que .tp-root sur TargetPicker.svelte pour la même raison. */
	.qa-chip-row {
		flex: 0 0 100%;
		min-width: 0;
	}
	/* La pilule elle-même prend maintenant toute la largeur de sa ligne (pas juste le wrapper) : le
	   libellé à gauche, la croix de suppression bien mise en évidence à droite. */
	.qa-chip {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		box-sizing: border-box;
		padding: 6px 6px 6px 12px;
		border-radius: 999px;
		background: var(--accent-tint, var(--surface-2));
		color: var(--accent-ink, var(--accent));
		font-size: 12.5px;
		font-weight: 600;
	}
	.qa-chip-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Badge circulaire propre plutôt qu'un simple "✕" translucide : sans fond ni contour, elle se
	   noyait dans la pilule (retour direct) — visible au premier coup d'œil, y compris au clavier. */
	.qa-chip-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		border: none;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent-ink) 18%, transparent);
		color: var(--accent-ink);
		font-size: 12px;
		line-height: 1;
		cursor: pointer;
		transition: background 0.15s, transform 0.1s;
	}
	.qa-chip-remove:hover {
		background: color-mix(in srgb, var(--accent-ink) 32%, transparent);
	}
	.qa-chip-remove:active {
		transform: scale(0.92);
	}
	.qa-input {
		flex: 1;
		min-width: 80px;
		border: none;
		background: none;
		outline: none;
		font: inherit;
		/* >=16px : sous ce seuil, iOS Safari zoome la page au focus d'un champ — la palette doit
		   rester utilisable au clavier tactile sans que la mise en page ne bouge. */
		font-size: 16px;
		color: var(--text);
	}
	/* Étape activité : même famille visuelle que la pilule du ticket au-dessus (forme, hauteur,
	   arrondi) — pas le même remplissage plein accent, réservé à un choix déjà validé, celui-ci est
	   encore une saisie en cours. Cohérent plutôt qu'un champ nu juste en dessous d'une vraie pilule. */
	.qa-input-pill {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 6px 14px;
		background: var(--surface-2, var(--surface));
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	.qa-input-pill:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-tint, transparent);
	}
	.qa-version {
		flex: 0 0 auto;
		max-width: 40%;
		padding: 6px 8px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 12.5px;
	}
	.qa-list {
		flex: 1;
		/* Pas de max-height ici : elle grandit avec .qa-palette (dont le plafond dépend du viewport,
		   cf. ci-dessus) et ne défile que quand la palette a elle-même atteint le sien. */
		min-height: 0;
		overflow-y: auto;
		padding: 8px;
	}
	.qa-section-label {
		font-size: 10.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-mute);
		padding: 8px 8px 4px;
	}
	.qa-section-label:first-child {
		padding-top: 2px;
	}
	.qa-item {
		display: flex;
		align-items: baseline;
		gap: 8px;
		width: 100%;
		padding: 10px 10px;
		border-radius: 8px;
		font-size: 13.5px;
		color: var(--text);
		text-align: left;
		background: none;
		border: none;
		cursor: pointer;
	}
	.qa-item.active {
		background: var(--accent-tint, var(--surface-2));
	}
	/* Distincte des vrais résultats : une action ("aller créer"), pas un choix de ticket existant —
	   même traitement que .tp-custom sur TargetPicker.svelte pour la même intention ailleurs. */
	.qa-item-create {
		color: var(--accent-ink, var(--accent));
		font-weight: 600;
	}
	.qa-key {
		flex-shrink: 0;
		font-weight: 600;
		color: var(--text-soft);
		font-variant-numeric: tabular-nums;
	}
	.qa-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.qa-empty {
		padding: 10px 8px;
		font-size: 12.5px;
		color: var(--text-mute);
	}
	/* Même gabarit que la modale de réassignation d'activité (cf. .activity-option plus bas dans
	   +page.svelte) — familier plutôt que réinventé, même si Svelte scope les styles par composant
	   et n'en hérite pas directement. */
	.activity-options {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.activity-option {
		width: 100%;
		text-align: left;
		padding: 10px 10px;
		border-radius: 8px;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text);
		background: none;
		border: none;
		cursor: pointer;
	}
	.activity-option.sel {
		background: var(--accent-tint, var(--surface-2));
		color: var(--accent-ink, var(--accent));
	}
	.qa-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 14px;
		border-top: 1px solid var(--border);
		font-size: 11px;
		color: var(--text-mute);
		flex-shrink: 0;
	}
	/* Repères clavier inutiles au doigt. La largeur n'est qu'une approximation du tactile — on garde
	   le seuil historique, et on ajoute la vraie condition : pas de dispositif de pointage fin. */
	@media (max-width: 480px), (pointer: coarse) {
		.qa-footer {
			display: none;
		}
	}
	button:focus-visible,
	input:focus-visible,
	select:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	/* ---------- Mobile : feuille du bas plutôt que fenêtre centrée ----------
	   Trois problèmes traités ensemble :
	   1. le clavier virtuel cachait le bas de la modale — le voile suit maintenant le viewport
	      VISIBLE (cf. visualViewportFit), donc la feuille reste toujours entièrement au-dessus ;
	   2. une fenêtre centrée à 14vh du haut gâchait la place et laissait la liste loin du pouce —
	      ancrée en bas, elle démarre là où la main se trouve ;
	   3. les cibles tactiles étaient calibrées à la souris (cf. pointer: coarse plus bas). */
	@media (max-width: 640px) {
		.qa-veil {
			align-items: flex-end;
			padding: 0;
			/* Repli 100dvh quand visualViewport manque : on retrouve le comportement d'avant. */
			top: var(--vv-top, 0);
			bottom: auto;
			height: var(--vv-height, 100dvh);
		}
		.qa-palette {
			max-width: none;
			max-height: 100%;
			border-radius: var(--r-lg, 16px) var(--r-lg, 16px) 0 0;
			/* Barre gestuelle iOS : sans ça le dernier élément est sous le trait. */
			padding-bottom: env(safe-area-inset-bottom, 0px);
		}
	}
	@media (pointer: coarse) {
		/* 16px : en dessous, iOS zoome sur le champ au focus et décale toute la mise en page. */
		.qa-input {
			font-size: 16px;
		}
		.qa-item,
		.activity-option {
			min-height: 44px;
			padding-top: 12px;
			padding-bottom: 12px;
		}
		/* Bouton rond : on agrandit la cible, pas la boîte. */
		.qa-chip-remove {
			width: 40px;
			height: 40px;
		}
		.qa-launcher {
			padding-top: 14px;
			padding-bottom: 14px;
		}
	}

	/* Squelette de recherche — reprend l'apparence de .skeleton-bar de tickets/+page.svelte (même
	   dégradé mélangé à --text pour rester visible dans les deux thèmes, même animation). Dupliqué
	   plutôt que partagé : le repo garde ses styles locaux aux composants, et il n'y a pas de
	   feuille commune pour ça. */
	.qa-skel {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px;
	}
	.qa-skel-bar {
		height: 13px;
		border-radius: 5px;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--text) 12%, var(--surface-2)) 25%,
			color-mix(in srgb, var(--text) 26%, var(--surface-2)) 50%,
			color-mix(in srgb, var(--text) 12%, var(--surface-2)) 75%
		);
		background-size: 200% 100%;
		animation: qa-skel-shimmer 1.4s ease-in-out infinite;
	}
	@keyframes qa-skel-shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.qa-skel-bar {
			animation: none;
		}
	}
</style>
