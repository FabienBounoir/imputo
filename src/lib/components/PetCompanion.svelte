<script lang="ts">
	/**
	 * Le compagnon vivant, en bas de la fenêtre.
	 *
	 * Répertoire et physique calqués sur le « chat pet » de VS Code : réaction tirée au sort sans
	 * répéter la précédente, sommeil après inactivité, étourdissement sur changements de direction
	 * rapides, attraper / lancer / faire rebondir, et le jonglage au curseur avec son compteur.
	 *
	 * Deux règles de fond, ce sont les leurs :
	 *   • Le CORPS change de pose (chaque compagnon fournit les siennes), les yeux et les décorations
	 *     sont des couches composées au rendu — écrites une fois, valables pour les huit.
	 *   • Au contact d'un mur, on ne simule que jusqu'au mur : le reste du pas est jeté, sinon le
	 *     rebond part d'une position qui n'a jamais existé.
	 *
	 * Purement décoratif : hors de l'ordre de tabulation et masqué aux lecteurs d'écran. Le rendre
	 * focusable le placerait sur le chemin du clavier de CHAQUE page de l'app.
	 */
	import { onMount } from 'svelte';
	import {
		PET_ART,
		PET_GRID,
		PET_ROWS,
		frameAt,
		drawPet,
		type DecoKind,
		type EyeMode,
		type PetPoseKey
	} from '$lib/petArt';

	let { petId }: { petId: string } = $props();

	const SCALE = 4;
	const W = PET_GRID * SCALE;
	const H = PET_ROWS * SCALE;

	// Physique : constantes du pet de VS Code, sans arrondi.
	const GRAVITY = 1800;
	const THROW_MIN_V = 650;
	const THROW_MAX_V = 2400;
	const MAX_STEP = 32;
	const MAX_FLIGHT = 4000;
	const WALL_BOUNCE = 0.2;
	const CEIL_BOUNCE = 0.2;
	const ROT_PER_PX = 0.65;
	const RIGHTING_FROM = -450;
	const RIGHTING_SPEED = 720;
	const GRACE = 80;
	// Jonglage au curseur.
	const BOUNCE_MIN_UP = 760;
	const BOUNCE_MAX_UP = 1800;
	const BOUNCE_RESTITUTION = 0.65;
	const BOUNCE_UP_TRANSFER = 0.4;
	const BOUNCE_H_RETENTION = 0.65;
	const BOUNCE_H_TRANSFER = 0.35;
	const BOUNCE_EDGE_KICK = 320;
	const BOUNCE_MAX_H = 1800;
	const BOUNCE_GRACE = 500;
	const BOUNCE_RESULT = 5000;
	const BOUNCE_SQUASH = 120;
	const SERVE_MIN_SPEED = 400;
	const SPLAT_V = 900;
	const SAMPLE_WINDOW = 100;
	const SAMPLE_LIMIT = 8;
	const HOP_CYCLE = 1150;
	const SLEEP_AFTER = 20_000;

	type Reaction = { id: string; pose: PetPoseKey; deco: DecoKind; ms: number };
	const REACTIONS: Reaction[] = [
		{ id: 'cheer', pose: 'up', deco: 'sparks', ms: 2000 },
		{ id: 'heart', pose: 'up', deco: 'hearts', ms: 2200 },
		{ id: 'sing', pose: 'up', deco: 'note', ms: 2400 },
		{ id: 'speechless', pose: 'idle', deco: 'dots', ms: 2000 },
		{ id: 'worry', pose: 'down', deco: 'sweat', ms: 2200 }
	];

	let canvas: HTMLCanvasElement | undefined = $state();
	let combo = $state(0);

	onMount(() => {
		if (!canvas) return;
		const context = canvas.getContext('2d');
		if (!context) return;
		// Types déclarés explicitement : la restriction obtenue par les gardes ci-dessus ne survit
		// pas aux fonctions déclarées plus bas, qui reliraient `canvas` et le contexte élargis.
		const el: HTMLCanvasElement = canvas;
		const ctx: CanvasRenderingContext2D = context;
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

		let clock = 0;
		let lastTick = performance.now();
		let x = Math.min(220, innerWidth / 2);
		let y = 0;
		let vx = 0;
		let vy = 0;
		let rot = 0;
		let dir = 1;
		let flip = false;
		let mode: 'ground' | 'held' | 'throw' = 'ground';
		let flight = 0;
		let grabX = 0;
		let grabY = 0;
		let samples: { t: number; x: number; y: number }[] = [];
		let impactUntil = 0;
		let splatUntil = 0;
		let squashUntil = 0;
		let celebrateUntil = 0;
		let lastActivity = Date.now();
		let reaction: Reaction | null = null;
		let reactionUntil = 0;
		let lastReactionId: string | null = null;
		let dizzyUntil = 0;
		let flips: number[] = [];
		let gazeTX = 0;
		let gazeTY = 0;
		let gazeX = 0;
		let gazeY = 0;
		let nextBlink = 2400;
		let blinkUntil = -1;
		let cursorX = 0;
		let cursorY = 0;
		let hasCursor = false;
		let cursorSamples: { t: number; x: number; y: number }[] = [];
		let bounceCount = 0;
		let bounceAvailableAt = 0;
		let cursorInside = false;
		let bounceResultUntil = 0;

		const bounds = () => ({
			minL: 8,
			maxL: Math.max(8, innerWidth - W - 8),
			minT: 8,
			floor: innerHeight - H + 6
		});
		const overPet = (px: number, py: number) => px >= x && px <= x + W && py >= y && py <= y + H;

		function advance(ms: number) {
			const b = bounds();
			const d = Math.min(ms, MAX_STEP) / 1000;
			const projected = x + vx * d;
			let dur = d;
			let wall: 'left' | 'right' | null = null;
			if (projected < b.minL) {
				wall = 'left';
				dur = d * ((b.minL - x) / (projected - x));
				x = b.minL;
			} else if (projected > b.maxL) {
				wall = 'right';
				dur = d * ((b.maxL - x) / (projected - x));
				x = b.maxL;
			} else {
				x = projected;
			}

			y += vy * dur + (GRAVITY * dur * dur) / 2;
			vy += GRAVITY * dur;
			if (y < b.minT) {
				y = b.minT;
				vy = Math.abs(vy) * CEIL_BOUNCE;
			}

			if (!reduced) {
				if (vy < RIGHTING_FROM) rot += Math.sign(vx) * Math.abs(vx) * dur * ROT_PER_PX;
				else {
					const step = RIGHTING_SPEED * dur;
					rot = Math.abs(rot) <= step ? 0 : rot - Math.sign(rot) * step;
				}
			}

			if (wall) {
				vx = -vx * WALL_BOUNCE;
				flip = wall === 'left'; // la pose d'impact est dessinée contre le mur de droite
				impactUntil = clock + 260;
				lastActivity = Date.now();
			}

			flight += ms;
			if ((y >= b.floor && vy > 0) || flight > MAX_FLIGHT) {
				if (y >= b.floor && vy > SPLAT_V) splatUntil = clock + 420;
				y = Math.min(y, b.floor);
				vx = 0;
				vy = 0;
				rot = 0;
				mode = 'ground';
				cursorInside = false;
				if (bounceCount > 0) bounceResultUntil = clock + BOUNCE_RESULT;
			}
		}

		function launch(sx: number, sy: number, grace = 0) {
			mode = 'throw';
			vx = sx;
			vy = sy;
			flight = 0;
			flip = sx < 0;
			lastActivity = Date.now();
			bounceCount = 0;
			bounceResultUntil = 0;
			bounceAvailableAt = clock + grace;
			cursorInside = hasCursor && overPet(cursorX, cursorY);
			cursorSamples = [];
		}

		/** Vitesse de lâcher, échantillonnée sur les 80 dernières ms. En deçà du minimum : c'est un clic. */
		function releaseVelocity() {
			const now = performance.now();
			const recent = samples.filter((s) => now - s.t <= GRACE);
			if (recent.length < 2) return null;
			const a = recent[0];
			const b = recent[recent.length - 1];
			const dt = (b.t - a.t) / 1000;
			if (dt <= 0) return null;
			const sx = (b.x - a.x) / dt;
			const sy = (b.y - a.y) / dt;
			const speed = Math.hypot(sx, sy);
			if (speed < THROW_MIN_V) return null;
			const k = Math.min(THROW_MAX_V, speed) / speed;
			return { x: sx * k, y: sy * k };
		}

		function pointerVelocity() {
			if (cursorSamples.length < 2) return { x: 0, y: 0 };
			const a = cursorSamples[0];
			const b = cursorSamples[cursorSamples.length - 1];
			const dt = (b.t - a.t) / 1000;
			if (dt <= 0) return { x: 0, y: 0 };
			return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
		}

		/**
		 * Contact balayé entre deux positions de curseur : un geste rapide saute plusieurs dizaines
		 * de pixels par image et traverserait le compagnon sans jamais le toucher.
		 */
		function sweepContact(x0: number, y0: number, x1: number, y1: number): number | null {
			if (overPet(x1, y1)) return 1;
			let t0 = 0;
			let t1 = 1;
			const slab = (p0: number, p1: number, min: number, max: number) => {
				const d = p1 - p0;
				if (d === 0) return p0 >= min && p0 <= max;
				let a = (min - p0) / d;
				let b = (max - p0) / d;
				if (a > b) {
					const swap = a;
					a = b;
					b = swap;
				}
				t0 = Math.max(t0, a);
				t1 = Math.min(t1, b);
				return t0 <= t1;
			};
			if (!slab(x0, x1, x, x + W)) return null;
			if (!slab(y0, y1, y, y + H)) return null;
			return t0 <= t1 ? t0 : null;
		}

		function bounceVelocity(pointerX: number, pv: { x: number; y: number }) {
			const centre = x + W / 2;
			const offset = Math.max(-1, Math.min(1, (centre - pointerX) / (W / 2)));
			const hv = vx * BOUNCE_H_RETENTION + pv.x * BOUNCE_H_TRANSFER + offset * BOUNCE_EDGE_KICK;
			const up = Math.max(
				BOUNCE_MIN_UP,
				Math.max(0, vy) * BOUNCE_RESTITUTION + Math.max(0, -pv.y) * BOUNCE_UP_TRANSFER
			);
			return {
				x: Math.max(-BOUNCE_MAX_H, Math.min(BOUNCE_MAX_H, hv)),
				y: -Math.min(BOUNCE_MAX_UP, up)
			};
		}

		function countBounce() {
			bounceCount++;
			combo = bounceCount;
			squashUntil = clock + BOUNCE_SQUASH;
			bounceResultUntil = 0;
			cursorInside = true;
			lastActivity = Date.now();
			if (bounceCount === 20) celebrateUntil = clock + 2600;
		}

		/**
		 * Frappe en vol. Trois verrous, ce sont les leurs : la grâce qui suit un lâcher, l'obligation
		 * de ressortir du compagnon avant de le refrapper (sinon un curseur posé dessus enchaînerait
		 * tout seul), et le fait qu'il doive être en train de DESCENDRE — on rattrape, on ne pousse
		 * pas ce qui monte déjà.
		 */
		function tryMouseBounce(prevX: number, prevY: number) {
			if (reduced || mode !== 'throw' || !hasCursor) {
				cursorInside = false;
				return;
			}
			const inside = overPet(cursorX, cursorY);
			if (clock < bounceAvailableAt || cursorInside) {
				cursorInside = inside;
				return;
			}
			let pointerX = cursorX;
			let contact = inside;
			if (!contact) {
				const t = sweepContact(prevX, prevY, cursorX, cursorY);
				if (t !== null) {
					pointerX = prevX + (cursorX - prevX) * t;
					contact = true;
				}
			}
			if (!contact) {
				cursorInside = false;
				return;
			}
			if (vy <= 0) {
				cursorInside = inside;
				return;
			}
			const v = bounceVelocity(pointerX, pointerVelocity());
			vx = v.x;
			vy = v.y;
			flip = vx < 0;
			flight = 0; // le vol repart, sinon la coupure à 4 s tuerait le combo
			countBounce();
		}

		/** Service : une frappe franche sur le compagnon au repos ouvre l'échange. */
		function serve(prevX: number, prevY: number) {
			if (reduced || !hasCursor) return;
			let pointerX = cursorX;
			let contact = overPet(cursorX, cursorY);
			if (!contact) {
				const t = sweepContact(prevX, prevY, cursorX, cursorY);
				if (t !== null) {
					pointerX = prevX + (cursorX - prevX) * t;
					contact = true;
				}
			}
			if (!contact || cursorInside) {
				cursorInside = contact;
				return;
			}
			const pv = pointerVelocity();
			if (Math.hypot(pv.x, pv.y) < SERVE_MIN_SPEED) {
				cursorInside = true;
				return;
			}
			const v = bounceVelocity(pointerX, pv);
			launch(v.x, v.y);
			countBounce();
		}

		function react(r: Reaction) {
			reaction = r;
			reactionUntil = clock + r.ms;
			lastReactionId = r.id;
			lastActivity = Date.now();
		}
		/** Tirage sans répéter la précédente — la règle explicite du pet de VS Code. */
		function randomReaction() {
			const pool = REACTIONS.filter((r) => r.id !== lastReactionId);
			react(pool[Math.floor(Math.random() * pool.length)]);
		}

		let lastPointerX = 0;
		let lastPointerY = 0;

		function onPointerMove(e: PointerEvent) {
			lastActivity = Date.now();
			gazeTX = Math.max(-1, Math.min(1, (e.clientX - innerWidth / 2) / 320));
			gazeTY = Math.max(-1, Math.min(1, (e.clientY - innerHeight / 2) / 320));
			if (mode === 'held') {
				const b = bounds();
				x = Math.max(b.minL, Math.min(b.maxL, e.clientX - grabX));
				y = Math.max(b.minT, Math.min(b.floor, e.clientY - grabY));
				const now = performance.now();
				samples.push({ t: now, x, y });
				samples = samples.filter((s) => now - s.t <= GRACE * 2);
			} else {
				const prevX = lastPointerX;
				const prevY = lastPointerY;
				cursorX = e.clientX;
				cursorY = e.clientY;
				hasCursor = true;
				const now = performance.now();
				cursorSamples.push({ t: now, x: cursorX, y: cursorY });
				while (
					cursorSamples.length > 2 &&
					(cursorSamples.length > SAMPLE_LIMIT || now - cursorSamples[0].t > SAMPLE_WINDOW)
				)
					cursorSamples.shift();
				if (mode === 'throw') tryMouseBounce(prevX, prevY);
				else if (mode === 'ground' && clock > splatUntil && clock > impactUntil) serve(prevX, prevY);

				const wasLeft = flip;
				if (mode === 'ground') flip = e.clientX < x + W / 2;
				// Va-et-vient rapide de part et d'autre : il finit par tourner de l'œil.
				if (wasLeft !== flip) {
					flips.push(clock);
					flips = flips.filter((t) => clock - t < 1600);
					if (flips.length >= 5) {
						dizzyUntil = clock + 2400;
						flips = [];
					}
				}
			}
			lastPointerX = e.clientX;
			lastPointerY = e.clientY;
		}

		function onPointerDown(e: PointerEvent) {
			mode = 'held';
			grabX = e.clientX - x;
			grabY = e.clientY - y;
			vx = 0;
			vy = 0;
			rot = 0;
			samples = [{ t: performance.now(), x, y }];
			el.setPointerCapture(e.pointerId);
			lastActivity = Date.now();
		}

		function onPointerUp() {
			if (mode !== 'held') return;
			const v = releaseVelocity();
			if (v) {
				launch(v.x, v.y, BOUNCE_GRACE);
				return;
			}
			// Lâché en l'air sans élan : il tombe. Sur place : c'est un clic, donc une réaction.
			if (y < bounds().floor - 1) launch(0, 0);
			else {
				mode = 'ground';
				randomReaction();
			}
		}

		addEventListener('pointermove', onPointerMove);
		el.addEventListener('pointerdown', onPointerDown);
		el.addEventListener('pointerup', onPointerUp);
		const onVisible = () => (lastTick = performance.now());
		document.addEventListener('visibilitychange', onVisible);

		let raf = 0;
		function tick(now: number) {
			raf = requestAnimationFrame(tick);
			const art = PET_ART[petId];
			if (!art) return;
			const dt = Math.min(64, now - lastTick);
			lastTick = now;
			if (!reduced) clock += dt;

			if (clock > nextBlink) {
				blinkUntil = clock + 130;
				nextBlink = clock + 2600 + Math.random() * 4200;
			}
			gazeX += (gazeTX - gazeX) * 0.12;
			gazeY += (gazeTY - gazeY) * 0.12;
			if (reaction && clock > reactionUntil) reaction = null;

			const held = mode === 'held';
			const asleep = mode === 'ground' && Date.now() - lastActivity > SLEEP_AFTER;
			const dizzy = clock < dizzyUntil;

			// Priorité : écrasé > impact > en vol ou porté > étourdi > endormi > réaction > repos.
			let poseKey: PetPoseKey = 'idle';
			let deco: DecoKind | null = null;
			let eyeMode: EyeMode = 'gaze';
			if (clock < squashUntil) {
				poseKey = 'splat';
				eyeMode = 'shut';
			} else if (clock < impactUntil) {
				poseKey = 'impact';
				deco = 'stars';
				eyeMode = 'shut';
			} else if (clock < splatUntil) {
				poseKey = 'splat';
				eyeMode = 'shut';
			} else if (mode === 'throw' || held) poseKey = 'fall';
			else if (dizzy) {
				poseKey = 'down';
				deco = 'stars';
				eyeMode = 'cross';
			} else if (asleep) {
				poseKey = 'down';
				deco = 'zzz';
				eyeMode = 'shut';
			} else if (reaction) {
				poseKey = reaction.pose;
				deco = reaction.deco;
			} else if (clock < blinkUntil) eyeMode = 'shut';
			if (!deco && clock < celebrateUntil) deco = 'sparks';

			const hopPhase = (clock % HOP_CYCLE) / HOP_CYCLE;
			const airborne =
				!reduced && mode === 'ground' && hopPhase > 0.22 && hopPhase < 0.78 && poseKey === 'idle' && !asleep && !dizzy;
			const lift = reduced
				? 0
				: art.float
					? (Math.sin(clock / 780) + 1) * 0.6
					: art.hop && airborne
						? Math.sin(((hopPhase - 0.22) / 0.56) * Math.PI) * 2.4
						: 0;

			const b = bounds();
			if (mode === 'throw') advance(dt);
			else if (mode === 'ground') {
				y = b.floor;
				rot = 0;
				if (bounceCount > 0 && clock > bounceResultUntil) {
					bounceCount = 0;
					combo = 0;
				}
				if (!reduced && !asleep && !dizzy && !reaction && clock > splatUntil) {
					const step = art.hop ? (airborne ? 1.15 : 0) : art.float ? 0.38 : 0.55;
					x += dir * step;
					if (x < b.minL) {
						x = b.minL;
						dir = 1;
						flip = false;
					}
					if (x > b.maxL) {
						x = b.maxL;
						dir = -1;
						flip = true;
					}
				}
				x = Math.max(b.minL, Math.min(b.maxL, x));
			}

			const frames = art.poses[poseKey];
			drawPet(ctx, art, frames[reduced ? 0 : frameAt(frames, clock)], {
				scale: SCALE,
				flip,
				gazeX,
				gazeY,
				eyeMode,
				deco,
				lift: mode === 'ground' ? lift : null,
				t: clock
			});
			el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px) rotate(${rot.toFixed(1)}deg)`;
		}
		raf = requestAnimationFrame(tick);

		return () => {
			cancelAnimationFrame(raf);
			removeEventListener('pointermove', onPointerMove);
			el.removeEventListener('pointerdown', onPointerDown);
			el.removeEventListener('pointerup', onPointerUp);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});
</script>

<canvas bind:this={canvas} width={PET_GRID * SCALE} height={PET_ROWS * SCALE} aria-hidden="true" tabindex="-1"
></canvas>
{#if combo > 0}
	<span class="pet-combo" class:hot={combo >= 20} aria-hidden="true">×{combo}</span>
{/if}

<style>
	canvas {
		position: fixed;
		left: 0;
		top: 0;
		z-index: 40;
		image-rendering: pixelated;
		cursor: grab;
		touch-action: none;
		transform-origin: 50% 58%;
	}
	canvas:active {
		cursor: grabbing;
	}
	/* Compteur de jonglage : posé en haut à droite, hors du chemin du compagnon lui-même. */
	.pet-combo {
		position: fixed;
		right: 16px;
		bottom: 16px;
		z-index: 41;
		pointer-events: none;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--accent);
	}
	.pet-combo.hot {
		color: #f0a020;
	}
</style>
