<script lang="ts">
	// 14 juillet : le passage de la Patrouille de France. Trois avions en échelon traversent le
	// haut de l'écran en laissant une fumée bleu-blanc-rouge qui s'étire derrière eux puis
	// s'efface.
	// Chaque passage est retiré au sort (côté d'entrée, altitude, inclinaison, vitesse) et un
	// seul est en l'air à la fois : une boucle CSS infinie rejouerait exactement le même vol.

	// Vue de dessus : fuselage effilé, dérives à l'arrière, ailes en flèche. Silhouette choisie
	// pour rester lisible à 52 px de large, la taille à laquelle elle traverse l'écran.
	const JET = 'M47 12 30 13.6 6 14.4 2 17 2.6 13.8 .8 12 2.6 10.2 2 7 6 9.6 30 10.4Z';
	const WING_UP = 'M28 10.8 14 1 20 1 36 10Z';
	const WING_LOW = 'M28 13.2 14 23 20 23 36 14Z';

	// Décalage de chaque appareil dans l'échelon : du retard au départ + de l'altitude.
	const ECHELON = [
		{ dy: 0, delay: 0, color: 'var(--blue)' },
		{ dy: 22, delay: 0.42, color: 'var(--white)' },
		{ dy: 44, delay: 0.84, color: 'var(--red)' }
	];
	const FADE = 1.6; // fondu de la fumée une fois les avions sortis

	function makePass() {
		return {
			id: Math.random(),
			dir: Math.random() < 0.5 ? 1 : -1, // 1 = entre par la gauche
			top: 10 + Math.random() * 28, // % de hauteur d'écran
			angle: (Math.random() - 0.5) * 12, // montée ou descente, jamais plat
			duration: 5.5 + Math.random() * 3.5
		};
	}

	let pass = $state<ReturnType<typeof makePass> | null>(null);

	$effect(() => {
		let t = setTimeout(function go() {
			const p = makePass();
			pass = p;
			// on retire le vol du DOM une fois la dernière traînée effacée
			setTimeout(() => {
				if (pass?.id === p.id) pass = null;
			}, (p.duration + ECHELON[2].delay + FADE + 0.5) * 1000);
			t = setTimeout(go, 18000 + Math.random() * 20000);
		}, 2500 + Math.random() * 4000);
		return () => clearTimeout(t);
	});
</script>

<div class="flypast" aria-hidden="true">
	{#if pass}
		<!-- un seul conteneur incliné : les trois avions et leurs fumées suivent le même axe,
		     et scaleX(-1) suffit à faire entrer la patrouille par la droite -->
		<div class="flight" style="top:{pass.top}%; transform:rotate({pass.angle}deg) scaleX({pass.dir});">
			{#each ECHELON as e (e.dy)}
				<div class="slot" style="top:{e.dy}px; --c:{e.color};">
					<span
						class="trail"
						style="animation-duration:{pass.duration}s, {FADE}s; animation-delay:{e.delay}s, {pass.duration + e.delay}s;"
					></span>
					<svg
						class="jet"
						viewBox="0 0 48 24"
						width="52"
						height="26"
						style="animation-duration:{pass.duration}s; animation-delay:{e.delay}s;"
					>
						<path d={WING_UP} />
						<path d={WING_LOW} />
						<path d={JET} />
					</svg>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.flypast {
		position: fixed;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		z-index: 60;
		/* Le blanc du drapeau est invisible sur le thème clair : on le tire vers le gris-bleu,
		   et l'avion prend la couleur opposée au fond. */
		--blue: #0055a4;
		--white: #b9c6d6;
		--red: #ef4135;
		--jet: #33405a;
	}
	:global([data-theme='dark']) .flypast {
		--white: #ffffff;
		--blue: #2f7fd4;
		--jet: #dbe3ee;
	}
	.flight {
		position: absolute;
		left: -12vw;
		width: 116vw;
		height: 70px;
	}
	.slot {
		position: absolute;
		left: 0;
		width: 100%;
		height: 26px;
	}
	.trail {
		position: absolute;
		/* aligné sur l'axe du fuselage (y = 12 sur 24 dans le viewBox, soit 13 px sur 26) */
		top: 10.5px;
		left: 0;
		width: 100%;
		height: 5px;
		border-radius: 4px;
		opacity: 0;
		/* la fumée s'épaissit vers l'avion et s'estompe vers l'arrière, elle ne s'arrête pas net */
		background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--c) 30%, transparent) 55%, var(--c) 100%);
		transform-origin: left center;
		filter: blur(1.1px);
		animation-name: smoke, dissipate;
		animation-timing-function: linear, ease-in;
		animation-fill-mode: forwards, forwards;
	}
	.jet {
		position: absolute;
		left: 0;
		top: 0;
		opacity: 0;
		fill: var(--jet);
		animation-name: fly;
		animation-timing-function: linear;
		animation-fill-mode: forwards;
	}
	/* L'avion et sa fumée avancent au même rythme : l'un traverse en translation, l'autre
	   s'étire de 0 à 100 % sur exactement la même course, donc le nez reste en tête. */
	@keyframes fly {
		0% {
			transform: translate3d(0, 0, 0);
			opacity: 0;
		}
		4% {
			opacity: 1;
		}
		94% {
			opacity: 1;
		}
		100% {
			transform: translate3d(116vw, 0, 0);
			opacity: 0;
		}
	}
	@keyframes smoke {
		0% {
			transform: scaleX(0);
			opacity: 0;
		}
		4% {
			opacity: 0.75;
		}
		100% {
			transform: scaleX(1);
			opacity: 0.75;
		}
	}
	@keyframes dissipate {
		to {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.flypast {
			display: none;
		}
	}
</style>
