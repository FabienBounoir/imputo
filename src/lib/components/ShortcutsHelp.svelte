<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import KeyIcon, { isKeyName } from '$lib/components/KeyIcon.svelte';
	import { buildCycle } from '$lib/utils/imputationCycle';

	// Aide-mémoire des raccourcis : touche « ? » partout, ou « Raccourcis clavier » dans la palette de
	// commandes (événement `shortcutsopen`). Ceux de la page en cours d'abord, puis ceux valables
	// partout. Liste écrite à la main : un raccourci ajouté ou changé dans CommandPalette,
	// QuickAddPalette, SupportTimePalette, ObjectivePalette, la grille d'imputation (onCellKey) ou
	// Tickets (onGlobalKeydown) se reporte ici.
	let { supportTime }: { supportTime: boolean } = $props();

	/** Une combinaison = suite de touches (nom d'icône KeyIcon, ou texte) ; plusieurs = alternatives. */
	type Shortcut = { keys: string[][]; label: string };

	let open = $state(false);
	let closeBtn: HTMLButtonElement | undefined = $state();
	$effect(() => closeBtn?.focus());

	const MOUSE = new Set(['Clic', 'Clic droit']);
	// Rendu seulement côté client (fenêtre fermée au SSR), donc pas d'écart d'hydratation.
	const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'Cmd' : 'Ctrl';
	const fmt = (n: number) => n.toLocaleString('fr-FR');

	function pageShortcuts(path: string): { title: string; items: Shortcut[] } | null {
		if (path === '/imputation') {
			// Mêmes valeurs que le KEYMAP de la grille (cycle du pas de saisie, 9 touches au plus).
			const values = buildCycle(Number(page.data.imputationStep) || 0.25)
				.filter((v) => v > 0)
				.slice(0, 9);
			return {
				title: 'Mon imputation',
				items: [
					{ keys: [['Clic']], label: 'Valeur suivante dans la case' },
					{ keys: [['shift', 'Clic']], label: 'Valeur précédente' },
					{ keys: [['Clic droit']], label: 'Choisir la valeur dans une liste' },
					{ keys: [[values.length > 1 ? `1–${values.length}` : '1']], label: `Saisir ${values.map(fmt).join(' · ')} j` },
					{ keys: [['0'], ['Suppr']], label: 'Vider la case' },
					{ keys: [['left'], ['right'], ['up'], ['down']], label: "Passer d'une case à l'autre" },
					{ keys: [['left'], ['right']], label: 'Au bord de la grille : période précédente ou suivante' },
					{ keys: [['shift', 'A']], label: 'Ajouter une ligne' }
				]
			};
		}
		if (path === '/tickets')
			return {
				title: 'Tickets & chiffrage',
				items: [
					{ keys: [['shift', 'N']], label: 'Nouveau ticket' },
					{ keys: [['Clic droit']], label: 'Sur un ticket : état, priorité, assignation, copier la clé ou le lien' },
					{ keys: [['Échap']], label: "Fermer la fiche (depuis l'historique : revenir à la fiche)" }
				]
			};
		if (path.startsWith('/dashboard/sprint') || path.startsWith('/dashboard/version'))
			return {
				title: path.startsWith('/dashboard/sprint') ? 'Synthèse par sprint' : 'Synthèse par version',
				items: [{ keys: [['Clic droit']], label: 'Sur un ticket : changer son état, sa priorité…' }]
			};
		if (path === '/admin/objectifs')
			return {
				title: 'Objectifs de la semaine',
				items: [
					{ keys: [['shift', 'A']], label: 'Ajouter un objectif' },
					{ keys: [['tab'], ['shift', 'tabBack']], label: 'Dans la palette : personne suivante ou précédente' }
				]
			};
		if (path === '/wrapped')
			return {
				title: 'Wrapped',
				items: [
					{ keys: [['left'], ['right']], label: 'Écran précédent ou suivant' },
					{ keys: [['Échap']], label: 'Quitter le Wrapped' }
				]
			};
		return null;
	}

	const current = $derived(pageShortcuts(page.url.pathname));
	const global = $derived.by(() => {
		const all: Shortcut[] = [
			{ keys: [[mod, 'K']], label: 'Palette de commandes : chercher, naviguer, agir' },
			{ keys: [['shift', 'N']], label: 'Nouveau ticket' },
			{ keys: [['shift', 'A']], label: 'Ajouter une ligne à Mon imputation' },
			...(supportTime ? [{ keys: [['shift', 'T']], label: 'Saisir du temps de support' }] : []),
			{ keys: [['?']], label: 'Cette aide' },
			{ keys: [['Échap']], label: 'Fermer une fenêtre ou une palette' }
		];
		// Une touche que la page redéfinit (Maj+A sur les objectifs, Échap sur Tickets…) n'apparaît
		// qu'une fois, dans la section de la page : c'est elle qui l'emporte.
		const taken = new Set(current?.items.flatMap((s) => s.keys.map((k) => k.join('+'))));
		return all.filter((s) => !s.keys.some((k) => taken.has(k.join('+'))));
	});

	function isTypingTarget(el: EventTarget | null) {
		if (!(el instanceof HTMLElement)) return false;
		return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
	}
	function onKeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			open = false;
			return;
		}
		// e.key et pas e.code : « ? » n'est pas sur la même touche selon la disposition (Maj+, en AZERTY).
		if (e.key !== '?' || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
		e.preventDefault();
		open = !open;
	}
	onMount(() => {
		const onOpen = () => (open = true);
		window.addEventListener('shortcutsopen', onOpen);
		return () => window.removeEventListener('shortcutsopen', onOpen);
	});
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet combo(keys: string[])}
	{#each keys as k, i (i)}
		{#if i > 0}<span class="plus">+</span>{/if}
		{#if MOUSE.has(k)}<span class="mouse">{k}</span>{:else}<kbd>{#if isKeyName(k)}<KeyIcon name={k} />{:else}{k}{/if}</kbd>{/if}
	{/each}
{/snippet}

{#snippet list(items: Shortcut[])}
	<dl>
		{#each items as s (s.label)}
			<div class="row">
				<dt>
					{#each s.keys as c, i (i)}{#if i > 0}<span class="or">/</span>{/if}{@render combo(c)}{/each}
				</dt>
				<dd>{s.label}</dd>
			</div>
		{/each}
	</dl>
{/snippet}

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="sh-backdrop" onclick={() => (open = false)}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="sh-modal" role="dialog" aria-modal="true" aria-labelledby="sh-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<div class="sh-head">
				<h3 id="sh-title">Raccourcis clavier</h3>
				<button type="button" class="sh-close" bind:this={closeBtn} onclick={() => (open = false)} aria-label="Fermer">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
				</button>
			</div>
			{#if current}
				<h4>{current.title}</h4>
				{@render list(current.items)}
			{/if}
			<h4>Partout</h4>
			{@render list(global)}
		</div>
	</div>
{/if}

<style>
	.sh-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		z-index: 95; /* au-dessus de la palette de commandes (90), d'où on peut l'ouvrir */
	}
	.sh-modal {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
		padding: 20px 22px 22px;
		width: 100%;
		max-width: 540px;
		max-height: calc(100vh - 32px);
		overflow-y: auto;
		outline: none;
	}
	.sh-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	h3 {
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
	}
	.sh-close {
		display: inline-flex;
		padding: 6px;
		border: 0;
		border-radius: var(--r-sm, 6px);
		background: none;
		color: var(--text-soft);
		cursor: pointer;
	}
	.sh-close:hover {
		background: var(--surface-sunk);
		color: var(--text);
	}
	h4 {
		margin: 18px 0 6px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-mute);
	}
	dl {
		margin: 0;
	}
	.row {
		display: grid;
		grid-template-columns: 150px 1fr;
		gap: 12px;
		align-items: center;
		padding: 6px 0;
		border-top: 1px solid var(--border);
	}
	.row:first-child {
		border-top: 0;
	}
	dt {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 3px;
	}
	dd {
		margin: 0;
		font-size: 13.5px;
		color: var(--text);
	}
	/* Même pastille que .op-kbd (ObjectivePalette). */
	kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		height: 20px;
		padding: 0 6px;
		border-radius: 5px;
		border: 1px solid var(--border-strong);
		border-bottom-width: 2px;
		background: var(--surface);
		color: var(--text-soft);
		font: inherit;
		font-size: 11px;
		font-weight: 600;
	}
	kbd :global(svg) {
		width: 11px;
		height: 11px;
	}
	.mouse {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-soft);
	}
	.plus,
	.or {
		font-size: 11px;
		color: var(--text-mute);
	}
	@media (max-width: 480px) {
		.row {
			grid-template-columns: 1fr;
			gap: 4px;
		}
	}
</style>
