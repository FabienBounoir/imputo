<script lang="ts">
	// Épiphanie : une fève en porcelaine (une petite couronne dorée) est cachée quelque part dans
	// la page. Elle ne clignote pas — elle lance juste un éclat toutes les quelques secondes, et
	// change de cachette de temps en temps pour rester trouvable sans être évidente.
	// Un clic dessus : elle éclate en poussière d'or et la couronne se pose sur ton avatar.
	import { toast } from 'svelte-sonner';
	import { CROWN_BODY, CROWN_BAND, epiphanyState, takeFeve } from '$lib/epiphany.svelte';

	const SPARKLE = 'M12 1.5l1.7 7 7 1.7-7 1.7-1.7 7-1.7-7-7-1.7 7-1.7z';
	const DUST = Array.from({ length: 14 }, (_, i) => {
		const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
		const d = 26 + Math.random() * 40;
		return {
			dx: Math.round(Math.cos(a) * d),
			dy: Math.round(Math.sin(a) * d),
			size: 2 + Math.random() * 3,
			delay: Math.random() * 0.08
		};
	});

	const hide = () => ({ left: 8 + Math.random() * 80, top: 16 + Math.random() * 62 });

	let spot = $state(hide());
	let popped = $state(false);

	$effect(() => {
		// Elle se recache régulièrement : sinon, une fève tombée derrière une modale reste
		// introuvable toute la journée.
		const t = setInterval(() => !popped && (spot = hide()), 110000 + Math.random() * 70000);
		return () => clearInterval(t);
	});

	function found() {
		if (popped) return;
		popped = true;
		takeFeve();
		toast.success('👑 Tu as trouvé la fève !', { description: 'Tu portes la couronne jusqu’à demain.' });
	}
</script>

{#if !epiphanyState.crowned || popped}
	<div class="epiphany" aria-hidden="true">
		<div class="spot" class:popped style="left:{spot.left}%; top:{spot.top}%;">
			{#if !popped}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="feve" onpointerdown={found}>
					<svg viewBox="0 0 24 24" width="26" height="26">
						<path d={CROWN_BODY} fill="var(--porcelain)" stroke="var(--gold)" stroke-width="1.4" stroke-linejoin="round" />
						<path d={CROWN_BAND} fill="var(--gold)" />
						<circle cx="12" cy="8.6" r="1.5" fill="var(--gold)" />
					</svg>
					<svg class="glint a" viewBox="0 0 24 24" width="13" height="13"><path d={SPARKLE} fill="var(--gold)" /></svg>
					<svg class="glint b" viewBox="0 0 24 24" width="9" height="9"><path d={SPARKLE} fill="var(--gold)" /></svg>
				</div>
			{:else}
				{#each DUST as d, i (i)}
					<span
						class="dust"
						style="width:{d.size}px; height:{d.size}px; --dx:{d.dx}px; --dy:{d.dy}px; animation-delay:{d.delay}s;"
					></span>
				{/each}
				<span class="ring"></span>
			{/if}
		</div>
	</div>
{/if}

<style>
	.epiphany {
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 60;
		--gold: #d9a520;
		--porcelain: #fdf4e0;
	}
	:global([data-theme='dark']) .epiphany {
		--gold: #f3c559;
		--porcelain: #fff8e8;
	}
	.spot {
		position: absolute;
		translate: -50% -50%;
		/* changement de cachette : elle s'efface, se repose ailleurs, se rallume */
		transition: opacity 0.9s ease;
	}
	/* Seule la fève est cliquable, le reste du calque laisse tout passer. */
	.feve {
		position: relative;
		pointer-events: auto;
		cursor: pointer;
		line-height: 0;
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25));
		animation: settle 0.7s cubic-bezier(0.2, 0.9, 0.3, 1.3) backwards;
	}
	.feve:hover {
		scale: 1.12;
	}
	/* L'éclat : deux étoiles qui s'allument à contretemps, jamais les deux en même temps. */
	.glint {
		position: absolute;
		opacity: 0;
		animation: glint 4.5s ease-in-out infinite;
	}
	.glint.a {
		top: -7px;
		right: -7px;
	}
	.glint.b {
		bottom: -3px;
		left: -7px;
		animation-delay: 2.2s;
	}
	.dust {
		position: absolute;
		left: 0;
		top: 0;
		border-radius: 50%;
		background: var(--gold);
		box-shadow: 0 0 6px var(--gold);
		animation: scatter 0.85s cubic-bezier(0.1, 0.75, 0.3, 1) forwards;
	}
	.ring {
		position: absolute;
		left: 0;
		top: 0;
		width: 12px;
		height: 12px;
		translate: -50% -50%;
		border-radius: 50%;
		border: 2px solid var(--gold);
		animation: halo 0.7s ease-out forwards;
	}
	@keyframes settle {
		from {
			opacity: 0;
			scale: 0.6;
		}
	}
	@keyframes glint {
		0%,
		84%,
		100% {
			opacity: 0;
			scale: 0.4;
			rotate: 0deg;
		}
		92% {
			opacity: 1;
			scale: 1;
			rotate: 45deg;
		}
	}
	@keyframes scatter {
		0% {
			transform: translate3d(0, 0, 0) scale(1);
			opacity: 1;
		}
		100% {
			transform: translate3d(var(--dx), var(--dy), 0) scale(0.3);
			opacity: 0;
		}
	}
	@keyframes halo {
		to {
			width: 96px;
			height: 96px;
			opacity: 0;
			border-width: 1px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.feve,
		.glint {
			animation: none;
		}
	}
</style>
