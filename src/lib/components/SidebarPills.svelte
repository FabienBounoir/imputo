<script lang="ts">
	import { onMount } from 'svelte';
	import { backOut } from 'svelte/easing';
	import { page } from '$app/state';

	/**
	 * Pastilles « à faire » au-dessus de la carte du compte : n'existent que s'il y a quelque chose à
	 * faire, jamais une ligne de menu permanente (liste calculée dans +layout.server.ts). Plusieurs
	 * sujets s'empilent en cartes décalées qui se déploient au survol, au focus clavier, ou au premier
	 * tap sur un écran tactile (pas de survol).
	 * ponytail: pas d'icône par sujet tant qu'il n'y en a qu'un (RAE) ; ajouter un champ `icon` au 2e.
	 */
	type Pill = { href: string; label: string; count: number; tone?: 'warn' };
	let { pills }: { pills: Pill[] } = $props();

	let open = $state(false);
	const stacked = $derived(pills.length > 1);

	// Apparition façon notification, quelques secondes après l'ouverture de l'app (le layout ne se
	// remonte pas d'une page à l'autre : une seule fois par chargement). Le groupe sort de derrière la
	// carte du compte (.user-card passe devant, cf. app.css) en grandissant, avec un léger rebond ; même
	// animation à l'envers quand il ne reste plus rien à faire.
	const APPEAR_DELAY_MS = 1200;
	let ready = $state(false);
	onMount(() => {
		const t = setTimeout(() => (ready = true), APPEAR_DELAY_MS);
		return () => clearTimeout(t);
	});

	function emerge(node: HTMLElement) {
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { duration: 0 };
		// Hauteur du groupe + écart de .side-foot (12 px) : au départ, entièrement caché par la carte.
		const hidden = node.offsetHeight + 12;
		return {
			duration: 550,
			easing: backOut,
			css: (t: number, u: number) =>
				`transform-origin: 50% 100%; transform: translateY(${u * hidden}px) scale(${0.8 + 0.2 * t}); opacity: ${Math.min(1, t * 2)};`
		};
	}

	// Referme la pile à chaque navigation (le tiroir mobile se ferme aussi, cf. +layout.svelte).
	$effect(() => {
		page.url.pathname;
		open = false;
	});

	function onPillClick(e: MouseEvent) {
		// Écran tactile : le premier tap déploie la pile au lieu d'ouvrir la carte du dessus.
		if (stacked && !open && matchMedia('(hover: none)').matches) {
			e.preventDefault();
			open = true;
		}
	}
</script>

{#if ready && pills.length}
	<nav
		transition:emerge
		class="todo"
		class:stacked
		class:open
		style="--count: {pills.length}"
		aria-label="À faire"
		onmouseleave={() => (open = false)}
	>
		{#each pills as pill, i (pill.href)}
			<a
				class="todo-pill"
				class:warn={pill.tone === 'warn'}
				href={pill.href}
				style="--i: {i}"
				aria-current={page.url.pathname === pill.href ? 'page' : undefined}
				onclick={onPillClick}
			>
				<span class="label">{pill.label}</span>
				<span class="n">{pill.count}</span>
			</a>
		{/each}
	</nav>
{/if}

<style>
	.todo {
		/* Contexte d'empilement propre : les z-index des cartes restent internes au groupe, qui passe
		   donc tout entier sous .user-card pendant l'apparition. */
		position: relative;
		z-index: 0;
		display: grid;
		/* Place pour les cartes qui dépassent au-dessus de celle du dessus. */
		padding-top: calc((var(--count) - 1) * 6px);
	}
	.todo-pill {
		grid-area: 1 / 1;
		position: relative;
		z-index: calc(10 - var(--i));
		display: flex;
		align-items: center;
		gap: 8px;
		height: 38px;
		padding: 0 9px 0 12px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
		color: var(--text);
		font-size: 13px;
		font-weight: 600;
		text-decoration: none;
		transition: transform 0.22s ease;
	}
	/* Pont invisible sous chaque carte : sans lui, l'espace entre deux cartes déployées fait perdre le
	   survol et referme la pile pendant qu'on vise la carte suivante. */
	.todo-pill::after {
		content: '';
		position: absolute;
		inset: 100% 0 -8px;
	}
	.todo-pill:hover {
		border-color: var(--border-strong);
	}
	.todo-pill.warn {
		border-color: color-mix(in srgb, var(--warn) 35%, var(--border));
		background: var(--warn-tint);
		color: var(--warn);
	}
	.todo-pill.warn:hover {
		border-color: var(--warn);
	}
	.todo-pill[aria-current='page'] {
		box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 30%, transparent);
	}
	.n {
		margin-left: auto;
		min-width: 22px;
		padding: 1px 7px;
		border-radius: 999px;
		text-align: center;
		font-size: 11px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		background: var(--surface-sunk);
		color: var(--text-soft);
	}
	.warn .n {
		background: var(--warn);
		color: var(--surface);
	}

	/* Pile : les cartes suivantes dépassent de 6 px au-dessus, un peu réduites, contenu masqué. */
	.stacked .todo-pill {
		transform: translateY(calc(var(--i) * -6px)) scale(calc(1 - var(--i) * 0.05));
	}
	.stacked .todo-pill:not(:first-child) > * {
		opacity: 0;
		transition: opacity 0.15s;
	}
	/* Déployée : chaque carte remonte d'une hauteur de carte + 6 px. */
	.stacked:is(:hover, :focus-within, .open) .todo-pill {
		transform: translateY(calc(var(--i) * -44px));
	}
	.stacked:is(:hover, :focus-within, .open) .todo-pill > * {
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.todo-pill,
		.todo-pill > * {
			transition: none;
		}
	}
</style>
