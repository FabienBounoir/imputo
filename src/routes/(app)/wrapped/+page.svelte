<script lang="ts">
	import { onMount } from 'svelte';
	import { gsap } from 'gsap';

	let { data } = $props();
	const w = data.wrapped;

	let appEl: HTMLDivElement | undefined = $state();

	onMount(() => {
		if (!w) return;
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		// ============================================================
		// Procedural wireframe illustrations — same faceted technique
		// reused for every slide's signature shape, one distinct
		// silhouette per stat category. Only the brand mark (cover /
		// summary watermark) is an actual cog.
		// ============================================================
		const SVGNS = 'http://www.w3.org/2000/svg';
		function pathFromPoints(pts: number[][], close: boolean) {
			let d = 'M ' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L ');
			if (close) d += ' Z';
			return d;
		}
		function svgEl(tag: string, attrs: Record<string, string | number>) {
			const e = document.createElementNS(SVGNS, tag);
			for (const k in attrs) e.setAttribute(k, String(attrs[k]));
			return e;
		}
		function addPath(svg: SVGElement, pts: number[][], cls: string, close = true) {
			svg.appendChild(svgEl('path', { d: pathFromPoints(pts, close), class: cls }));
		}
		function addCircle(svg: SVGElement, cx: number, cy: number, r: number, cls: string) {
			svg.appendChild(svgEl('circle', { cx, cy, r, class: cls }));
		}

		function gearPoints(teeth: number, outerR: number, innerR: number, cx: number, cy: number) {
			const pts: number[][] = [];
			const step = (Math.PI * 2) / (teeth * 2);
			for (let i = 0; i < teeth * 2; i++) {
				const r = i % 2 === 0 ? outerR : innerR;
				const a = i * step - Math.PI / 2;
				pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
			}
			return pts;
		}
		function circlePoints(cx: number, cy: number, r: number, segments: number) {
			const pts: number[][] = [];
			for (let i = 0; i < segments; i++) {
				const a = (i / segments) * Math.PI * 2 - Math.PI / 2;
				pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
			}
			return pts;
		}
		function teardropPoints(cx: number, cy: number, r: number, steps: number) {
			const pts: number[][] = [];
			for (let i = 0; i <= steps; i++) {
				const t = (i / steps) * Math.PI * 2;
				const x = r * Math.cos(t);
				const y = r * Math.sin(t) * Math.sin(t / 2);
				pts.push([cx + y, cy - x]);
			}
			return pts;
		}
		function shieldPoints(cx: number, cy: number, w2: number, h2: number, scale = 1) {
			const raw = [
				[-0.42, -0.5],
				[0.42, -0.5],
				[0.5, -0.02],
				[0, 0.5],
				[-0.5, -0.02]
			];
			return raw.map((p) => [cx + p[0] * w2 * scale, cy + p[1] * h2 * scale]);
		}
		function ticketPoints(cx: number, cy: number, w2: number, h2: number, notches: number) {
			const x0 = cx - w2 / 2,
				x1 = cx + w2 / 2,
				y0 = cy - h2 / 2,
				y1 = cy + h2 / 2,
				c = 12;
			const pts: number[][] = [
				[x0 + c, y0],
				[x1 - c, y0],
				[x1, y0 + c]
			];
			for (let i = 1; i <= notches; i++) {
				const t = i / notches;
				const y = y0 + c + t * (h2 - 2 * c);
				pts.push([x1 - (i % 2 === 0 ? 8 : 0), y]);
			}
			pts.push([x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c]);
			return pts;
		}
		function spiralPoints(turns: number, cx: number, cy: number, rMax: number, steps: number) {
			const pts: number[][] = [];
			for (let i = 0; i <= steps; i++) {
				const t = i / steps;
				const a = t * Math.PI * 2 * turns;
				const r = t * rMax;
				pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
			}
			return pts;
		}

		const shapeBuilders: Record<string, (svg: SVGElement, opts?: { face?: boolean }) => void> = {
			gear: (svg) => {
				addPath(svg, gearPoints(6, 88, 66, 100, 100), 'rw-outer');
				addCircle(svg, 100, 100, 15, 'rw-hub');
			},
			ticket: (svg) => {
				addPath(svg, ticketPoints(100, 100, 152, 100, 7), 'rw-outer');
				addCircle(svg, 100, 100, 7, 'rw-hole');
			},
			flame: (svg) => {
				addPath(svg, teardropPoints(100, 108, 80, 40), 'rw-outer');
				addPath(svg, teardropPoints(100, 116, 42, 40), 'rw-inner');
			},
			coin: (svg, opts) => {
				addPath(svg, circlePoints(100, 100, 86, 28), 'rw-outer');
				addPath(svg, circlePoints(100, 100, 60, 24), 'rw-inner');
				if (opts?.face) {
					addCircle(svg, 82, 90, 6, 'rw-mark-fill');
					addCircle(svg, 118, 90, 6, 'rw-mark-fill');
					addPath(
						svg,
						[
							[78, 116],
							[100, 130],
							[122, 116]
						],
						'rw-mark',
						false
					);
				}
			},
			shield: (svg) => {
				addPath(svg, shieldPoints(100, 100, 148, 158, 1), 'rw-outer');
				addPath(svg, shieldPoints(100, 100, 148, 158, 0.68), 'rw-inner');
			},
			spiral: (svg) => {
				addPath(svg, spiralPoints(3.2, 100, 100, 92, 140), 'rw-line', false);
			},
			duo: (svg) => {
				addPath(svg, circlePoints(80, 100, 60, 26), 'rw-outer');
				addPath(svg, circlePoints(80, 100, 40, 22), 'rw-inner');
				addPath(svg, circlePoints(124, 100, 60, 26), 'rw-outer-dim');
				addPath(svg, circlePoints(124, 100, 40, 22), 'rw-inner-dim');
			}
		};

		document.querySelectorAll<SVGElement>('svg[data-shape]').forEach((svg) => {
			const type = svg.dataset.shape!;
			const face = svg.dataset.face === 'true';
			shapeBuilders[type]?.(svg, { face });
		});

		document.querySelectorAll<HTMLElement>('.swatch-grid').forEach((grid) => {
			const pct = Number(grid.dataset.pct ?? '0');
			for (let k = 0; k < 40; k++) {
				const i = document.createElement('i');
				if (k < Math.round(40 * (pct / 100))) i.className = 'on';
				grid.appendChild(i);
			}
		});

		document.querySelectorAll<HTMLElement>('.glow').forEach((g) => {
			g.insertAdjacentHTML('afterend', '<div class="sweep"></div>');
		});

		// Particules de fond — un style de mouvement différent par écran (data-particles), pas
		// juste le même flottement partout. La forme (cercle/carré) reste commune : la variété
		// vient du mouvement, pas d'un nouveau jeu de CSS par style.
		if (!reduceMotion) {
			function spawn(slide: HTMLElement, count: number, square = false) {
				const pts: HTMLElement[] = [];
				for (let i = 0; i < count; i++) {
					const p = document.createElement('span');
					p.className = square ? 'spark square' : 'spark';
					const size = gsap.utils.random(2, 5);
					p.style.width = size + 'px';
					p.style.height = size + 'px';
					slide.appendChild(p);
					pts.push(p);
				}
				return pts;
			}

			const particleStyles: Record<string, (slide: HTMLElement) => void> = {
				// Arrivée calme : ça monte doucement et ça respire.
				drift: (slide) => {
					spawn(slide, 34).forEach((p) => {
						p.style.left = gsap.utils.random(4, 96) + '%';
						p.style.top = gsap.utils.random(6, 96) + '%';
						gsap.to(p, {
							y: '-=' + gsap.utils.random(30, 70),
							x: '+=' + gsap.utils.random(-15, 15),
							opacity: () => gsap.utils.random(0.2, 0.75),
							scale: () => gsap.utils.random(0.6, 1.5),
							duration: () => gsap.utils.random(4, 8),
							repeat: -1,
							yoyo: true,
							ease: 'sine.inOut',
							delay: gsap.utils.random(0, 4)
						});
					});
				},
				// Confettis de ticket déchiré : tombent du haut en tournant.
				confetti: (slide) => {
					spawn(slide, 46, true).forEach((p) => {
						p.style.left = gsap.utils.random(0, 100) + '%';
						p.style.top = gsap.utils.random(-15, 15) + '%';
						gsap.set(p, { rotation: gsap.utils.random(0, 360) });
						gsap.to(p, {
							y: '+=' + gsap.utils.random(320, 560),
							x: '+=' + gsap.utils.random(-40, 40),
							rotation: '+=' + gsap.utils.random(180, 540),
							opacity: () => gsap.utils.random(0.35, 1),
							duration: () => gsap.utils.random(4, 8),
							repeat: -1,
							ease: 'none',
							delay: gsap.utils.random(0, 6)
						});
					});
				},
				// Braises qui montent vite depuis le bas, façon étincelles de feu.
				ember: (slide) => {
					spawn(slide, 42).forEach((p) => {
						p.style.left = gsap.utils.random(0, 100) + '%';
						p.style.top = gsap.utils.random(45, 100) + '%';
						gsap.to(p, {
							y: '-=' + gsap.utils.random(90, 180),
							x: '+=' + gsap.utils.random(-25, 25),
							opacity: () => gsap.utils.random(0.3, 0.95),
							scale: () => gsap.utils.random(0.5, 1.3),
							duration: () => gsap.utils.random(1.8, 3.6),
							repeat: -1,
							ease: 'power1.out',
							delay: gsap.utils.random(0, 3.5)
						});
					});
				},
				// Bulles qui flottent lentement, un peu de tangage.
				bubble: (slide) => {
					spawn(slide, 30).forEach((p) => {
						p.style.left = gsap.utils.random(4, 96) + '%';
						p.style.top = gsap.utils.random(20, 100) + '%';
						gsap.to(p, {
							y: '-=' + gsap.utils.random(60, 130),
							x: '+=' + gsap.utils.random(-20, 20),
							opacity: () => gsap.utils.random(0.2, 0.7),
							scale: () => gsap.utils.random(0.7, 1.8),
							duration: () => gsap.utils.random(5, 9),
							repeat: -1,
							ease: 'sine.inOut',
							delay: gsap.utils.random(0, 5)
						});
					});
				},
				// Points fixes qui clignotent, façon radar/scanner.
				twinkle: (slide) => {
					spawn(slide, 30).forEach((p) => {
						p.style.left = gsap.utils.random(4, 96) + '%';
						p.style.top = gsap.utils.random(6, 96) + '%';
						gsap.to(p, {
							opacity: () => gsap.utils.random(0.1, 0.95),
							scale: () => gsap.utils.random(0.4, 2),
							duration: () => gsap.utils.random(1, 2.6),
							repeat: -1,
							yoyo: true,
							ease: 'sine.inOut',
							delay: gsap.utils.random(0, 3)
						});
					});
				},
				// Orbite autour du centre, comme la spirale de l'écran volume.
				orbit: (slide) => {
					spawn(slide, 22).forEach((p) => {
						p.style.left = '50%';
						p.style.top = '50%';
						const radius = gsap.utils.random(14, 44);
						const dir = Math.random() < 0.5 ? 1 : -1;
						const proxy = { a: gsap.utils.random(0, 360) };
						const applyOrbit = () => {
							const rad = (proxy.a * Math.PI) / 180;
							p.style.transform = `translate(${Math.cos(rad) * radius}vmin, ${Math.sin(rad) * radius}vmin)`;
						};
						applyOrbit();
						gsap.to(proxy, {
							a: '+=' + dir * 360,
							duration: () => gsap.utils.random(7, 16),
							repeat: -1,
							ease: 'none',
							onUpdate: applyOrbit
						});
						gsap.to(p, {
							opacity: () => gsap.utils.random(0.3, 0.9),
							duration: () => gsap.utils.random(1.5, 3),
							repeat: -1,
							yoyo: true,
							ease: 'sine.inOut',
							delay: gsap.utils.random(0, 3)
						});
					});
				},
				// Balancement doux de gauche à droite, façon deux silhouettes qui bougent ensemble.
				sway: (slide) => {
					spawn(slide, 26).forEach((p) => {
						p.style.left = gsap.utils.random(8, 92) + '%';
						p.style.top = gsap.utils.random(10, 95) + '%';
						const amp = gsap.utils.random(10, 28);
						const proxy = { a: gsap.utils.random(0, 360) };
						const applySway = () => {
							const rad = (proxy.a * Math.PI) / 180;
							p.style.transform = `translate(${Math.sin(rad) * amp}px, ${-Math.abs(Math.cos(rad)) * amp * 0.5}px)`;
						};
						applySway();
						gsap.to(proxy, {
							a: '+=360',
							duration: () => gsap.utils.random(5, 9),
							repeat: -1,
							ease: 'none',
							onUpdate: applySway
						});
						gsap.to(p, {
							opacity: () => gsap.utils.random(0.25, 0.85),
							duration: () => gsap.utils.random(1.5, 3),
							repeat: -1,
							yoyo: true,
							ease: 'sine.inOut',
							delay: gsap.utils.random(0, 3)
						});
					});
				},
				// Jaillissent du bas et montent en grand, façon feu d'artifice pour le récap final.
				fountain: (slide) => {
					spawn(slide, 34).forEach((p) => {
						p.style.left = gsap.utils.random(20, 80) + '%';
						p.style.top = '95%';
						gsap.to(p, {
							y: '-=' + gsap.utils.random(240, 420),
							x: '+=' + gsap.utils.random(-60, 60),
							opacity: () => gsap.utils.random(0.5, 1),
							scale: () => gsap.utils.random(0.6, 1.4),
							duration: () => gsap.utils.random(3, 5.5),
							repeat: -1,
							ease: 'power1.out',
							delay: gsap.utils.random(0, 5)
						});
					});
				}
			};

			document.querySelectorAll<HTMLElement>('.slide').forEach((slide) => {
				const style = slide.dataset.particles ?? 'drift';
				(particleStyles[style] ?? particleStyles.drift)(slide);
			});
		}

		// ============================================================
		// Navigation
		// ============================================================
		const reel = document.getElementById('reel')!;
		const slides = Array.from(document.querySelectorAll<HTMLElement>('.slide'));
		const chaptersWrap = document.getElementById('chapters')!;
		const prevBtn = document.getElementById('prevBtn') as HTMLButtonElement;
		const nextBtn = document.getElementById('nextBtn') as HTMLButtonElement;
		let index = 0;
		try {
			const saved = parseInt(localStorage.getItem('imputo-wrapped-index') || '0', 10);
			if (saved > 0 && saved < slides.length) index = saved;
		} catch {
			/* stockage indisponible (navigation privée…) — on repart de l'écran 0 */
		}

		// Un chapitre reste un simple point tant que son écran n'a pas été atteint — l'icône
		// (qui trahit le sujet de la stat) n'apparaît qu'à l'arrivée dessus, pour garder un peu de
		// suspense. Une fois révélée, elle le reste (on ne re-cache jamais un chapitre déjà vu).
		slides.forEach((slide, i) => {
			const b = document.createElement('button');
			b.className = 'chapter';
			b.setAttribute('aria-label', `Aller à l'écran ${i + 1}`);
			b.innerHTML = `<span class="chapter-dot"></span><svg class="chapter-icon"><use href="#${slide.dataset.icon}" /></svg>`;
			b.addEventListener('click', () => goTo(i));
			chaptersWrap.appendChild(b);
		});
		const chapters = Array.from(chaptersWrap.children) as HTMLElement[];

		function revealChapter(i: number, animate: boolean) {
			const chapter = chapters[i];
			if (!chapter || chapter.classList.contains('revealed')) return;
			chapter.classList.add('revealed');
			if (animate && !reduceMotion) {
				const icon = chapter.querySelector('.chapter-icon');
				gsap.fromTo(icon, { scale: 0.3, rotate: -25, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.5, ease: 'back.out(2.5)' });
			}
		}

		function animateNumber(el: HTMLElement) {
			const target = parseFloat(el.dataset.target ?? '0');
			const decimals = parseInt(el.dataset.decimals ?? '0', 10);
			if (reduceMotion) {
				el.textContent = target.toFixed(decimals);
				return;
			}
			const proxy = { v: 0 };
			gsap.to(proxy, {
				v: target,
				duration: 1,
				ease: 'power3.out',
				onUpdate: () => {
					el.textContent = proxy.v.toFixed(decimals);
				}
			});
		}

		function revealRing(slide: HTMLElement) {
			const paths = slide.querySelectorAll<SVGPathElement>('.ring-wrap path, .pass-gear path');
			paths.forEach((p) => {
				const len = p.getTotalLength ? p.getTotalLength() : 0;
				if (!len) return;
				if (reduceMotion) {
					p.style.strokeDasharray = 'none';
					return;
				}
				p.style.strokeDasharray = String(len);
				gsap.fromTo(p, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.3, ease: 'power2.out' });
			});
			const ring = slide.querySelector<SVGElement>('.ring-wrap svg, .cover-mark svg');
			if (ring && !reduceMotion) {
				gsap.killTweensOf(ring);
				gsap.fromTo(ring, { rotate: -6, transformOrigin: '50% 50%' }, { rotate: 0, duration: 1.1, ease: 'power2.out' });
				const host = ring.closest<HTMLElement>('[data-motion]');
				const mode = host?.getAttribute('data-motion') ?? 'spin';
				if (mode === 'spin') {
					gsap.to(ring, { rotate: 360, duration: 90, ease: 'none', repeat: -1, delay: 1.1 });
				} else {
					gsap.to(ring, { y: '+=12', duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 1.1 });
				}
			}
		}

		function place() {
			const x = -index * window.innerWidth;
			gsap.set(reel, { x });
		}

		function goTo(i: number) {
			index = Math.max(0, Math.min(slides.length - 1, i));
			const x = -index * window.innerWidth;
			if (!reduceMotion) gsap.to(reel, { x, duration: 0.7, ease: 'power3.inOut' });
			else reel.style.transform = `translateX(${x}px)`;
			chapters.forEach((c, ci) => c.classList.toggle('active', ci === index));
			revealChapter(index, true);
			prevBtn.disabled = index === 0;
			nextBtn.disabled = index === slides.length - 1;
			const active = slides[index];
			active.querySelectorAll<HTMLElement>('.count').forEach(animateNumber);
			revealRing(active);
			try {
				localStorage.setItem('imputo-wrapped-index', String(index));
			} catch {
				/* stockage indisponible */
			}
		}

		window.addEventListener('resize', place);
		prevBtn.addEventListener('click', () => goTo(index - 1));
		nextBtn.addEventListener('click', () => goTo(index + 1));
		document.getElementById('tapLeft')?.addEventListener('click', () => goTo(index - 1));
		document.getElementById('tapRight')?.addEventListener('click', () => goTo(index + 1));
		document.getElementById('startBtn')?.addEventListener('click', () => {
			goTo(index + 1);
			startAudio();
		});
		document.getElementById('restartBtn')?.addEventListener('click', () => goTo(0));
		window.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowRight') goTo(index + 1);
			if (e.key === 'ArrowLeft') goTo(index - 1);
			if (e.key === 'Escape') window.location.href = '/imputation';
		});

		let touchX: number | null = null;
		appEl!.addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX), { passive: true });
		appEl!.addEventListener(
			'touchend',
			(e) => {
				if (touchX === null) return;
				const dx = e.changedTouches[0].clientX - touchX;
				if (Math.abs(dx) > 50) goTo(index + (dx < 0 ? 1 : -1));
				touchX = null;
			},
			{ passive: true }
		);

		// Restauration d'une session précédente (index sauvegardé > 0) : les chapitres déjà vus se
		// révèlent d'un coup, sans l'animation — celle-ci est réservée aux nouvelles découvertes.
		for (let k = 0; k < index; k++) revealChapter(k, false);
		place();
		goTo(index);

		// ---- musique d'ambiance (loop natif, cf. l'attribut sur <audio>) ----
		// L'état affiché (icône, aria-pressed) est dérivé des événements play/pause réels de
		// l'élément plutôt que d'une variable à part : rien à resynchroniser si play()/pause()
		// est déclenché depuis plusieurs endroits (autoplay, clic mute, déblocage 1ère interaction).
		const bgm = document.getElementById('bgm') as HTMLAudioElement;
		bgm.volume = 0.55;
		const muteBtn = document.getElementById('muteBtn')!;
		const muteIconUse = document.getElementById('muteIconUse')!;
		function syncMuteUI() {
			const playing = !bgm.paused;
			muteBtn.setAttribute('aria-pressed', String(playing));
			muteIconUse.setAttribute('href', playing ? '#i-speaker' : '#i-mute');
		}
		bgm.addEventListener('play', syncMuteUI);
		bgm.addEventListener('pause', syncMuteUI);
		function startAudio() {
			bgm.play().catch(() => {});
		}
		muteBtn.addEventListener('click', () => {
			if (bgm.paused) startAudio();
			else bgm.pause();
		});
		// Tentative de lecture dès l'arrivée sur la page — la plupart des navigateurs la bloquent
		// sans geste utilisateur au préalable (surtout après un simple rechargement, où l'atterrissage
		// peut se faire sur un écran autre que la couverture, donc sans passer par "Commencer").
		// Filet : la toute première interaction ailleurs que sur le bouton mute la débloque.
		startAudio();
		function unlockAudioOnce(e: Event) {
			if (muteBtn.contains(e.target as Node)) return; // laisse son propre clic gérer ce cas
			if (bgm.paused) startAudio();
		}
		window.addEventListener('pointerdown', unlockAudioOnce, { once: true });
		window.addEventListener('keydown', unlockAudioOnce, { once: true });

		// ---- carte résumé : copie texte + export PNG (téléchargement navigateur classique) ----
		const actionToast = document.getElementById('actionToast')!;
		function showToast(msg: string) {
			actionToast.textContent = msg;
			actionToast.classList.add('show');
			setTimeout(() => actionToast.classList.remove('show'), 2200);
		}

		const summaryText = [
			`Mon Imputo Wrapped ${w.year} :`,
			`${w.totalHours}h imputées`,
			w.topTicket ? `${Math.round(w.topTicket.hours)}h sur ${w.topTicket.key}` : null,
			w.streakDays ? `série de ${w.streakDays} jours` : null,
			w.moodAvg !== null ? `humeur ${w.moodAvg}/5` : null,
			w.supportEnabled && w.supportCount ? `${w.supportCount}× de perm support` : null
		]
			.filter(Boolean)
			.join(', ');

		document.getElementById('shareBtn')?.addEventListener('click', () => {
			const ok = () => showToast('Copié ✓');
			if (navigator.clipboard?.writeText) navigator.clipboard.writeText(summaryText).then(ok, ok);
			else ok();
		});

		document.getElementById('downloadBtn')?.addEventListener('click', async () => {
			try {
				await document.fonts?.ready;
			} catch {
				/* polices déjà prêtes, ou API indisponible */
			}
			const canvas = document.getElementById('exportCanvas') as HTMLCanvasElement;
			const ctx = canvas.getContext('2d')!;
			const W = canvas.width,
				H = canvas.height;

			const grad = ctx.createLinearGradient(0, 0, 0, H);
			grad.addColorStop(0, '#14121c');
			grad.addColorStop(1, '#0a0a10');
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, W, H);

			ctx.save();
			ctx.globalAlpha = 0.12;
			ctx.strokeStyle = '#22c55e';
			ctx.lineWidth = 4;
			ctx.beginPath();
			const gp = gearPoints(6, 240, 180, W - 60, 220);
			ctx.moveTo(gp[0][0], gp[0][1]);
			gp.slice(1).forEach((p) => ctx.lineTo(p[0], p[1]));
			ctx.closePath();
			ctx.stroke();
			ctx.restore();

			ctx.strokeStyle = '#22c55e';
			ctx.lineWidth = 3;
			ctx.strokeRect(24, 24, W - 48, H - 48);

			ctx.fillStyle = '#22c55e';
			ctx.font = "700 22px 'Space Mono', monospace";
			ctx.fillText(`✦ IMPUTO · WRAPPED ${w.year}`, 60, 100);

			ctx.fillStyle = '#22c55e';
			ctx.font = "56px 'Press Start 2P', monospace";
			ctx.fillText(`${w.totalHours}h`, 60, 210);
			ctx.fillStyle = '#b9b3cc';
			ctx.font = "700 16px 'Space Mono', monospace";
			ctx.fillText('HEURES IMPUTÉES CETTE ANNÉE', 60, 240);

			ctx.strokeStyle = 'rgba(185,179,204,0.35)';
			ctx.setLineDash([6, 6]);
			ctx.beginPath();
			ctx.moveTo(60, 290);
			ctx.lineTo(W - 60, 290);
			ctx.stroke();
			ctx.setLineDash([]);

			const rows: [string, string][] = [
				...(w.topTicket ? ([['Ticket le + chronophage', `${w.topTicket.key} · ${Math.round(w.topTicket.hours)}h`]] as [string, string][]) : []),
				...(w.streakDays ? ([['Série max', `${w.streakDays} jours`]] as [string, string][]) : []),
				...(w.moodAvg !== null ? ([['Humeur moyenne', `${w.moodAvg} / 5`]] as [string, string][]) : []),
				...(w.supportEnabled && w.supportCount ? ([['Perm support', `${w.supportCount} fois`]] as [string, string][]) : []),
				...(w.duo ? ([['Duo de l’année', `${w.duo.displayName} · ${w.duo.ticketsInCommon} tickets`]] as [string, string][]) : [])
			];
			let y = 350;
			for (const [label, value] of rows) {
				ctx.fillStyle = '#22c55e';
				ctx.beginPath();
				ctx.arc(70, y - 6, 5, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillStyle = '#b9b3cc';
				ctx.font = "700 17px 'Space Mono', monospace";
				ctx.fillText(label, 92, y);
				ctx.fillStyle = '#f4f2fb';
				ctx.font = "700 18px 'Space Mono', monospace";
				const tw = ctx.measureText(value).width;
				ctx.fillText(value, W - 60 - tw, y);
				y += 62;
			}

			ctx.globalCompositeOperation = 'destination-out';
			for (const edgeX of [0, W]) {
				for (let py = 40; py < H; py += 26) {
					ctx.beginPath();
					ctx.arc(edgeX, py, 12, 0, Math.PI * 2);
					ctx.fill();
				}
			}
			ctx.globalCompositeOperation = 'source-over';

			ctx.fillStyle = '#b9b3cc';
			ctx.font = "700 13px 'Space Mono', monospace";
			ctx.globalAlpha = 0.6;
			ctx.fillText(`GÉNÉRÉ DEPUIS IMPUTO · ${w.year}`, 60, H - 50);
			ctx.globalAlpha = 1;

			canvas.toBlob((blob) => {
				if (!blob) return;
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `imputo-wrapped-${w.year}.png`;
				document.body.appendChild(a);
				a.click();
				a.remove();
				setTimeout(() => URL.revokeObjectURL(url), 4000);
				showToast('Image enregistrée ✓');
			}, 'image/png');
		});
	});
</script>

<svelte:head>
	<title>Imputo Wrapped {data.year}</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Space+Mono:wght@400;700&family=Unbounded:wght@700;800;900&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

{#if !w}
	<div class="empty">
		<h1>Pas encore de wrapped {data.year}</h1>
		<p>Le récap se génère automatiquement chaque nuit pendant la période — reviens un peu plus tard.</p>
		<a href="/imputation">Retour à mon imputation</a>
	</div>
{:else}
	<div class="app" bind:this={appEl}>
		<svg width="0" height="0" style="position:absolute">
			<defs>
				<symbol id="i-home" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
				</symbol>
				<symbol id="i-ticket" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z" />
				</symbol>
				<symbol id="i-flame" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 2s6 6 6 11.5A6 6 0 0 1 6 13.5C6 11 7.5 9.5 8.5 8.7c.1 1.2.9 1.8 1.6 1.8-.3-3 1-5.4 1.9-8.5z" />
				</symbol>
				<symbol id="i-face" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
				</symbol>
				<symbol id="i-shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z" />
				</symbol>
				<symbol id="i-activity" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M3 12h4l2 7 4-14 2 7h6" />
				</symbol>
				<symbol id="i-people" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path
						d="M16 3.13a4 4 0 0 1 0 7.75"
					/>
				</symbol>
				<symbol id="i-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M5 21V4" /><path d="M5 4h13l-3 4 3 4H5" />
				</symbol>
				<symbol id="i-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="9" /><path d="M12 3v18M3 12h18" />
				</symbol>
				<symbol id="i-calendar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" />
				</symbol>
				<symbol id="i-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
				</symbol>
				<symbol id="i-arrow-l" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
					><path d="M19 12H5M11 6l-6 6 6 6" /></symbol
				>
				<symbol id="i-arrow-r" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
					><path d="M5 12h14M13 6l6 6-6 6" /></symbol
				>
				<symbol id="i-speaker" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M4 9v6h4l5 5V4L8 9H4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" />
				</symbol>
				<symbol id="i-mute" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M4 9v6h4l5 5V4L8 9H4z" /><line x1="17.5" y1="8.5" x2="22" y2="15.5" /><line x1="22" y1="8.5" x2="17.5" y2="15.5" />
				</symbol>
				<symbol id="i-restart" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
				</symbol>
				<symbol id="i-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 19h16" />
				</symbol>
				<symbol id="i-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
					<rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
				</symbol>
				<symbol id="i-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M6 6l12 12M18 6L6 18" />
				</symbol>
			</defs>
		</svg>

		<div class="chrome">
			<div class="brand">✦ IMPUTO <span>WRAPPED</span></div>
			<div class="chapters" id="chapters"></div>
			<div class="chrome-actions">
				<button class="icon-btn" id="muteBtn" aria-label="Activer le son" aria-pressed="false">
					<svg><use href="#i-mute" id="muteIconUse" /></svg>
				</button>
				<button class="icon-btn" id="restartBtn" aria-label="Recommencer le wrapped">
					<svg><use href="#i-restart" /></svg>
				</button>
				<a class="icon-btn" href="/imputation" aria-label="Quitter le wrapped">
					<svg><use href="#i-close" /></svg>
				</a>
			</div>
		</div>

		<div class="stage">
			<div class="reel" id="reel">
				<section class="slide" data-accent="green" data-layout="cover" data-icon="i-home" data-particles="drift">
					<div class="glow"></div>
					<div class="content">
						<div class="cover-mark" data-motion="spin">
							<svg data-shape="gear" viewBox="0 0 200 200"></svg>
						</div>
						<h1 class="cover-title">{data.year}, en heures<br />et en tickets.</h1>
						<p class="cover-sub">Ton année sur Imputo, résumée en quelques écrans.</p>
						<button class="cover-cta" id="startBtn">
							Commencer
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
								><path d="M5 12h14M13 6l6 6-6 6" /></svg
							>
						</button>
					</div>
				</section>

				{#if w.topTicket}
					<section class="slide" data-accent="violet" data-icon="i-ticket" data-particles="confetti">
						<div class="glow"></div>
						<div class="content">
							<div class="stat">
								<div class="eyebrow"><svg><use href="#i-ticket" /></svg>Ticket le plus chronophage</div>
								<div class="stat-number"><span class="count" data-target={Math.round(w.topTicket.hours)}>0</span><span class="unit">heures</span></div>
								<p class="desc">C'est le temps que tu as donné à <mark>{w.topTicket.key}</mark> cette année. Il te le doit bien.</p>
								<div class="icon-row"><svg><use href="#i-globe" /></svg><svg><use href="#i-calendar" /></svg></div>
							</div>
							<div class="ring-wrap" data-motion="float"><svg data-shape="ticket" viewBox="0 0 200 200"></svg></div>
						</div>
					</section>
				{/if}

				{#if w.streakDays > 0}
					<section class="slide" data-accent="amber" data-flip="1" data-icon="i-flame" data-particles="ember">
						<div class="glow"></div>
						<div class="content">
							<div class="stat">
								<div class="eyebrow"><svg><use href="#i-flame" /></svg>Série en cours</div>
								<div class="stat-number"><span class="count" data-target={w.streakDays}>0</span><span class="unit">jours d'affilée</span></div>
								<p class="desc">
									{w.streakDays} jours ouvrés consécutifs sans oublier une seule imputation. Ton passé de retardataire ne te rattrapera pas cette
									année.
								</p>
								<div class="icon-row"><svg><use href="#i-globe" /></svg><svg><use href="#i-clock" /></svg></div>
							</div>
							<div class="ring-wrap" data-motion="float"><svg data-shape="flame" viewBox="0 0 200 200"></svg></div>
						</div>
					</section>
				{/if}

				{#if w.moodEnabled && w.moodAvg !== null}
					<section class="slide" data-accent="magenta" data-icon="i-face" data-particles="bubble">
						<div class="glow"></div>
						<div class="content">
							<div class="stat">
								<div class="eyebrow"><svg><use href="#i-face" /></svg>Humeur moyenne</div>
								<div class="stat-number"><span class="count" data-target={w.moodAvg} data-decimals="1">0</span><span class="unit">sur 5</span></div>
								<p class="desc">
									Ta moyenne sur toute l'année. Meilleur mois : <mark>{w.moodBestMonth}</mark>. Le plus dur : {w.moodWorstMonth}.
								</p>
								<div class="icon-row"><svg><use href="#i-globe" /></svg><svg><use href="#i-people" /></svg></div>
							</div>
							<div class="ring-wrap" data-motion="float"><svg data-shape="coin" data-face="true" viewBox="0 0 200 200"></svg></div>
						</div>
					</section>
				{/if}

				{#if w.supportEnabled && w.supportCount > 0}
					<section class="slide" data-accent="cyan" data-flip="1" data-icon="i-shield" data-particles="twinkle">
						<div class="glow"></div>
						<div class="content">
							<div class="stat">
								<div class="eyebrow"><svg><use href="#i-shield" /></svg>Perm support</div>
								<div class="stat-number"><span class="count" data-target={w.supportCount}>0</span><span class="unit">fois cette année</span></div>
								<p class="desc">{w.supportCount} fois à surveiller les tickets pour l'équipe. Elle te doit bien un café.</p>
								<div class="icon-row"><svg><use href="#i-globe" /></svg><svg><use href="#i-calendar" /></svg></div>
							</div>
							<div class="ring-wrap" data-motion="float"><svg data-shape="shield" viewBox="0 0 200 200"></svg></div>
						</div>
					</section>
				{/if}

				{#if w.totalHours > 0}
					<section class="slide" data-accent="violet" data-layout="headline" data-icon="i-activity" data-particles="orbit">
						<div class="glow"></div>
						<div class="content">
							<div>
								<h2 class="headline-title">On a tenu le rythme en {data.year}.</h2>
								<p class="headline-sub">Heures imputées, jours ouvrés, café bu</p>
								<div class="headline-stats">
									<div class="headline-stat">
										<div class="stat-number"><span class="count" data-target={w.totalHours}>0</span><span class="unit">h</span></div>
										<span class="stat-label">Heures imputées</span>
									</div>
									<div class="headline-stat">
										<div class="stat-number"><span class="count" data-target={w.productivePct}>0</span><span class="unit">%</span></div>
										<span class="stat-label">Temps productif</span>
									</div>
								</div>
								<div class="swatch-grid" data-pct={w.productivePct} aria-hidden="true"></div>
							</div>
							<div class="ring-wrap" data-motion="spin"><svg data-shape="spiral" viewBox="0 0 200 200"></svg></div>
						</div>
					</section>
				{/if}

				{#if w.duo}
					<section class="slide" data-accent="violet" data-flip="1" data-icon="i-people" data-particles="sway">
						<div class="glow"></div>
						<div class="content">
							<div class="stat">
								<div class="eyebrow"><svg><use href="#i-people" /></svg>Duo de l'année</div>
								<div class="stat-number"><span class="count" data-target={w.duo.ticketsInCommon}>0</span><span class="unit">tickets en commun</span></div>
								<p class="desc">Toi et <mark>{w.duo.displayName}</mark> avez bossé sur {w.duo.ticketsInCommon} tickets ensemble cette année. Ton duo le plus productif.</p>
								<div class="icon-row"><svg><use href="#i-globe" /></svg><svg><use href="#i-ticket" /></svg></div>
							</div>
							<div class="ring-wrap" data-motion="float"><svg data-shape="duo" viewBox="0 0 200 200"></svg></div>
						</div>
					</section>
				{/if}

				<section class="slide" data-accent="green" data-layout="summary" data-icon="i-flag" data-particles="fountain">
					<div class="glow"></div>
					<div class="content">
						<div class="pass" id="passCard">
							<svg class="pass-gear" data-shape="gear" viewBox="0 0 200 200"></svg>
							<div class="pass-top"><svg><use href="#i-flag" /></svg>Imputo · Wrapped {data.year}</div>
							<div class="pass-hero">{w.totalHours}h</div>
							<div class="pass-hero-label">Heures imputées cette année</div>
							<div class="pass-divider"></div>
							{#if w.topTicket}
								<div class="pass-row"><span class="who"><svg><use href="#i-ticket" /></svg>Ticket le + chronophage</span><span class="amt">{Math.round(w.topTicket.hours)}h</span></div>
							{/if}
							{#if w.streakDays > 0}
								<div class="pass-row"><span class="who"><svg><use href="#i-flame" /></svg>Série max</span><span class="amt">{w.streakDays}j</span></div>
							{/if}
							{#if w.moodAvg !== null}
								<div class="pass-row"><span class="who"><svg><use href="#i-face" /></svg>Humeur moyenne</span><span class="amt">{w.moodAvg}/5</span></div>
							{/if}
							{#if w.supportEnabled && w.supportCount > 0}
								<div class="pass-row"><span class="who"><svg><use href="#i-shield" /></svg>Perm support</span><span class="amt">{w.supportCount}×</span></div>
							{/if}
							<div class="pass-foot">imputo · année {data.year}</div>
						</div>
						<div>
							<div class="summary-eyebrow"><svg><use href="#i-flag" /></svg>Ton année</div>
							<h2 class="summary-title">En résumé</h2>
							<p class="summary-desc">Ta carte Wrapped, prête à garder ou à montrer à l'équipe.</p>
							<div class="summary-actions">
								<button class="btn btn-primary" id="downloadBtn"><svg><use href="#i-download" /></svg>Télécharger l'image</button>
								<button class="btn btn-ghost" id="shareBtn"><svg><use href="#i-copy" /></svg>Copier le texte</button>
							</div>
							<span class="share-toast" id="actionToast"></span>
						</div>
					</div>
				</section>
			</div>
		</div>

		<button class="nav-arrow prev" id="prevBtn" aria-label="Écran précédent"><svg><use href="#i-arrow-l" /></svg></button>
		<button class="nav-arrow next" id="nextBtn" aria-label="Écran suivant"><svg><use href="#i-arrow-r" /></svg></button>
		<button class="tap-zone tap-left" id="tapLeft" aria-hidden="true" tabindex="-1"></button>
		<button class="tap-zone tap-right" id="tapRight" aria-hidden="true" tabindex="-1"></button>
	</div>

	<canvas id="exportCanvas" width="900" height="1260" style="display:none"></canvas>

	<!-- Musique d'ambiance : loop natif (relance automatiquement à la fin). -->
	<audio id="bgm" src="/wrapped_music.mp3" loop preload="auto"></audio>
{/if}

<style>
	.empty {
		min-height: 60vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 0.6rem;
		padding: 3rem 1.5rem;
	}

	/* Scopé à .app (pas :root) : ce fichier CSS reste chargé après avoir quitté la page en
	   navigation SPA — un :root ici écraserait durablement --accent (et le thème RGB/Disco) sur
	   le reste de l'appli. */
	.app,
	.app * {
		box-sizing: border-box;
	}

	.app {
		--ink: #0a0a10;
		--ink-2: #14121c;
		--fg: #f4f2fb;
		--fg-dim: #b9b3cc;
		--green: #22c55e;
		--violet: #a78bfa;
		--amber: #f5b84a;
		--magenta: #ff4fa0;
		--cyan: #45e0d8;
		--accent: var(--green);
		--font-display: 'Unbounded', 'Arial Black', sans-serif;
		--font-pixel: 'Press Start 2P', 'Courier New', monospace;
		--font-mono: 'Space Mono', 'SF Mono', Consolas, monospace;

		position: fixed;
		inset: 0;
		background: var(--ink);
		color: var(--fg);
		font-family: var(--font-mono);
		-webkit-font-smoothing: antialiased;
		overflow: hidden;
		z-index: 40;
	}

	.app :global(button) {
		font-family: inherit;
		cursor: pointer;
	}

	.app :global(:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}

	.app :global(mark) {
		background: var(--accent);
		color: var(--ink);
		padding: 0.05em 0.4em;
		border-radius: 3px;
		font-weight: 700;
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}

	.app :global(svg) {
		display: block;
	}

	.chrome {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 20;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 1rem;
		padding: 1.1rem 1.4rem;
	}

	.brand {
		justify-self: start;
		display: flex;
		align-items: baseline;
		gap: 0.4em;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 0.95rem;
		letter-spacing: 0.02em;
		color: var(--accent);
		white-space: nowrap;
	}
	.brand span {
		color: var(--fg-dim);
		font-weight: 700;
		opacity: 0.85;
	}

	.chapters {
		display: flex;
		justify-content: center;
		gap: 0.3rem;
	}
	.chapters :global(.chapter) {
		width: 30px;
		height: 30px;
		border-radius: 8px;
		border: none;
		background: transparent;
		color: var(--fg-dim);
		opacity: 0.5;
		display: grid;
		place-items: center;
		transition:
			color 0.3s,
			opacity 0.3s,
			background 0.3s,
			transform 0.3s;
	}
	/* Empilées dans la même cellule (grid-area partagée) : le point disparaît, l'icône apparaît —
	   jamais les deux en même temps. Tant qu'un chapitre n'est pas "revealed", seul le point se
	   voit : on ne sait pas encore ce que l'écran à venir raconte. */
	.chapters :global(.chapter-dot) {
		grid-area: 1 / 1;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.6;
		transition: opacity 0.3s;
	}
	.chapters :global(.chapter-icon) {
		grid-area: 1 / 1;
		width: 15px;
		height: 15px;
		opacity: 0;
		transform: scale(0.3);
		transition:
			opacity 0.3s,
			transform 0.3s;
	}
	.chapters :global(.chapter.revealed .chapter-dot) {
		opacity: 0;
	}
	.chapters :global(.chapter.revealed .chapter-icon) {
		opacity: 1;
		transform: scale(1);
	}
	.chapters :global(.chapter.active) {
		color: var(--accent);
		opacity: 1;
		background: color-mix(in srgb, var(--accent) 16%, transparent);
		transform: scale(1.06);
	}

	.chrome-actions {
		justify-self: end;
		display: flex;
		gap: 0.5rem;
	}
	.icon-btn {
		width: 34px;
		height: 34px;
		border-radius: 7px;
		border: 1.4px solid var(--fg-dim);
		background: rgba(255, 255, 255, 0.02);
		color: var(--fg);
		display: grid;
		place-items: center;
		opacity: 0.85;
		transition:
			border-color 0.3s,
			color 0.3s,
			opacity 0.2s;
	}
	.icon-btn:hover {
		opacity: 1;
		border-color: var(--accent);
		color: var(--accent);
	}
	.icon-btn svg {
		width: 15px;
		height: 15px;
	}

	.stage {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	.reel {
		display: flex;
		height: 100%;
		will-change: transform;
	}

	.slide {
		position: relative;
		flex: 0 0 100vw;
		height: 100%;
		display: grid;
		place-items: center;
		padding: 0 6vw;
		isolation: isolate;
		overflow: hidden;
	}

	.slide::before {
		content: '';
		position: absolute;
		inset: -40px;
		z-index: -2;
		background-image: radial-gradient(circle, var(--accent) 1px, transparent 1.3px);
		background-size: 15px 15px;
		opacity: 0.22;
		animation: grain-drift 14s linear infinite;
	}
	.slide::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background:
			radial-gradient(120% 90% at 50% 30%, transparent 0%, var(--ink) 78%),
			linear-gradient(180deg, var(--ink-2), var(--ink));
	}
	.slide[data-accent='green'] {
		--accent: var(--green);
	}
	.slide[data-accent='violet'] {
		--accent: var(--violet);
	}
	.slide[data-accent='amber'] {
		--accent: var(--amber);
	}
	.slide[data-accent='magenta'] {
		--accent: var(--magenta);
	}
	.slide[data-accent='cyan'] {
		--accent: var(--cyan);
	}

	.glow {
		position: absolute;
		width: 46vw;
		height: 46vw;
		max-width: 520px;
		max-height: 520px;
		border-radius: 50%;
		background: radial-gradient(circle, var(--accent) 0%, transparent 62%);
		filter: blur(80px);
		opacity: 0.2;
		z-index: -1;
		pointer-events: none;
		animation: glow-pulse 6s ease-in-out infinite;
	}
	@keyframes glow-pulse {
		0%,
		100% {
			transform: translate(-8%, -6%) scale(0.9);
			opacity: 0.14;
		}
		50% {
			transform: translate(8%, 7%) scale(1.2);
			opacity: 0.32;
		}
	}
	@keyframes grain-drift {
		0%,
		100% {
			transform: translate(0, 0);
		}
		50% {
			transform: translate(-34px, 26px);
		}
	}
	@keyframes sweep-move {
		0%,
		100% {
			transform: translateX(-18%);
		}
		50% {
			transform: translateX(18%);
		}
	}

	.slide :global(.sweep) {
		position: absolute;
		inset: -50%;
		z-index: -1;
		pointer-events: none;
		background: linear-gradient(115deg, transparent 42%, color-mix(in srgb, var(--accent) 9%, transparent) 50%, transparent 58%);
		animation: sweep-move 8s ease-in-out infinite;
	}
	.slide :global(.spark) {
		position: absolute;
		border-radius: 50%;
		background: var(--accent);
		opacity: 0;
		pointer-events: none;
		z-index: 0;
	}
	.slide :global(.spark.square) {
		border-radius: 1px;
	}

	.content {
		position: relative;
		width: min(1080px, 100%);
		display: grid;
		grid-template-columns: 1fr 1fr;
		align-items: center;
		gap: 4vw;
	}
	.slide[data-flip='1'] .content {
		direction: rtl;
	}
	.slide[data-flip='1'] .content > * {
		direction: ltr;
	}

	.ring-wrap {
		display: grid;
		place-items: center;
		color: var(--accent);
		opacity: 0.9;
	}
	.ring-wrap svg {
		width: min(42vw, 340px);
		height: min(42vw, 340px);
		overflow: visible;
	}

	.ring-wrap :global(.rw-outer),
	.pass-gear :global(.rw-outer),
	.cover-mark :global(.rw-outer) {
		fill: color-mix(in srgb, var(--accent) 16%, transparent);
		stroke: var(--accent);
		stroke-width: 3.5;
		stroke-linejoin: round;
	}
	.ring-wrap :global(.rw-inner),
	.pass-gear :global(.rw-inner),
	.cover-mark :global(.rw-inner) {
		fill: none;
		stroke: var(--accent);
		stroke-width: 2.5;
		opacity: 0.6;
	}
	.ring-wrap :global(.rw-line) {
		fill: none;
		stroke: var(--accent);
		stroke-width: 3;
	}
	.ring-wrap :global(.rw-hub),
	.pass-gear :global(.rw-hub),
	.cover-mark :global(.rw-hub) {
		fill: var(--accent);
	}
	.ring-wrap :global(.rw-hole) {
		fill: var(--ink);
		stroke: var(--accent);
		stroke-width: 2.5;
	}
	.ring-wrap :global(.rw-mark) {
		fill: none;
		stroke: var(--fg);
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.ring-wrap :global(.rw-mark-fill) {
		fill: var(--fg);
	}
	.ring-wrap :global(.rw-outer-dim) {
		fill: color-mix(in srgb, var(--fg-dim) 10%, transparent);
		stroke: var(--fg-dim);
		stroke-width: 3;
	}
	.ring-wrap :global(.rw-inner-dim) {
		fill: none;
		stroke: var(--fg-dim);
		stroke-width: 2;
		opacity: 0.7;
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.eyebrow {
		display: flex;
		align-items: center;
		gap: 0.55em;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--accent);
	}
	.eyebrow svg {
		width: 15px;
		height: 15px;
	}

	.stat-number {
		font-family: var(--font-pixel);
		font-size: clamp(3rem, 10vw, 6.4rem);
		line-height: 1;
		color: var(--fg);
		font-variant-numeric: tabular-nums;
		display: flex;
		align-items: baseline;
		gap: 0.18em;
	}
	.stat-number .unit {
		font-family: var(--font-mono);
		font-size: 0.32em;
		color: var(--accent);
		font-weight: 700;
	}

	.desc {
		max-width: 40ch;
		font-size: 1.05rem;
		line-height: 1.55;
		color: var(--fg-dim);
	}

	.icon-row {
		display: flex;
		gap: 0.9rem;
		margin-top: 0.4rem;
		color: var(--fg-dim);
		opacity: 0.8;
	}
	.icon-row svg {
		width: 17px;
		height: 17px;
	}

	.slide[data-layout='cover'] .content {
		grid-template-columns: 1fr;
		text-align: center;
		justify-items: center;
	}
	.cover-mark {
		color: var(--green);
		margin-bottom: 0.6rem;
	}
	.cover-mark svg {
		width: 104px;
		height: 104px;
		overflow: visible;
	}
	.cover-title {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: clamp(2.2rem, 6.5vw, 4.2rem);
		line-height: 1.05;
		text-wrap: balance;
		max-width: 16ch;
	}
	.cover-sub {
		color: var(--fg-dim);
		margin-top: 0.9rem;
		font-size: 1.05rem;
	}
	.cover-cta {
		margin-top: 2.6rem;
		border: 1.6px solid var(--green);
		background: transparent;
		color: var(--green);
		font-family: var(--font-mono);
		font-weight: 700;
		letter-spacing: 0.06em;
		padding: 0.85rem 1.6rem;
		border-radius: 8px;
		display: flex;
		align-items: center;
		gap: 0.6em;
		transition:
			background 0.25s,
			color 0.25s;
	}
	.cover-cta:hover {
		background: var(--green);
		color: var(--ink);
	}

	.slide[data-layout='headline'] {
		background-image: repeating-linear-gradient(115deg, color-mix(in srgb, var(--accent) 22%, transparent) 0px, transparent 1px 90px);
		background-position: center;
	}
	.slide[data-layout='headline'] .content {
		grid-template-columns: 1.15fr 0.85fr;
	}
	.headline-title {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: clamp(1.7rem, 4.2vw, 2.9rem);
		line-height: 1.08;
		text-wrap: balance;
		max-width: 14ch;
	}
	.headline-sub {
		font-size: 0.85rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--fg-dim);
		margin: 0.6rem 0 2rem;
	}
	.headline-stats {
		display: flex;
		gap: 3rem;
		flex-wrap: wrap;
	}
	.headline-stat .stat-number {
		font-size: clamp(2.2rem, 5.2vw, 3.6rem);
	}
	.headline-stat .stat-label {
		display: block;
		margin-top: 0.35rem;
		font-size: 0.72rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg-dim);
	}
	.swatch-grid {
		display: grid;
		grid-template-columns: repeat(10, 1fr);
		gap: 6px;
		max-width: 220px;
		margin-top: 1.6rem;
	}
	.swatch-grid :global(i) {
		width: 100%;
		aspect-ratio: 1;
		border-radius: 3px;
		background: color-mix(in srgb, var(--accent) 20%, transparent);
	}
	.swatch-grid :global(i.on) {
		background: var(--accent);
	}

	.slide[data-layout='summary'] .content {
		grid-template-columns: 0.85fr 1.15fr;
		align-items: center;
	}
	.pass {
		position: relative;
		width: min(320px, 78vw);
		margin: 0 auto;
		background: linear-gradient(160deg, var(--ink-2), var(--ink));
		border: 1.6px solid var(--green);
		border-radius: 18px;
		padding: 1.7rem 1.5rem 1.5rem;
		-webkit-mask-image:
			radial-gradient(circle 7px at 0 62%, transparent 98%, #000 100%), radial-gradient(circle 7px at 100% 62%, transparent 98%, #000 100%);
		-webkit-mask-composite: source-in, source-in;
		mask-image:
			radial-gradient(circle 7px at 0 62%, transparent 98%, #000 100%), radial-gradient(circle 7px at 100% 62%, transparent 98%, #000 100%);
		mask-composite: intersect;
		overflow: hidden;
	}
	.pass-gear {
		position: absolute;
		right: -40px;
		top: -40px;
		width: 160px;
		height: 160px;
		color: var(--green);
		opacity: 0.14;
	}
	.pass-top {
		display: flex;
		align-items: center;
		gap: 0.5em;
		font-size: 0.68rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--green);
	}
	.pass-top svg {
		width: 14px;
		height: 14px;
	}
	.pass-hero {
		margin: 0.9rem 0 0.3rem;
		font-family: var(--font-pixel);
		font-size: 2.1rem;
		color: var(--fg);
	}
	.pass-hero-label {
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--fg-dim);
		margin-bottom: 1rem;
	}
	.pass-divider {
		border-top: 1px dashed color-mix(in srgb, var(--fg-dim) 45%, transparent);
		margin: 0.9rem 0;
	}
	.pass-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.4rem 0;
		font-size: 0.86rem;
	}
	.pass-row .who {
		display: flex;
		align-items: center;
		gap: 0.55em;
		color: var(--fg-dim);
	}
	.pass-row .who svg {
		width: 14px;
		height: 14px;
	}
	.pass-row .amt {
		font-weight: 700;
		color: var(--fg);
		font-variant-numeric: tabular-nums;
	}
	.pass-foot {
		margin-top: 1.1rem;
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg-dim);
		opacity: 0.6;
		text-align: center;
	}

	.summary-eyebrow {
		color: var(--green);
		font-size: 0.78rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		display: flex;
		align-items: center;
		gap: 0.5em;
		margin-bottom: 0.4rem;
	}
	.summary-title {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: clamp(1.8rem, 4.4vw, 3rem);
	}
	.summary-desc {
		color: var(--fg-dim);
		max-width: 38ch;
		margin-top: 0.7rem;
		line-height: 1.5;
	}
	.summary-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 1.8rem;
		flex-wrap: wrap;
	}
	.btn {
		border: none;
		font-family: var(--font-mono);
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: 0.85rem 1.4rem;
		border-radius: 8px;
		display: inline-flex;
		align-items: center;
		gap: 0.6em;
		transition: filter 0.2s;
	}
	.btn svg {
		width: 15px;
		height: 15px;
	}
	.btn-primary {
		background: var(--green);
		color: var(--ink);
	}
	.btn-primary:hover {
		filter: brightness(1.12);
	}
	.btn-ghost {
		background: transparent;
		border: 1.6px solid var(--fg-dim);
		color: var(--fg);
	}
	.btn-ghost:hover {
		border-color: var(--green);
		color: var(--green);
	}
	.share-toast {
		display: block;
		margin-top: 0.8rem;
		font-size: 0.78rem;
		color: var(--green);
		opacity: 0;
		transition: opacity 0.25s;
	}
	.share-toast.show {
		opacity: 1;
	}

	.nav-arrow {
		position: absolute;
		bottom: 1.3rem;
		z-index: 20;
		width: 42px;
		height: 42px;
		border-radius: 50%;
		border: 1.6px solid var(--fg-dim);
		background: rgba(255, 255, 255, 0.02);
		color: var(--fg);
		display: grid;
		place-items: center;
		opacity: 0.85;
		transition:
			opacity 0.2s,
			border-color 0.3s,
			color 0.3s;
	}
	.nav-arrow:hover {
		opacity: 1;
		border-color: var(--accent, var(--fg));
		color: var(--accent, var(--fg));
	}
	.nav-arrow:disabled {
		opacity: 0.25;
		pointer-events: none;
	}
	.nav-arrow.prev {
		left: 1.3rem;
	}
	.nav-arrow.next {
		right: 1.3rem;
	}
	.nav-arrow svg {
		width: 16px;
		height: 16px;
	}

	.tap-zone {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 22%;
		z-index: 10;
		background: transparent;
		border: none;
		padding: 0;
	}
	.tap-left {
		left: 0;
	}
	.tap-right {
		right: 0;
	}

	@media (max-width: 760px) {
		.content {
			grid-template-columns: 1fr !important;
			text-align: center;
			justify-items: center;
			gap: 1.6rem;
		}
		.slide[data-flip='1'] .content {
			direction: ltr;
		}
		.ring-wrap {
			order: -1;
		}
		.ring-wrap svg {
			width: 44vw;
			height: 44vw;
		}
		.desc {
			max-width: 34ch;
		}
		.headline-stats {
			justify-content: center;
		}
		.brand span {
			display: none;
		}
		.chapters {
			gap: 0.15rem;
		}
		.chapters :global(.chapter) {
			width: 24px;
			height: 24px;
		}
		.chapters :global(.chapter-icon) {
			width: 12px;
			height: 12px;
		}
	}
</style>
