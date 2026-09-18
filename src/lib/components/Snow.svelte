<script lang="ts">
	import { randomParticles } from '$lib/particles';

	// Trois formes de flocon en SVG plutôt qu'une pastille floue : un cristal à six branches
	// barbelées pour les gros, une étoile nue pour les moyens, un hexagone plein pour les petits
	// (à 10 px un cristal ne serait qu'une tache). La taille décide de la forme, donc les flocons
	// lointains sont naturellement les plus simples.
	const BRANCH = 'M12 12V2.6M12 6.4L14.2 4.2M12 6.4L9.8 4.2M12 9.6L13.7 7.9M12 9.6L10.3 7.9';
	const ARM = 'M12 12V2.6';
	const HEX = 'M12 6.5l4.8 2.75v5.5L12 17.5l-4.8-2.75v-5.5z';
	const ANGLES = [0, 60, 120, 180, 240, 300];

	// Un vrai flocon ne tombe pas droit : il louvoie, ralentit, repart de l'autre côté. Les petits
	// (les plus légers, et les plus lointains) louvoient le plus large et descendent le plus
	// lentement ; les gros tombent presque droit. D'où sway et durée indexés sur la taille.
	const FLAKES = randomParticles(45, [10, 22]).map((p) => {
		const dir = Math.random() < 0.5 ? 1 : -1;
		return {
			...p,
			duration: p.duration * 2 * (1.25 - p.size / 60), // ~17 à 32 s pour traverser l'écran
			kind: p.size < 13 ? 'pellet' : p.size < 17 ? 'star' : 'crystal',
			sway: Math.round(dir * (6 + (24 - p.size) * (0.5 + Math.random()))),
			spin: Math.round((Math.random() - 0.5) * 540)
		};
	});
</script>

<div class="snow" aria-hidden="true">
	{#each FLAKES as f, i (i)}
		<svg
			class="flake"
			viewBox="0 0 24 24"
			width={f.size}
			height={f.size}
			style="left:{f.left}%; animation-delay:{f.delay}s; animation-duration:{f.duration}s; opacity:{f.opacity}; --drift:{f.drift}px; --sway:{f.sway}px; --spin:{f.spin}deg;"
		>
			{#if f.kind === 'pellet'}
				<path d={HEX} fill="currentColor" />
			{:else}
				<g stroke="currentColor" stroke-width={f.kind === 'crystal' ? 1.5 : 1.9} stroke-linecap="round" fill="none">
					{#each ANGLES as a (a)}
						<path d={f.kind === 'crystal' ? BRANCH : ARM} transform="rotate({a} 12 12)" />
					{/each}
				</g>
			{/if}
		</svg>
	{/each}
</div>

<style>
	.snow {
		position: fixed;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		z-index: 60;
		contain: strict;
		/* Une seule couleur à basculer : les formes héritent toutes via currentColor.
		   Blanc sur fond sombre, bleu-gris sur fond clair (du blanc y serait invisible). */
		color: #8fa2b8;
	}
	:global([data-theme='dark']) .snow {
		color: #eaf3fd;
	}
	.flake {
		position: absolute;
		top: -24px;
		animation-name: fall;
		/* ease-in-out s'applique à CHAQUE segment de la keyframe : le flocon ralentit en bout de
		   course latérale puis repart, ce qui donne le battement d'un vrai flocon plutôt qu'une
		   descente à vitesse constante. */
		animation-timing-function: ease-in-out;
		animation-iteration-count: infinite;
		will-change: transform;
		transform: translateZ(0);
	}
	/* Louvoiement gauche/droite d'amplitude décroissante, paliers verticaux irréguliers et
	   rotation qui n'avance pas linéairement : trois irrégularités qui suffisent à ne plus lire
	   comme une chute mécanique. Tout passe par un seul transform, donc rien ne sort du
	   compositeur GPU. */
	@keyframes fall {
		0% {
			transform: translate3d(0, 0, 0) rotate(0deg);
		}
		18% {
			transform: translate3d(var(--sway), 19vh, 0) rotate(calc(var(--spin) * 0.3));
		}
		37% {
			transform: translate3d(calc(var(--sway) * -0.75), 40vh, 0) rotate(calc(var(--spin) * 0.42));
		}
		58% {
			transform: translate3d(calc(var(--sway) * 0.95), 62vh, 0) rotate(calc(var(--spin) * 0.72));
		}
		79% {
			transform: translate3d(calc(var(--sway) * -0.45), 83vh, 0) rotate(calc(var(--spin) * 0.86));
		}
		100% {
			transform: translate3d(var(--drift), 106vh, 0) rotate(var(--spin));
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.snow {
			display: none;
		}
	}
</style>
