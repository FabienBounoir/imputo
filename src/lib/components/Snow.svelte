<script lang="ts">
	import { randomParticles } from '$lib/particles';
	const FLAKES = randomParticles(45, [6, 16]);
</script>

<div class="snow" aria-hidden="true">
	{#each FLAKES as f, i (i)}
		<span
			class="flake"
			style="left:{f.left}%; animation-delay:{f.delay}s; animation-duration:{f.duration}s; width:{f.size}px; height:{f.size}px; opacity:{f.opacity}; --drift:{f.drift}px;"
		></span>
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
	}
	.flake {
		position: absolute;
		top: -20px;
		border-radius: 50%;
		/* dégradé plutôt qu'un box-shadow flouté : le halo est cuit dans la texture au lieu
		   d'être recalculé, et transform seul suffit à faire tourner l'anim sur le compositeur GPU */
		background: radial-gradient(circle, #64748b 0%, color-mix(in srgb, #64748b 25%, transparent) 65%, transparent 100%);
		animation-name: fall;
		animation-timing-function: linear;
		animation-iteration-count: infinite;
		will-change: transform;
		transform: translateZ(0);
	}
	:global([data-theme='dark']) .flake {
		background: radial-gradient(circle, #fff 0%, rgba(255, 255, 255, 0.3) 65%, transparent 100%);
	}
	@keyframes fall {
		to {
			transform: translate3d(var(--drift), 105vh, 0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.snow {
			display: none;
		}
	}
</style>
