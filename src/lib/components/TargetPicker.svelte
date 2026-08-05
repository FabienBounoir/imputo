<script lang="ts">
	// Combobox custom "Ajouter un ticket ou une catégorie" (remplace le <select> natif) :
	// état par défaut = 3-4 tickets suggérés (plus récemment imputés) + catégories complètes ;
	// la recherche filtre en temps réel sur la liste complète des tickets, côté client.
	// `versionId` optionnel : le filtre par version n'apparaît que si l'appelant fournit `versions`
	// (Mon imputation) ; les autres usages (objectifs admin) gardent la liste telle quelle.
	type Ticket = { id: string; key: string; title: string; versionId?: string | null };
	type Category = { id: string; label: string };
	type Version = { id: string; name: string };
	type Objective = {
		id: string;
		kind: 'TICKET' | 'CUSTOM';
		ticketId: string | null;
		ticketKey: string | null;
		ticketTitle: string | null;
		label: string | null;
	};

	let {
		tickets,
		categories,
		recentTicketIds,
		versions = [],
		objectives = [],
		placeholder = 'Ajouter un ticket ou une catégorie…',
		value = $bindable('')
	}: {
		tickets: Ticket[];
		categories: Category[];
		recentTicketIds: string[];
		versions?: Version[];
		objectives?: Objective[];
		placeholder?: string;
		value: string;
	} = $props();

	let open = $state(false);
	let query = $state('');
	let versionFilter = $state('');
	let root: HTMLDivElement | null = $state(null);
	let panelEl: HTMLDivElement | null = $state(null);
	let searchInput: HTMLInputElement | null = $state(null);
	// position:fixed calculée au clic — le trigger vit dans une card à overflow:hidden qui
	// rognerait un panneau en position:absolute.
	let panelPos = $state({ top: 0, left: 0, width: 320, maxHeight: 380 });

	const suggested = $derived(
		recentTicketIds.map((id) => tickets.find((t) => t.id === id)).filter((t): t is Ticket => !!t)
	);
	// Un filtre version actif remplace les suggestions récentes par toute la version : sinon, sans
	// recherche texte, on continuerait d'afficher 4 tickets hors version et le filtre paraîtrait mort.
	const filteredTickets = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const base = versionFilter ? tickets.filter((t) => t.versionId === versionFilter) : tickets;
		if (!q) return versionFilter ? base : suggested;
		return base.filter((t) => t.key.toLowerCase().includes(q) || t.title.toLowerCase().includes(q));
	});
	const selectedLabel = $derived.by(() => {
		if (!value) return '';
		const [type, id] = value.split('::');
		if (type === 'TICKET') {
			const t = tickets.find((x) => x.id === id);
			return t ? `${t.key} — ${t.title}` : '';
		}
		if (type === 'OBJECTIVE') {
			const o = objectives.find((x) => x.id === id);
			return o?.label ?? '';
		}
		const c = categories.find((x) => x.id === id);
		return c?.label ?? '';
	});

	const PANEL_GAP = 6;
	const PANEL_H = 380;
	const PANEL_MIN_H = 160;

	function toggle() {
		if (!open && root) {
			const r = root.getBoundingClientRect();
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const spaceBelow = vh - r.bottom - PANEL_GAP;
			const spaceAbove = r.top - PANEL_GAP;
			// Pas assez de place sous le trigger (ex. dernière ligne d'un tableau) : on ouvre vers le
			// haut si ça laisse plus de place, sinon on garde en bas et on rogne juste la hauteur.
			const openUp = spaceBelow < PANEL_MIN_H && spaceAbove > spaceBelow;
			const maxHeight = Math.max(PANEL_MIN_H, Math.min(PANEL_H, openUp ? spaceAbove : spaceBelow));
			const width = Math.min(Math.max(r.width, 320), vw - 16);
			panelPos = {
				top: openUp ? r.top - PANEL_GAP - maxHeight : r.bottom + PANEL_GAP,
				left: Math.min(Math.max(8, r.left), vw - width - 8),
				width,
				maxHeight
			};
		}
		open = !open;
		if (open) queueMicrotask(() => searchInput?.focus());
	}
	function pick(v: string) {
		value = v;
		open = false;
		query = '';
	}
	function onWindowClick(e: MouseEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}
	// Écoute en phase de capture : un scroll dans un conteneur imbriqué (ex. la zone
	// principale scrollable) ne bubble pas jusqu'à window, seule la capture le voit.
	// Le panneau lui-même passe par window en phase de capture (il est dans le DOM sous root) —
	// sans l'exclure, le moindre scroll de sa propre liste le refermait aussitôt.
	$effect(() => {
		if (!open) return;
		const onScroll = (e: Event) => {
			if (panelEl && e.target instanceof Node && panelEl.contains(e.target)) return;
			open = false;
		};
		window.addEventListener('scroll', onScroll, true);
		return () => window.removeEventListener('scroll', onScroll, true);
	});
</script>

<svelte:window onclick={onWindowClick} />

<div class="tp-root" bind:this={root}>
	<button type="button" class="tp-trigger" class:placeholder={!selectedLabel} onclick={toggle} aria-haspopup="listbox" aria-expanded={open}>
		<span class="tp-trigger-text">{selectedLabel || placeholder}</span>
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6" /></svg>
	</button>
	{#if open}
		<div
			class="tp-panel"
			role="listbox"
			bind:this={panelEl}
			style="top:{panelPos.top}px; left:{panelPos.left}px; width:{panelPos.width}px; max-height:{panelPos.maxHeight}px;"
		>
			<div class="tp-row">
				<input
					bind:this={searchInput}
					class="tp-search"
					type="text"
					placeholder="Rechercher un ticket (clé ou titre)…"
					bind:value={query}
					onkeydown={(e) => e.key === 'Escape' && (open = false)}
				/>
				{#if versions.length > 0}
					<select class="tp-version" bind:value={versionFilter} aria-label="Filtrer par version">
						<option value="">Toutes versions</option>
						{#each versions as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
					</select>
				{/if}
			</div>
			{#if objectives.length > 0 && !query.trim() && !versionFilter}
				<div class="tp-section">
					<div class="tp-label">🎯 Attribué cette semaine</div>
					{#each objectives as o (o.id)}
						{#if o.kind === 'TICKET' && o.ticketId}
							<button type="button" class="tp-item" onclick={() => pick(`TICKET::${o.ticketId}`)}>
								<span class="tp-key">{o.ticketKey}</span><span class="tp-title">{o.ticketTitle}</span>
							</button>
						{:else if o.kind === 'CUSTOM'}
							<button type="button" class="tp-item" onclick={() => pick(`OBJECTIVE::${o.id}`)}>
								<span class="tp-title">{o.label}</span>
							</button>
						{/if}
					{/each}
				</div>
			{/if}
			<div class="tp-section">
				<div class="tp-label">{query.trim() || versionFilter ? 'Tickets' : 'Suggestions'}</div>
				{#each filteredTickets as t (t.id)}
					<button type="button" class="tp-item" onclick={() => pick(`TICKET::${t.id}`)}>
						<span class="tp-key">{t.key}</span><span class="tp-title">{t.title}</span>
					</button>
				{/each}
				{#if filteredTickets.length === 0}<div class="tp-empty">Aucun ticket.</div>{/if}
			</div>
			{#if categories.length > 0}
				<div class="tp-section">
					<div class="tp-label">Catégories</div>
					{#each categories as c (c.id)}
						<button type="button" class="tp-item" onclick={() => pick(`CATEGORY::${c.id}`)}>{c.label}</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.tp-root {
		position: relative;
		flex: 1;
	}
	.tp-trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		padding: 8px 11px;
		border-radius: var(--r-sm, 8px);
		border: 1px solid var(--border);
		background: var(--surface-2, var(--surface));
		color: var(--text);
		font-size: 13px;
		text-align: left;
	}
	.tp-trigger.placeholder {
		color: var(--text-mute);
	}
	.tp-trigger-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tp-trigger svg {
		flex-shrink: 0;
		color: var(--text-mute);
	}
	.tp-panel {
		position: fixed;
		z-index: 30;
		overflow-y: auto;
		border-radius: var(--r-md, 10px);
		border: 1px solid var(--border);
		background: var(--surface);
		box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
		padding: 8px;
	}
	.tp-row {
		display: flex;
		gap: 6px;
		margin-bottom: 8px;
	}
	.tp-search {
		flex: 1;
		min-width: 0;
		padding: 8px 10px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2, var(--surface));
		color: var(--text);
		font-size: 13px;
	}
	.tp-version {
		flex: 0 0 auto;
		max-width: 40%;
		padding: 7px 8px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2, var(--surface));
		color: var(--text);
		font-size: 12.5px;
	}
	.tp-section + .tp-section {
		margin-top: 10px;
		padding-top: 8px;
		border-top: 1px solid var(--border);
	}
	.tp-label {
		font-size: 10.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-mute);
		padding: 2px 6px 6px;
	}
	.tp-item {
		display: flex;
		align-items: baseline;
		gap: 8px;
		width: 100%;
		padding: 7px 8px;
		border-radius: 8px;
		font-size: 13px;
		color: var(--text);
		text-align: left;
	}
	.tp-item:hover {
		background: var(--accent-tint, var(--surface-2));
	}
	.tp-key {
		flex-shrink: 0;
		font-weight: 600;
		color: var(--text-soft);
		font-variant-numeric: tabular-nums;
	}
	.tp-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tp-empty {
		padding: 8px;
		font-size: 12px;
		color: var(--text-mute);
	}
</style>
