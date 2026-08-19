<script lang="ts">
	// Sélecteur de code SSP (remplace l'ancien <input> texte libre). La recherche porte à la fois
	// sur le code et sur le libellé : personne ne retient « 8364BEB5354 », mais tout le monde
	// reconnaît « Site Internet » — et l'inverse est vrai pour qui recopie depuis un fichier compta.
	// `name` : rend un input caché, pour un usage dans un <form> classique (création de ticket).
	// Sinon on se contente de `bind:value` + `onpick` (édition inline, sauvegarde au fil de l'eau).
	type Ssp = { id: string; code: string; label: string };

	let {
		ssps,
		value = $bindable(''),
		name = '',
		placeholder = 'Aucun code SSP',
		onpick = undefined
	}: {
		ssps: Ssp[];
		/** Non lié dans un <form> : le champ caché `name` porte alors la valeur. */
		value?: string;
		name?: string;
		placeholder?: string;
		onpick?: (id: string) => void;
	} = $props();

	let open = $state(false);
	let query = $state('');
	let root: HTMLDivElement | null = $state(null);
	let panelEl: HTMLDivElement | null = $state(null);
	let searchInput: HTMLInputElement | null = $state(null);
	// position:fixed calculée au clic — même raison que TargetPicker : le trigger vit souvent dans
	// une card ou une cellule de tableau qui rognerait un panneau en position:absolute.
	let panelPos = $state({ top: 0, left: 0, width: 300, maxHeight: 320 });

	const selected = $derived(ssps.find((s) => s.id === value) ?? null);
	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return ssps;
		return ssps.filter((s) => s.code.toLowerCase().includes(q) || s.label.toLowerCase().includes(q));
	});

	const PANEL_GAP = 6;
	const PANEL_H = 320;
	const PANEL_MIN_H = 140;

	function toggle() {
		if (!open && root) {
			const r = root.getBoundingClientRect();
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const spaceBelow = vh - r.bottom - PANEL_GAP;
			const spaceAbove = r.top - PANEL_GAP;
			const openUp = spaceBelow < PANEL_MIN_H && spaceAbove > spaceBelow;
			const maxHeight = Math.max(PANEL_MIN_H, Math.min(PANEL_H, openUp ? spaceAbove : spaceBelow));
			const width = Math.min(Math.max(r.width, 300), vw - 16);
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
	function pick(id: string) {
		value = id;
		open = false;
		query = '';
		onpick?.(id);
	}
	function onWindowClick(e: MouseEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}
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

<div class="sp-root" bind:this={root}>
	{#if name}<input type="hidden" {name} {value} />{/if}
	<button
		type="button"
		class="sp-trigger"
		class:placeholder={!selected}
		onclick={toggle}
		aria-haspopup="listbox"
		aria-expanded={open}
	>
		<span class="sp-trigger-text">
			{#if selected}{selected.label}<span class="sp-code">{selected.code}</span>{:else}{placeholder}{/if}
		</span>
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6" /></svg>
	</button>
	{#if open}
		<div
			class="sp-panel"
			role="listbox"
			bind:this={panelEl}
			style="top:{panelPos.top}px; left:{panelPos.left}px; width:{panelPos.width}px; max-height:{panelPos.maxHeight}px;"
		>
			<input
				bind:this={searchInput}
				class="sp-search"
				type="text"
				placeholder="Rechercher par code ou libellé…"
				bind:value={query}
				onkeydown={(e) => e.key === 'Escape' && (open = false)}
			/>
			<button type="button" class="sp-item sp-none" onclick={() => pick('')}>— Aucun —</button>
			{#each filtered as s (s.id)}
				<button type="button" class="sp-item" class:sel={s.id === value} onclick={() => pick(s.id)}>
					<span class="sp-item-label">{s.label}</span><span class="sp-code">{s.code}</span>
				</button>
			{/each}
			{#if filtered.length === 0}
				<div class="sp-empty">
					{ssps.length === 0
						? 'Aucun code SSP — à créer dans Administration › Référentiels.'
						: 'Aucun code ne correspond.'}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.sp-root {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.sp-trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		padding: 6px 9px;
		border-radius: var(--r-sm, 8px);
		border: 1px solid var(--border);
		background: var(--surface-2, var(--surface));
		color: var(--text);
		font-size: 13px;
		text-align: left;
	}
	.sp-trigger.placeholder {
		color: var(--text-mute);
	}
	.sp-trigger-text {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sp-trigger svg {
		flex-shrink: 0;
		color: var(--text-mute);
	}
	.sp-panel {
		position: fixed;
		z-index: 30;
		overflow-y: auto;
		border-radius: var(--r-md, 10px);
		border: 1px solid var(--border);
		background: var(--surface);
		box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
		padding: 8px;
	}
	.sp-search {
		width: 100%;
		padding: 8px 10px;
		margin-bottom: 8px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2, var(--surface));
		color: var(--text);
		font-size: 13px;
	}
	.sp-item {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		padding: 7px 8px;
		border-radius: 8px;
		font-size: 13px;
		color: var(--text);
		text-align: left;
	}
	.sp-item:hover {
		background: var(--accent-tint, var(--surface-2));
	}
	.sp-item.sel {
		background: var(--accent-tint, var(--surface-2));
		font-weight: 600;
	}
	.sp-none {
		color: var(--text-mute);
	}
	.sp-item-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sp-code {
		flex-shrink: 0;
		font-size: 11px;
		color: var(--text-mute);
		font-variant-numeric: tabular-nums;
	}
	.sp-empty {
		padding: 8px;
		font-size: 12px;
		color: var(--text-mute);
	}
</style>
