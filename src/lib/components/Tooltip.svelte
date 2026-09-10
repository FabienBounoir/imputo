<script lang="ts">
	// Bulle custom au survol — remplace le title natif du navigateur là où son rendu générique
	// détonne (ex. avatar d'assigné, tableau/kanban tickets).
	//
	// `position: fixed` calculée au survol, et non `absolute` : le déclencheur vit dans des
	// conteneurs qui défilent (.kcards du kanban, .tk-scroll du tableau), et une bulle en `absolute`
	// s'y faisait rogner — les noms sortaient de la carte et étaient coupés. Même parade que
	// TargetPicker/SspPicker, qui positionnent leur panneau de la même façon et pour la même raison.
	import type { Snippet } from 'svelte';

	let { text, children }: { text: string; children: Snippet } = $props();

	/** Écart entre la bulle et le déclencheur, flèche comprise. */
	const GAP = 7;
	/** Marge minimale aux bords de l'écran, pour qu'une bulle large reste lisible en bout de colonne. */
	const EDGE = 60;

	let wrap: HTMLSpanElement | null = $state(null);
	let pos = $state<{ top: number; left: number; below: boolean } | null>(null);

	function show() {
		if (!text || !wrap) return;
		const r = wrap.getBoundingClientRect();
		// Au-dessus par défaut ; basculée en dessous quand il n'y a pas la place (première carte
		// d'une colonne, ligne en haut d'un tableau).
		const below = r.top < 44;
		pos = {
			top: below ? r.bottom + GAP : r.top - GAP,
			left: Math.min(Math.max(r.left + r.width / 2, EDGE), window.innerWidth - EDGE),
			below
		};
	}
	function hide() {
		pos = null;
	}

	// Un défilement laisserait la bulle en place pendant que sa carte s'en va : on la referme.
	// Écoute en capture — le défilement d'un conteneur imbriqué ne remonte pas jusqu'à window
	// (même raison que dans TargetPicker).
	$effect(() => {
		if (!pos) return;
		window.addEventListener('scroll', hide, true);
		return () => window.removeEventListener('scroll', hide, true);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- Enveloppe passive : elle ne fait qu'entourer le déclencheur pour le mesurer. Lui donner un rôle
     ARIA en ferait un élément à part entière dans l'arbre d'accessibilité, alors que l'information
     est déjà portée par l'enfant (UserAvatar a son propre libellé). Le survol est un confort à la
     souris ; au clavier, focusin/focusout couvrent le même besoin sans rôle supplémentaire. -->
<span
	class="tt-wrap"
	bind:this={wrap}
	onmouseenter={show}
	onmouseleave={hide}
	onfocusin={show}
	onfocusout={hide}
>
	{@render children()}
	{#if text && pos}
		<span class="tt-bubble" class:below={pos.below} role="tooltip" style="top:{pos.top}px; left:{pos.left}px;">
			{text}
		</span>
	{/if}
</span>

<style>
	.tt-wrap {
		display: inline-flex;
	}
	.tt-bubble {
		position: fixed;
		/* translateY(-100%) : `top` porte le BAS de la bulle quand elle est au-dessus du déclencheur. */
		transform: translateX(-50%) translateY(-100%);
		white-space: nowrap;
		background: var(--text);
		color: var(--surface);
		font-size: 11.5px;
		font-weight: 600;
		padding: 5px 9px;
		border-radius: var(--r-sm);
		box-shadow: var(--shadow-md);
		pointer-events: none;
		/* Au-dessus des panneaux flottants du même écran (menu contextuel kanban à 40). */
		z-index: 50;
		animation: tt-in 0.12s ease-out both;
	}
	.tt-bubble.below {
		transform: translateX(-50%);
	}
	@keyframes tt-in {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(calc(-100% + 2px));
		}
	}
	.tt-bubble.below {
		animation-name: tt-in-below;
	}
	@keyframes tt-in-below {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(-2px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.tt-bubble {
			animation: none;
		}
	}
	.tt-bubble::after {
		content: '';
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%);
		border: 5px solid transparent;
		border-top-color: var(--text);
	}
	/* Bulle sous le déclencheur : la flèche passe au-dessus et se retourne. */
	.tt-bubble.below::after {
		top: auto;
		bottom: 100%;
		border-top-color: transparent;
		border-bottom-color: var(--text);
	}
</style>
