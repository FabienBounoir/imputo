<script lang="ts">
	// Select à choix multiples : une ligne (comme un <select> classique) qui affiche les valeurs
	// choisies, et qui ouvre au clic un panneau en dessous pour cocher/décocher — chaque clic sur une
	// option toggle immédiatement (pas de bouton "valider"), même logique que les chips qu'il remplace.
	// position:fixed calculée au clic (cf. TargetPicker.svelte) : le champ peut vivre dans une modal
	// scrollable, un panneau en position:absolute serait rogné par l'overflow du conteneur.
	type Option = { id: string; name: string };

	let {
		options,
		selectedIds,
		onToggle,
		ariaLabel,
		placeholder = '—'
	}: {
		options: Option[];
		selectedIds: string[];
		onToggle: (id: string) => void;
		ariaLabel: string;
		placeholder?: string;
	} = $props();

	let open = $state(false);
	let root: HTMLDivElement | null = $state(null);
	let panelEl: HTMLDivElement | null = $state(null);
	let panelPos = $state({ top: 0, left: 0, width: 220, maxHeight: 260 });

	const selectedLabel = $derived(
		options
			.filter((o) => selectedIds.includes(o.id))
			.map((o) => o.name)
			.join(', ')
	);

	const PANEL_GAP = 6;
	const PANEL_H = 260;
	const PANEL_MIN_H = 120;

	function toggleOpen() {
		if (!open && root) {
			const r = root.getBoundingClientRect();
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const spaceBelow = vh - r.bottom - PANEL_GAP;
			const spaceAbove = r.top - PANEL_GAP;
			// Pas assez de place sous le trigger : on ouvre vers le haut si ça laisse plus de place,
			// sinon on garde en bas et on rogne juste la hauteur.
			const openUp = spaceBelow < PANEL_MIN_H && spaceAbove > spaceBelow;
			const maxHeight = Math.max(PANEL_MIN_H, Math.min(PANEL_H, openUp ? spaceAbove : spaceBelow));
			const width = Math.max(r.width, 200);
			panelPos = {
				top: openUp ? r.top - PANEL_GAP - maxHeight : r.bottom + PANEL_GAP,
				left: Math.min(Math.max(8, r.left), vw - width - 8),
				width,
				maxHeight
			};
		}
		open = !open;
	}
	function onWindowClick(e: MouseEvent) {
		if (!open || !root) return;
		if (root.contains(e.target as Node)) return;
		if (panelEl?.contains(e.target as Node)) return;
		open = false;
	}
	// Un scroll dans un conteneur imbriqué (ex. la modal scrollable) ne bubble pas jusqu'à window,
	// seule la capture le voit — sans ça le panneau resterait affiché ailleurs qu'à l'écran.
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

<div class="msel-root" bind:this={root}>
	<button
		type="button"
		class="msel-trigger"
		class:placeholder={!selectedLabel}
		onclick={toggleOpen}
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-label={ariaLabel}
	>
		<span class="msel-trigger-text">{selectedLabel || placeholder}</span>
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6" /></svg>
	</button>
	{#if open}
		<div
			class="msel-panel"
			role="listbox"
			aria-label={ariaLabel}
			bind:this={panelEl}
			style="top:{panelPos.top}px; left:{panelPos.left}px; width:{panelPos.width}px; max-height:{panelPos.maxHeight}px;"
		>
			{#each options as o (o.id)}
				<button type="button" class="msel-item" class:on={selectedIds.includes(o.id)} onclick={() => onToggle(o.id)}>
					<span class="msel-check">✓</span>
					<span class="msel-name">{o.name}</span>
				</button>
			{/each}
			{#if options.length === 0}<div class="msel-empty">Aucune option.</div>{/if}
		</div>
	{/if}
</div>

<style>
	.msel-root {
		position: relative;
		width: 100%;
	}
	/* Réplique le style de .cell-select (TicketEditModal.svelte/tickets/+page.svelte) — les styles
	   scoped d'un parent ne s'appliquent pas aux éléments rendus par un composant enfant en Svelte,
	   donc ce composant doit porter son propre style plutôt que compter sur la classe `cell-select`. */
	.msel-trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		width: 100%;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 7px;
		padding: 6px 7px;
		font: inherit;
		font-size: 13.5px;
		color: var(--text);
		text-align: left;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}
	.msel-trigger:hover {
		border-color: var(--border-strong);
	}
	.msel-trigger:focus-visible {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
		outline: none;
	}
	.msel-trigger.placeholder .msel-trigger-text {
		color: var(--text-mute);
	}
	.msel-trigger-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.msel-trigger svg {
		flex-shrink: 0;
		color: var(--text-mute);
	}
	.msel-panel {
		position: fixed;
		z-index: 60;
		overflow-y: auto;
		border-radius: var(--r-md, 10px);
		border: 1px solid var(--border);
		background: var(--surface);
		box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
		padding: 6px;
	}
	.msel-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 8px;
		border-radius: 8px;
		font-size: 13px;
		color: var(--text);
		text-align: left;
	}
	.msel-item:hover {
		background: var(--accent-tint, var(--surface-2));
	}
	.msel-check {
		flex-shrink: 0;
		width: 14px;
		color: var(--accent);
		visibility: hidden;
	}
	.msel-item.on .msel-check {
		visibility: visible;
	}
	.msel-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.msel-empty {
		padding: 8px;
		font-size: 12px;
		color: var(--text-mute);
	}
</style>
