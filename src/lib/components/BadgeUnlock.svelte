<script lang="ts">
	// Séquence de déblocage : le badge tombe du haut en tournant et se pose au centre, la source
	// lumineuse orbitant autour pendant la chute (le reflet balaie le métal au rythme de la rotation).
	// Décor repris du Wrapped — halo qui respire, colonnes de lumière, balayage oblique — pour que
	// l'écran appartienne visiblement à l'app et pas à une librairie d'animation.
	import { onMount } from 'svelte';
	import { MATERIALS, TIER_MATERIAL } from '$lib/badgeArt';
	import BadgeMedal from './BadgeMedal.svelte';

	let {
		badgeId,
		name,
		tier,
		tierName,
		letter = '?',
		onclose
	}: {
		badgeId: string;
		name: string;
		tier: number;
		tierName: string;
		letter?: string;
		onclose: () => void;
	} = $props();

	const material = $derived(MATERIALS[TIER_MATERIAL[Math.max(0, Math.min(4, tier - 1))]]);

	let stage: HTMLDivElement | undefined = $state();

	onMount(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const t0 = performance.now();
		let raf = 0;
		const orbit = (now: number) => {
			const t = Math.min(1, (now - t0) / 1750);
			const a = t * Math.PI * 6; // trois tours, comme la rotation
			const x = Math.cos(a) * (1 - t * 0.55);
			const y = Math.sin(a) * (1 - t * 0.55) - 0.25;
			for (const l of stage?.querySelectorAll('fePointLight') ?? []) {
				l.setAttribute('x', String(100 + x * 130));
				l.setAttribute('y', String(90 + y * 110));
			}
			if (t < 1) raf = requestAnimationFrame(orbit);
		};
		raf = requestAnimationFrame(orbit);
		return () => cancelAnimationFrame(raf);
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div
	class="unlock"
	style:--tint={material.tint}
	onclick={onclose}
	role="dialog"
	aria-modal="true"
	aria-label="Nouveau palier : {name}"
	tabindex="-1"
>
	<div class="glow"></div>
	<div class="rays"></div>
	<div class="sweep"></div>
	<div class="flash"></div>
	<div class="shock"></div>

	<div class="dropping" bind:this={stage}>
		<BadgeMedal {badgeId} {tier} {letter} size={300} />
	</div>

	<div class="caption">
		<small>Palier {tier} · {material.name}</small>
		<b>{tierName}</b>
		<span>{name}</span>
	</div>
	<p class="hint">Toucher pour fermer</p>
</div>

<style>
	.unlock {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: radial-gradient(120% 80% at 50% 40%, #241d17 0%, #0d0b09 70%);
		overflow: hidden;
		perspective: 1200px;
		animation: fade 0.35s ease both;
	}
	@keyframes fade {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.glow {
		position: absolute;
		width: 46vw;
		height: 46vw;
		max-width: 520px;
		max-height: 520px;
		border-radius: 50%;
		background: radial-gradient(circle, var(--tint) 0%, transparent 62%);
		filter: blur(80px);
		opacity: 0.2;
		animation: glow-pulse 6s ease-in-out infinite;
	}
	@keyframes glow-pulse {
		0%, 100% { transform: translate(-8%, -6%) scale(0.9); opacity: 0.16; }
		50% { transform: translate(8%, 7%) scale(1.2); opacity: 0.4; }
	}

	.rays {
		position: absolute;
		inset: 0;
		mask-image: linear-gradient(0deg, transparent 2%, #000 34%, #000 62%, transparent 96%);
	}
	.rays::before {
		content: '';
		position: absolute;
		inset: -10% -20%;
		background: repeating-linear-gradient(96deg, transparent 0 78px, var(--tint) 78px 81px);
		opacity: 0.32;
		animation: slide-x 16s linear infinite;
	}
	@keyframes slide-x {
		to { transform: translateX(-160px); }
	}

	.sweep {
		position: absolute;
		inset: -50%;
		background: linear-gradient(115deg, transparent 42%, var(--tint) 50%, transparent 58%);
		opacity: 0.28;
		animation: sweep-move 8s ease-in-out infinite;
	}
	@keyframes sweep-move {
		0%, 100% { transform: translateX(-18%); }
		50% { transform: translateX(18%); }
	}

	.flash {
		position: absolute;
		inset: 0;
		background: #fff;
		opacity: 0;
		animation: flash 0.75s 1.45s ease-out both;
	}
	@keyframes flash {
		from { opacity: 0.7; }
		to { opacity: 0; }
	}

	.shock {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 40px;
		height: 40px;
		margin: -20px;
		border-radius: 50%;
		border: 2px solid var(--tint);
		opacity: 0;
		animation: shock 0.9s 1.5s ease-out both;
	}
	@keyframes shock {
		from { transform: scale(1); opacity: 0.9; }
		to { transform: scale(22); opacity: 0; }
	}

	/* Départ franc mais pas instantané : un ease-out trop agressif pose le badge en moins d'un tiers
	   de la durée, et la descente comme la rotation passent inaperçues. */
	.dropping {
		position: relative;
		transform-style: preserve-3d;
		animation: drop 1.75s cubic-bezier(0.42, 0.04, 0.18, 1) both;
	}
	@keyframes drop {
		0% { transform: translateY(-78vh) rotateY(0deg) rotateX(22deg) scale(0.55); opacity: 0; }
		12% { opacity: 1; }
		82% { transform: translateY(0) rotateY(1080deg) rotateX(0deg) scale(1.08); }
		100% { transform: translateY(0) rotateY(1080deg) rotateX(0deg) scale(1); }
	}

	.caption {
		position: relative;
		text-align: center;
		color: #fff;
		margin-top: 26px;
		animation: rise 0.6s 1.75s ease-out both;
	}
	@keyframes rise {
		from { transform: translateY(14px); opacity: 0; }
		to { transform: translateY(0); opacity: 1; }
	}
	.caption small {
		color: #b9b2a7;
		font-size: 12.5px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.caption b {
		display: block;
		font-size: 24px;
		letter-spacing: -0.3px;
	}
	.caption span {
		color: #b9b2a7;
		font-size: 13px;
	}

	.hint {
		position: absolute;
		bottom: 34px;
		color: #b9b2a7;
		font-size: 12px;
		animation: rise 0.6s 2.2s ease-out both;
	}

	@media (prefers-reduced-motion: reduce) {
		.dropping, .caption, .hint, .flash, .shock { animation: none; opacity: 1; transform: none; }
		.glow, .rays::before, .sweep { animation: none; }
	}
</style>
