<script lang="ts">
	import { randomParticles } from '$lib/particles';
	const GLYPHS = ['❤️', '💕', '💖'];
	const HEARTS = randomParticles(30, [12, 22]).map((p, i) => ({ ...p, glyph: GLYPHS[i % GLYPHS.length] }));
</script>

<div class="hearts" aria-hidden="true">
	{#each HEARTS as h, i (i)}
		<span
			class="heart"
			style="left:{h.left}%; animation-delay:{h.delay}s; animation-duration:{h.duration}s; font-size:{h.size}px; opacity:{h.opacity}; --drift:{h.drift}px;"
		>{h.glyph}</span>
	{/each}
</div>

<style>
	.hearts {
		position: fixed;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		z-index: 60;
		contain: strict;
	}
	.heart {
		position: absolute;
		top: -24px;
		line-height: 1;
		animation-name: fall;
		animation-timing-function: linear;
		animation-iteration-count: infinite;
		will-change: transform;
		transform: translateZ(0);
	}
	@keyframes fall {
		to {
			transform: translate3d(var(--drift), 105vh, 0) rotate(20deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.hearts {
			display: none;
		}
	}
</style>
