<script lang="ts">
	// Un badge dessiné. Le SVG vient de $lib/badgeArt (aucune donnée utilisateur dedans, cf. son
	// en-tête) ; ce composant ne fait que le poser et, si `interactive`, déplacer la source lumineuse
	// du filtre au passage du pointeur — c'est ce qui donne le reflet qui glisse sur le métal.
	import { badgeSvg, mysterySvg } from '$lib/badgeArt';

	let {
		badgeId,
		tier,
		size = 96,
		letter = '?',
		interactive = false,
		locked = false
	}: {
		badgeId: string;
		tier: number;
		size?: number;
		letter?: string;
		interactive?: boolean;
		locked?: boolean;
	} = $props();

	// Les ids de <defs> sont globaux au document : deux badges au même uid partageraient leur
	// dégradé et leur filtre, donc leur matériau.
	const uid = $props.id();

	let host: HTMLDivElement | undefined = $state();

	function moveLight(e: PointerEvent) {
		if (!host) return;
		const r = host.getBoundingClientRect();
		const px = ((e.clientX - r.left) / r.width) * 2 - 1;
		const py = ((e.clientY - r.top) / r.height) * 2 - 1;
		for (const l of host.querySelectorAll('fePointLight')) {
			l.setAttribute('x', String(100 + px * 130));
			l.setAttribute('y', String(90 + py * 110));
		}
		host.style.transform = `perspective(700px) rotateY(${px * 12}deg) rotateX(${-py * 10}deg)`;
	}

	function resetLight() {
		if (!host) return;
		for (const l of host.querySelectorAll('fePointLight')) {
			l.setAttribute('x', '60');
			l.setAttribute('y', '40');
		}
		host.style.transform = '';
	}
</script>

<div
	bind:this={host}
	class="medal"
	class:locked
	style:width="{size}px"
	role="img"
	aria-label={locked ? 'Badge non décroché' : 'Badge de palier ' + tier}
	onpointermove={interactive ? moveLight : undefined}
	onpointerleave={interactive ? resetLight : undefined}
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- SVG construit par badgeArt, sans entrée utilisateur -->
	{@html locked ? mysterySvg(uid, size >= 180) : badgeSvg({ badgeId, tier: Math.max(1, tier), uid, big: size >= 180, letter })}
</div>

<style>
	.medal {
		display: block;
		transition: transform 0.12s ease-out;
		will-change: transform;
	}
	.medal :global(svg) {
		display: block;
		width: 100%;
		height: auto;
		filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.24));
	}
	/* Pas encore décroché : c'est mysterySvg qui est rendu, pas le vrai dessin passé en niveaux de
	   gris — un simple filtre laissait deviner la monture, le ciel et la scène. L'ombre est juste
	   plus discrète pour que la plaque muette ne prenne pas le pas sur les badges gagnés. */
	.locked :global(svg) {
		filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.16));
	}
</style>
