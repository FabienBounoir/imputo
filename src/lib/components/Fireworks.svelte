<script lang="ts">
	// Nouvel An : de vrais feux d'artifice — une fusée monte depuis le bas de l'écran en laissant
	// une traînée, ralentit, puis éclate en gerbe d'étincelles qui retombent. Une salve toutes
	// les 8 à 20 s pendant les cinq jours de la période, et une fois sur quatre le millésime
	// s'allume au cœur de la gerbe.
	// Chaque salve est tirée au sort et retirée du DOM une fois éteinte : rien ne tourne en boucle.
	const now = new Date();
	const YEAR = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
	const TONES = 6;

	function makeVolley() {
		const rise = 1.05 + Math.random() * 0.5;
		const count = 26 + Math.floor(Math.random() * 10);
		const spin = Math.random() * Math.PI * 2;
		return {
			id: Math.random(),
			x: 10 + Math.random() * 80, // % de largeur
			y: 16 + Math.random() * 30, // % de hauteur : altitude d'explosion
			tone: 1 + Math.floor(Math.random() * TONES),
			rise,
			label: Math.random() < 0.25,
			life: rise + 2.6,
			sparks: Array.from({ length: count }, (_, i) => {
				// angles répartis sur le tour + gigue : une gerbe régulière fait « roue de vélo »
				const a = spin + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
				const d = 42 + Math.random() * 88;
				return {
					dx: Math.round(Math.cos(a) * d),
					dy: Math.round(Math.sin(a) * d),
					g: Math.round(34 + Math.random() * 58), // retombée
					size: 2.6 + Math.random() * 2.4,
					delay: rise + Math.random() * 0.12,
					duration: 1.5 + Math.random() * 0.9
				};
			})
		};
	}

	const CLICK_ODDS = 0.07; // un clic sur ~14 part en fusée, sinon ce n'est plus une surprise

	let volleys = $state<ReturnType<typeof makeVolley>[]>([]);

	function launch(v = makeVolley()) {
		volleys.push(v);
		setTimeout(() => (volleys = volleys.filter((o) => o.id !== v.id)), v.life * 1000);
	}

	$effect(() => {
		let t = setTimeout(function fire() {
			launch();
			// une deuxième fusée dans la foulée de temps en temps, jamais plus
			if (Math.random() < 0.35) setTimeout(() => launch(), 500 + Math.random() * 900);
			t = setTimeout(fire, 8000 + Math.random() * 12000);
		}, 1500 + Math.random() * 2000);

		// De temps en temps un clic part en fusée : elle monte jusqu'au point cliqué et y éclate.
		// L'altitude est bornée pour qu'un clic tout en bas laisse quand même la fusée grimper.
		const onDown = (e: PointerEvent) => {
			if (Math.random() > CLICK_ODDS) return;
			launch({
				...makeVolley(),
				x: (e.clientX / window.innerWidth) * 100,
				y: Math.min(72, Math.max(12, (e.clientY / window.innerHeight) * 100))
			});
		};
		window.addEventListener('pointerdown', onDown, { passive: true });

		return () => {
			clearTimeout(t);
			window.removeEventListener('pointerdown', onDown);
		};
	});
</script>

<div class="fireworks" aria-hidden="true">
	{#each volleys as v (v.id)}
		<div class="shell" style="left:{v.x}%; top:{v.y}%; --c:var(--tone-{v.tone});">
			<span class="rocket" style="--rise:{100 - v.y}vh; animation-duration:{v.rise}s;"></span>
			{#each v.sparks as s, i (i)}
				<span
					class="spark"
					style="width:{s.size}px; height:{s.size}px; --dx:{s.dx}px; --dy:{s.dy}px; --g:{s.g}px; animation-delay:{s.delay}s; animation-duration:{s.duration}s;"
				></span>
			{/each}
			{#if v.label}
				<span class="year" style="animation-delay:{v.rise}s;">{YEAR}</span>
			{/if}
		</div>
	{/each}
</div>

<style>
	.fireworks {
		position: fixed;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		z-index: 60;
		/* Palette saturée sur fond clair (un feu blanc/or y serait invisible), palette lumineuse
		   sur fond sombre. */
		--tone-1: #d97706;
		--tone-2: #dc2626;
		--tone-3: #2563eb;
		--tone-4: #059669;
		--tone-5: #c026d3;
		--tone-6: #b45309;
	}
	:global([data-theme='dark']) .fireworks {
		--tone-1: #ffd166;
		--tone-2: #ff6b81;
		--tone-3: #7cc4ff;
		--tone-4: #8ce99a;
		--tone-5: #ff8fd4;
		--tone-6: #fff1c2;
	}
	.shell {
		position: absolute;
		color: var(--c);
	}
	/* La fusée part du bas et décélère en montant (ease-out) : elle « s'essouffle » juste avant
	   d'éclater, au lieu de filer à vitesse constante. */
	.rocket {
		position: absolute;
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: currentColor;
		box-shadow: 0 0 6px currentColor;
		animation-name: rise;
		animation-timing-function: cubic-bezier(0.1, 0.65, 0.3, 1);
		animation-fill-mode: forwards;
	}
	.rocket::after {
		content: '';
		position: absolute;
		left: 0.5px;
		top: 2px;
		width: 2px;
		height: 26px;
		border-radius: 2px;
		background: linear-gradient(currentColor, transparent);
		opacity: 0.55;
	}
	.spark {
		position: absolute;
		border-radius: 50%;
		background: currentColor;
		box-shadow: 0 0 7px currentColor;
		opacity: 0;
		animation-name: burst;
		animation-timing-function: cubic-bezier(0.12, 0.7, 0.25, 1);
		animation-fill-mode: forwards;
	}
	.year {
		position: absolute;
		left: 0;
		top: 0;
		translate: -50% -50%;
		font-size: 30px;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: currentColor;
		text-shadow: 0 0 14px currentColor;
		opacity: 0;
		white-space: nowrap;
		animation: millesime 2.4s ease-out forwards;
	}
	@keyframes rise {
		0% {
			transform: translateY(var(--rise));
			opacity: 1;
		}
		92% {
			opacity: 1;
		}
		100% {
			transform: translateY(0);
			opacity: 0;
		}
	}
	/* Expansion rapide, puis les étincelles ralentissent et piquent du nez : c'est la retombée
	   (--g) qui fait lire la gerbe comme un feu d'artifice et pas comme une explosion plate. */
	@keyframes burst {
		0% {
			transform: translate3d(0, 0, 0) scale(1);
			opacity: 0;
		}
		8% {
			opacity: 1;
		}
		60% {
			transform: translate3d(var(--dx), var(--dy), 0) scale(1);
			opacity: 1;
		}
		100% {
			transform: translate3d(calc(var(--dx) * 1.14), calc(var(--dy) + var(--g)), 0) scale(0.4);
			opacity: 0;
		}
	}
	@keyframes millesime {
		0% {
			opacity: 0;
			scale: 0.8;
		}
		18% {
			opacity: 0.95;
			scale: 1;
		}
		60% {
			opacity: 0.8;
		}
		100% {
			opacity: 0;
			scale: 1.08;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.fireworks {
			display: none;
		}
	}
</style>
