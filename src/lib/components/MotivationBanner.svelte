<script lang="ts">
	import { slide } from 'svelte/transition';

	// Bandeau de citations du jour : une phrase toutes les 30 s, croisé-fondu + léger glissement.
	// Le timer se met en pause au survol (le temps de finir une phrase longue) et quand l'onglet
	// n'est pas visible — sinon on revient sur l'onglet au milieu d'une transition. Un clic (ou
	// Entrée/Espace, le bandeau est un vrai <button>) passe à la phrase suivante.
	let { quotes }: { quotes: string[] } = $props();

	const ROTATE_MS = 30_000;
	let index = $state(0);
	let paused = $state(false);

	function next() {
		if (quotes.length > 1) index = (index + 1) % quotes.length;
	}

	$effect(() => {
		// `index` est lu volontairement : un clic relance un cycle complet de 30 s, plutôt que de
		// laisser la phrase suivante arriver sur le reliquat du minuteur en cours.
		index;
		if (quotes.length < 2 || paused) return;
		const id = setInterval(() => {
			if (document.visibilityState === 'visible') next();
		}, ROTATE_MS);
		return () => clearInterval(id);
	});
</script>

{#if quotes.length}
	<button
		type="button"
		class="mb"
		title="Phrase suivante"
		aria-label="Phrase suivante"
		onclick={next}
		onmouseenter={() => (paused = true)}
		onmouseleave={() => (paused = false)}
		transition:slide={{ duration: 200 }}
	>
		<span class="slot" role="status" aria-live="polite">
			{#key index}
				<span class="quote">
					<svg class="spark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M12 2.5c.3 0 .55.2.63.48l1.1 3.86a3.5 3.5 0 0 0 2.43 2.43l3.86 1.1a.65.65 0 0 1 0 1.26l-3.86 1.1a3.5 3.5 0 0 0-2.43 2.43l-1.1 3.86a.65.65 0 0 1-1.26 0l-1.1-3.86a3.5 3.5 0 0 0-2.43-2.43l-3.86-1.1a.65.65 0 0 1 0-1.26l3.86-1.1a3.5 3.5 0 0 0 2.43-2.43l1.1-3.86A.65.65 0 0 1 12 2.5Z"/>
						<path d="M18.5 2.5c.13 0 .25.09.29.22l.42 1.35c.09.28.31.5.59.59l1.35.42a.3.3 0 0 1 0 .58l-1.35.42a.94.94 0 0 0-.59.59l-.42 1.35a.3.3 0 0 1-.58 0l-.42-1.35a.94.94 0 0 0-.59-.59l-1.35-.42a.3.3 0 0 1 0-.58l1.35-.42c.28-.09.5-.31.59-.59l.42-1.35a.3.3 0 0 1 .29-.22Z"/>
					</svg>{quotes[index]}
				</span>
			{/key}
		</span>
	</button>
{/if}

<style>
	.mb {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		width: 100%;
		padding: 10px 30px;
		color: var(--accent-ink);
		background: var(--accent-tint);
		border-bottom: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
		overflow: hidden;
	}
	.mb:hover {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
	}
	/* Hauteur d'une ligne réservée : l'ancienne et la nouvelle phrase se superposent le temps du
	   croisé-fondu, sans faire sauter le contenu de la page. */
	.slot {
		position: relative;
		display: block;
		min-width: 0;
		height: 18px;
		flex: 1 1 auto;
		max-width: 900px;
	}
	.quote {
		position: absolute;
		inset: 0;
		display: block;
		font-size: 13px;
		font-weight: 500;
		font-style: italic;
		line-height: 18px;
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		animation: quote-in 700ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	/* Étincelle en SVG (et pas en emoji) pour suivre la couleur d'accent du texte. */
	.spark {
		width: 14px;
		height: 14px;
		margin-right: 8px;
		vertical-align: -2px;
		opacity: 0.75;
	}
	/* La phrase sortante n'existe plus dans le DOM (#key la remplace) : on simule le croisé en
	   faisant entrer la nouvelle depuis le bas avec un flou qui se dissipe. */
	@keyframes quote-in {
		from {
			opacity: 0;
			transform: translateY(0.7em) scale(0.98);
			filter: blur(4px);
		}
		to {
			opacity: 1;
			transform: none;
			filter: blur(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.quote {
			animation: none;
		}
	}
	@media (max-width: 700px) {
		.mb {
			padding: 8px 14px;
		}
	}
</style>
