<script lang="ts">
	// Salve unique au chargement (pas en boucle) : discret, ça fête le passage à la nouvelle
	// année sans distraire en continu pendant le travail.
	import { Confetti } from 'svelte-confetti';
</script>

<div class="fireworks" aria-hidden="true">
	<Confetti
		x={[-4, 4]}
		y={[0, 0.4]}
		amount={80}
		fallDistance="60vh"
		duration={3500}
		iterationCount={1}
		colorArray={['#facc15', '#ef4444', '#3b82f6', '#ffffff', '#22c55e']}
		rounded
		destroyOnComplete
		disableForReducedMotion
	/>
</div>

<style>
	.fireworks {
		position: fixed;
		top: 0;
		left: 50%;
		z-index: 60;
		pointer-events: none;
	}
</style>
