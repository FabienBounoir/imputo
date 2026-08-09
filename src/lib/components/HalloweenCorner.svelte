<script lang="ts">
	// Toile générée par calcul plutôt qu'à la main : rayons/anneaux réguliers, pas de segments
	// disparates qui ne se rejoignent pas.
	const ANGLES = [90, 112.5, 135, 157.5, 180]; // degrés, du bord droit au bord haut du coin
	const RINGS = [22, 45, 70, 96];

	function point(r: number, deg: number) {
		const rad = (deg * Math.PI) / 180;
		return `${(100 + r * Math.cos(rad)).toFixed(1)},${(r * Math.sin(rad)).toFixed(1)}`;
	}

	const spokes = ANGLES.map((a) => `M100,0 L${point(96, a)}`);
	const rings = RINGS.map((r) => `M${ANGLES.map((a) => point(r, a)).join(' L')}`);

	// Chaque chauve-souris a sa propre trajectoire (sens, amplitude d'ondulation, taille,
	// vitesse) au lieu d'un simple aller gauche→droite identique pour toutes.
	function makeBats(n: number) {
		return Array.from({ length: n }, () => {
			const dir = Math.random() < 0.5 ? 1 : -1;
			return {
				top: 4 + Math.random() * 55,
				dir,
				dx: `${dir * (110 + Math.random() * 20)}vw`,
				amp: 10 + Math.random() * 20,
				duration: 15 + Math.random() * 16,
				delay: Math.random() * 18,
				size: 26 + Math.random() * 22,
				opacity: 0.4 + Math.random() * 0.4,
				flap: 0.26 + Math.random() * 0.16
			};
		});
	}
	const BATS = makeBats(6);
</script>

<div class="halloween" aria-hidden="true">
	<svg class="cobweb" viewBox="0 0 100 100" width="96" height="96">
		<g stroke="currentColor" fill="none" stroke-width="1" stroke-linecap="round" opacity="0.4">
			{#each spokes as d (d)}<path {d} />{/each}
			{#each rings as d (d)}<path {d} />{/each}
		</g>
	</svg>
	<span class="spider">🕷️</span>
	{#each BATS as b, i (i)}
		<div
			class="bat"
			style="
				top:{b.top}%; {b.dir === 1 ? 'left:-8%;' : 'right:-8%;'}
				--dx:{b.dx}; --amp:{b.amp}px;
				animation-delay:{b.delay}s; animation-duration:{b.duration}s;
				opacity:{b.opacity};
			"
		>
			<svg
				class="bat-svg"
				viewBox="0 0 64 32"
				width={b.size}
				height={b.size / 2}
				style="transform: scaleX({b.dir});"
				aria-hidden="true"
			>
				<defs>
					<path id="bat-wing-{i}" d="M32,16 C22,4 10,2 4,8 C10,12 8,16 13,18 C17,14 21,18 24,22 C28,18 30,20 32,22 Z" />
				</defs>
				<g class="wing wing-left" style="animation-duration:{b.flap}s; animation-delay:{b.delay}s"><use href="#bat-wing-{i}" /></g>
				<g class="wing wing-right" style="animation-duration:{b.flap}s; animation-delay:{b.delay}s"><use href="#bat-wing-{i}" transform="translate(64,0) scale(-1,1)" /></g>
				<ellipse class="bat-body" cx="32" cy="17" rx="3" ry="4.5" />
			</svg>
		</div>
	{/each}
</div>

<style>
	.halloween {
		position: fixed;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		z-index: 55;
		color: var(--text-mute);
	}
	.cobweb {
		position: absolute;
		top: 0;
		right: 0;
	}
	.spider {
		position: absolute;
		top: 30px;
		right: 26px;
		font-size: 15px;
		transform-origin: top center;
		animation: dangle 4s ease-in-out infinite;
	}
	.spider::before {
		content: '';
		position: absolute;
		bottom: 100%;
		left: 50%;
		width: 1px;
		height: 30px;
		background: currentColor;
		opacity: 0.4;
	}
	@keyframes dangle {
		0%,
		100% {
			transform: rotate(-6deg);
		}
		50% {
			transform: rotate(6deg);
		}
	}
	.bat {
		position: absolute;
		animation-name: fly;
		animation-timing-function: ease-in-out;
		animation-iteration-count: infinite;
	}
	.bat-svg {
		fill: currentColor;
		display: block;
	}
	.wing {
		transform-origin: 32px 17px;
		animation-name: flap;
		animation-timing-function: ease-in-out;
		animation-iteration-count: infinite;
	}
	.wing-right {
		animation-name: flap-right;
	}
	@keyframes flap {
		0%,
		100% {
			transform: scaleX(1) rotate(0deg);
		}
		50% {
			transform: scaleX(0.5) rotate(-10deg);
		}
	}
	@keyframes flap-right {
		0%,
		100% {
			transform: scaleX(1) rotate(0deg);
		}
		50% {
			transform: scaleX(0.5) rotate(10deg);
		}
	}
	/* Amplitude/distance propres à chaque chauve-souris via --dx et --amp (posées en style inline).
	   Beaucoup d'étapes à multiplicateurs irréguliers : un vol de chauve-souris est erratique,
	   pas une sinusoïde régulière. */
	@keyframes fly {
		0% {
			transform: translate(0, 0);
		}
		10% {
			transform: translate(calc(var(--dx) * 0.1), calc(var(--amp) * -0.6));
		}
		20% {
			transform: translate(calc(var(--dx) * 0.2), calc(var(--amp) * 0.9));
		}
		30% {
			transform: translate(calc(var(--dx) * 0.3), calc(var(--amp) * -1.4));
		}
		40% {
			transform: translate(calc(var(--dx) * 0.4), calc(var(--amp) * 0.2));
		}
		50% {
			transform: translate(calc(var(--dx) * 0.5), calc(var(--amp) * -0.9));
		}
		60% {
			transform: translate(calc(var(--dx) * 0.6), calc(var(--amp) * 1.2));
		}
		70% {
			transform: translate(calc(var(--dx) * 0.7), calc(var(--amp) * -0.4));
		}
		80% {
			transform: translate(calc(var(--dx) * 0.8), calc(var(--amp) * 0.8));
		}
		90% {
			transform: translate(calc(var(--dx) * 0.9), calc(var(--amp) * -1.1));
		}
		100% {
			transform: translate(var(--dx), 0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bat,
		.wing,
		.spider {
			animation: none;
		}
	}
</style>
