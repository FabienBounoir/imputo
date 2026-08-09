<script lang="ts">
	const COLORS = ['#ef4444', '#22c55e', '#facc15', '#3b82f6'];
	const BULBS = Array.from({ length: 14 }, (_, i) => ({
		color: COLORS[i % COLORS.length],
		delay: (i % 4) * 0.3
	}));
</script>

<div class="garland" aria-hidden="true">
	{#each BULBS as b, i (i)}
		<span class="bulb" style="background:{b.color}; box-shadow:0 0 5px {b.color}; animation-delay:{b.delay}s;"></span>
	{/each}
</div>

<style>
	.garland {
		display: flex;
		justify-content: space-between;
		padding: 0 10px;
		margin-bottom: 4px;
	}
	.bulb {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		animation: twinkle 1.6s ease-in-out infinite;
	}
	@keyframes twinkle {
		0%,
		100% {
			opacity: 0.35;
			transform: scale(0.85);
		}
		50% {
			opacity: 1;
			transform: scale(1.1);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bulb {
			animation: none;
			opacity: 0.8;
		}
	}
</style>
