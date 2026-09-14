<script lang="ts">
	// Aperçu d'un compagnon : sa boucle de repos, rien d'autre. Utilisé par la grille des Réglages.
	// Le compagnon VIVANT (déplacement, jet, jonglage) est PetCompanion.svelte — deux usages trop
	// différents pour un seul composant, mais tout le dessin est partagé via petArt.ts.
	import { onMount } from 'svelte';
	import { PET_ART, PET_GRID, PET_ROWS, frameAt, drawPet } from '$lib/petArt';

	let { petId, scale = 5 }: { petId: string; scale?: number } = $props();

	let canvas: HTMLCanvasElement | undefined = $state();

	onMount(() => {
		const ctx = canvas?.getContext('2d');
		if (!ctx) return;
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		let raf = 0;
		const start = performance.now();
		const render = (now: number) => {
			const art = PET_ART[petId];
			if (art) {
				const t = reduced ? 0 : now - start;
				const frames = art.poses.idle;
				// Flottement/saut repris de la version vivante, pour que la carte montre bien ce
				// qu'on va obtenir — et arrondi au pixel écran par drawPet.
				const lift = reduced ? 0 : art.float ? (Math.sin(t / 780) + 1) * 0.6 : 0;
				drawPet(ctx, art, frames[frameAt(frames, t)], { scale, t, lift });
			}
			if (!reduced) raf = requestAnimationFrame(render);
		};
		raf = requestAnimationFrame(render);
		return () => cancelAnimationFrame(raf);
	});
</script>

<canvas
	bind:this={canvas}
	width={PET_GRID * scale}
	height={PET_ROWS * scale}
	aria-hidden="true"
></canvas>

<style>
	canvas {
		display: block;
		image-rendering: pixelated;
	}
</style>
