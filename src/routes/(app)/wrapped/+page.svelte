<script lang="ts">
	import { onMount } from 'svelte';
	import { gsap } from 'gsap';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import { beep } from '$lib/sound';

	let { data } = $props();
	const w = data.wrapped;

	let appEl: HTMLDivElement | undefined = $state();

	onMount(() => {
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		// ============================================================
		// Illustrations : de vrais volumes, un par catégorie de stat (seule la marque — couverture et
		// filigrane du récap — est un engrenage). Chaque solide est décrit par ses sommets en 3D et
		// ses facettes ; on les projette et on les trie par profondeur à chaque frame (algorithme du
		// peintre). Pas de moteur 3D en dépendance : il ne s'agit que de projeter des points et de
		// trier des faces, three.js pèserait ~600 ko pour remplacer une trentaine de lignes. Et le
		// rendu reste des <path> SVG, donc le tracé progressif au stylo (cf. revealRing) continue de
		// marcher exactement pareil.
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

		type V3 = [number, number, number];
		type Face = { v: number[]; cls: string };
		type Model = { verts: V3[]; faces: Face[] };

		const CAM = 3.4; // distance caméra, en unités modèle
		const UNIT = 74; // 1 unité modèle = 74 px dans le viewBox 200×200

		function rot3(v: V3, ry: number, rx: number): V3 {
			const cy = Math.cos(ry),
				sy = Math.sin(ry);
			const x = v[0] * cy + v[2] * sy;
			const z = v[2] * cy - v[0] * sy;
			const cx = Math.cos(rx),
				sx = Math.sin(rx);
			return [x, v[1] * cx - z * sx, v[1] * sx + z * cx];
		}
		// Projection perspective : ce qui est loin rétrécit. Sans ce rapport, un solide qui tourne
		// ressemble à une silhouette qui se déforme, pas à un volume.
		function project(v: V3) {
			const k = CAM / (CAM - v[2]);
			return [100 + v[0] * UNIT * k, 100 + v[1] * UNIT * k];
		}

		const tilt = (m: Model, ry: number, rx: number): Model => ({ verts: m.verts.map((v) => rot3(v, ry, rx)), faces: m.faces });

		function merge(...parts: Model[]): Model {
			const out: Model = { verts: [], faces: [] };
			for (const part of parts) {
				const off = out.verts.length;
				out.verts.push(...part.verts);
				out.faces.push(...part.faces.map((f) => ({ v: f.v.map((i) => i + off), cls: f.cls })));
			}
			return out;
		}

		// Un contour fermé + une épaisseur = un volume : deux capots et une facette par arête.
		// Quatre des sept solides sortent de là, sans une seule coordonnée écrite à la main.
		function extrude(pts: number[][], depth: number, cap = 'rw-outer', side = 'rw-side'): Model {
			const n = pts.length;
			const verts: V3[] = [
				...pts.map(([x, y]) => [x, y, depth] as V3),
				...pts.map(([x, y]) => [x, y, -depth] as V3)
			];
			const faces: Face[] = [
				{ v: pts.map((_, i) => i), cls: cap },
				{ v: pts.map((_, i) => 2 * n - 1 - i), cls: cap }
			];
			for (let i = 0; i < n; i++) {
				const j = (i + 1) % n;
				faces.push({ v: [i, j, n + j, n + i], cls: side });
			}
			return { verts, faces };
		}

		const circle2 = (r: number, n: number) =>
			Array.from({ length: n }, (_, i) => {
				const a = (i / n) * Math.PI * 2 - Math.PI / 2;
				return [Math.cos(a) * r, Math.sin(a) * r];
			});

		// Les silhouettes ci-dessus sont posées en coordonnées d'écran (centrées sur 100,100) parce
		// que l'export PNG les réutilise telles quelles : on les ramène ici en unités modèle plutôt
		// que d'en maintenir deux versions.
		const toModel = (pts: number[][]) => pts.map(([x, y]) => [(x - 100) / UNIT, (y - 100) / UNIT]);

		// Révolution d'un profil (rayon, hauteur) autour de l'axe vertical : une silhouette suffit à
		// décrire un volume rond. Un rayon nul ferme le solide en pointe.
		// `curl` décale les anneaux d'autant plus qu'ils sont hauts : une goutte parfaitement
		// symétrique se lit comme une larme, c'est la pointe qui penche qui fait la flamme.
		function lathe(profile: number[][], segs: number, curl = 0): Model {
			const verts: V3[] = [];
			const rings: number[][] = [];
			for (const [r, y] of profile) {
				const idx: number[] = [];
				const dx = curl * Math.max(0, -y) ** 2;
				if (r < 1e-4) {
					idx.push(verts.length);
					verts.push([dx, y, 0]);
				} else
					for (let i = 0; i < segs; i++) {
						const a = (i / segs) * Math.PI * 2;
						idx.push(verts.length);
						verts.push([Math.cos(a) * r + dx, y, Math.sin(a) * r]);
					}
				rings.push(idx);
			}
			const faces: Face[] = [];
			for (let k = 0; k < rings.length - 1; k++) {
				const A = rings[k],
					B = rings[k + 1];
				for (let i = 0; i < segs; i++) {
					const j = (i + 1) % segs;
					const cls = (k + i) % 2 ? 'rw-outer' : 'rw-side';
					if (A.length === 1) faces.push({ v: [A[0], B[i], B[j]], cls });
					else if (B.length === 1) faces.push({ v: [A[i], A[j], B[0]], cls });
					else faces.push({ v: [A[i], A[j], B[j], B[i]], cls });
				}
			}
			return { verts, faces };
		}

		// Anneau plein (tore à section carrée). Deux exemplaires dans des plans perpendiculaires et
		// décalés d'un rayon s'enchaînent vraiment l'un dans l'autre — le tri par face suffit à
		// rendre l'entrelacement, il n'y a rien à trancher à la main.
		function torus(R: number, r: number, segs: number, sides: number, rotY: number, dx: number, cls: string, clsAlt: string): Model {
			const verts: V3[] = [];
			const faces: Face[] = [];
			const cy = Math.cos(rotY),
				sy = Math.sin(rotY);
			for (let i = 0; i < segs; i++) {
				const a = (i / segs) * Math.PI * 2;
				for (let j = 0; j < sides; j++) {
					const b = (j / sides) * Math.PI * 2;
					const rr = R + Math.cos(b) * r;
					const x = Math.cos(a) * rr,
						z = Math.sin(b) * r;
					verts.push([x * cy + z * sy + dx, Math.sin(a) * rr, z * cy - x * sy]);
				}
			}
			for (let i = 0; i < segs; i++) {
				const i2 = (i + 1) % segs;
				for (let j = 0; j < sides; j++) {
					const j2 = (j + 1) % sides;
					faces.push({ v: [i * sides + j, i2 * sides + j, i2 * sides + j2, i * sides + j2], cls: (i + j) % 2 ? cls : clsAlt });
				}
			}
			return { verts, faces };
		}

		// Ressort : un ruban qui s'enroule. « On a tenu le rythme » se lit mieux en volume qu'une
		// spirale plate — et c'est la forme qui gagne le plus à tourner.
		function coilSolid(): Model {
			const steps = 46;
			const verts: V3[] = [];
			const faces: Face[] = [];
			for (let i = 0; i <= steps; i++) {
				const t = i / steps;
				const a = t * Math.PI * 2 * 2.6;
				const r = 0.78 - t * 0.16;
				const y = -0.8 + t * 1.6;
				verts.push([Math.cos(a) * r, y - 0.11, Math.sin(a) * r]);
				verts.push([Math.cos(a) * r, y + 0.11, Math.sin(a) * r]);
			}
			for (let i = 0; i < steps; i++)
				faces.push({ v: [2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2], cls: i % 2 ? 'rw-outer' : 'rw-side' });
			return { verts, faces };
		}

		// Anneau plat posé dans un plan incliné : deux exemplaires penchés en sens inverse se
		// croisent en tournant, comme deux trajectoires qui se rejoignent.
		function ringSolid(rOut: number, rIn: number, segs: number, tilt: number, dx: number, cls: string): Model {
			const verts: V3[] = [];
			const faces: Face[] = [];
			const ct = Math.cos(tilt),
				st = Math.sin(tilt);
			for (let i = 0; i < segs; i++) {
				const a = (i / segs) * Math.PI * 2;
				for (const r of [rOut, rIn]) {
					const x = Math.cos(a) * r;
					verts.push([x * ct + dx, Math.sin(a) * r, -x * st]);
				}
			}
			for (let i = 0; i < segs; i++) {
				const j = (i + 1) % segs;
				faces.push({ v: [2 * i, 2 * j, 2 * j + 1, 2 * i + 1], cls });
			}
			return { verts, faces };
		}

		// Yeux et sourire posés juste devant le capot de la pièce : le tri par profondeur les fait
		// disparaître tout seuls quand elle se retourne, sans test de visibilité à écrire.
		function smileySolid(z: number): Model {
			const verts: V3[] = [];
			const faces: Face[] = [];
			const add = (pts: number[][]) => {
				const off = verts.length;
				pts.forEach(([x, y]) => verts.push([x, y, z]));
				faces.push({ v: pts.map((_, i) => off + i), cls: 'rw-mark-fill' });
			};
			for (const ex of [-0.28, 0.28]) add(circle2(0.09, 8).map(([x, y]) => [x + ex, y - 0.2]));
			const outer: number[][] = [];
			const inner: number[][] = [];
			for (let i = 0; i <= 10; i++) {
				const a = Math.PI * (0.2 + (i / 10) * 0.6);
				outer.push([Math.cos(a) * 0.5, Math.sin(a) * 0.5 + 0.02]);
				inner.push([Math.cos(a) * 0.39, Math.sin(a) * 0.39 + 0.02]);
			}
			add(outer.concat(inner.reverse()));
			return { verts, faces };
		}

		const solidBuilders: Record<string, () => Model> = {
			gear: () =>
				merge(extrude(toModel(gearPoints(9, 86, 63, 100, 100)), 0.19), extrude(circle2(0.15, 12), 0.38, 'rw-hub', 'rw-hub')),
			ticket: () => extrude(toModel(ticketPoints(100, 100, 150, 98, 7)), 0.16),
			shield: () => extrude(toModel(shieldPoints(100, 100, 146, 156, 1)), 0.17),
			coin: () => merge(extrude(circle2(0.92, 26), 0.15), smileySolid(0.17)),
			// Flamme : col étroit en haut, ventre bas, pointe qui part sur le côté.
			flame: () =>
				lathe(
					[
						[0, -1.2],
						[0.19, -0.82],
						[0.38, -0.4],
						[0.62, 0.06],
						[0.72, 0.46],
						[0.44, 0.86],
						[0, 1.04]
					],
					9,
					0.24
				),
			spiral: coilSolid,
			// Une étoile pour le récap : c'est le seul écran qui conclut, autant qu'il le montre.
			star: () => extrude(toModel(gearPoints(5, 82, 36, 100, 100)), 0.2),
			// Deux maillons enchaînés : le second est centré pile sur le bord du premier, donc il le
			// traverse. Vus de face, l'anneau perpendiculaire se réduit à un trait et l'enchaînement
			// ne se voit pas — d'où l'inclinaison posée dans le modèle, qui les montre tous les deux
			// de trois quarts.
			duo: () =>
				tilt(
					merge(
						torus(0.6, 0.15, 12, 4, 0, -0.3, 'rw-outer', 'rw-side'),
						torus(0.6, 0.15, 12, 4, Math.PI / 2, 0.3, 'rw-outer-dim', 'rw-side-dim')
					),
					0,
					0.5
				)
		};

		type Solid = { model: Model; paths: SVGPathElement[]; rot: { ry: number; rx: number }; spin?: gsap.core.Tween };
		const solids = new Map<SVGElement, Solid>();

		// Algorithme du peintre : on dessine du plus loin au plus près. Les <path> ne bougent jamais
		// dans le DOM — on réécrit juste leur `d` et leur classe dans l'ordre trié, ce qui évite de
		// réordonner des nœuds à chaque frame.
		function drawSolid(s: Solid) {
			const rv = s.model.verts.map((v) => rot3(v, s.rot.ry, s.rot.rx));
			const order = s.model.faces
				.map((f, i) => [i, f.v.reduce((acc, k) => acc + rv[k][2], 0) / f.v.length] as [number, number])
				.sort((a, b) => a[1] - b[1]);
			order.forEach(([fi], i) => {
				const f = s.model.faces[fi];
				const p = s.paths[i];
				p.setAttribute('d', pathFromPoints(f.v.map((k) => project(rv[k])), true));
				if (p.dataset.cls !== f.cls) {
					p.setAttribute('class', f.cls);
					p.dataset.cls = f.cls;
				}
			});
		}

		document.querySelectorAll<SVGElement>('svg[data-shape]').forEach((svg) => {
			const build = solidBuilders[svg.dataset.shape!];
			if (!build) return;
			const model = build();
			const paths = model.faces.map(() => svg.appendChild(svgEl('path', {})) as SVGPathElement);
			// Un solide qui tourne peut partir de trois quarts ; un solide fixe, non : le filigrane de
			// la carte récap est rogné par son bord, et de biais il ne ressemblait plus à rien.
			const spun = !!svg.closest('[data-motion]');
			const solid: Solid = { model, paths, rot: spun ? { ry: -0.62, rx: -0.14 } : { ry: -0.2, rx: -0.1 } };
			solids.set(svg, solid);
			drawSolid(solid);
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

		// Ambiance de fond — deux couches complémentaires, toutes deux propres à chaque écran :
		//   • data-backdrop : le décor, purement CSS (rayons, perforations, grille en perspective,
		//     ondes concentriques, balayage radar…). Injecté ici plutôt qu'écrit dans le markup de
		//     chaque section : ça reste un détail décoratif, pas du contenu.
		//   • data-particles : les éléments animés. La forme change autant que la trajectoire
		//     (points, traits, anneaux, croix, confettis) — un seul type de particule pour huit
		//     écrans, ça se voit tout de suite, quelle que soit la variété des mouvements.
		//
		// Les animations de chaque écran sont mémorisées ici pour pouvoir être mises en pause dès
		// qu'il sort du champ (cf. setIdle plus bas) : sans ça, les huit décors et leurs ~250
		// particules tournent tous à chaque frame en permanence, qu'on les regarde ou non.
		const slideAnims = new Map<HTMLElement, gsap.core.Animation[]>();
		if (!reduceMotion) {
			const rnd = gsap.utils.random;

			document.querySelectorAll<HTMLElement>('.slide[data-backdrop]').forEach((slide) => {
				const bd = document.createElement('div');
				bd.className = 'backdrop bd-' + slide.dataset.backdrop;
				slide.querySelector('.glow')?.insertAdjacentElement('afterend', bd);
			});

			function spawn(slide: HTMLElement, count: number, variant = '') {
				const pts: HTMLElement[] = [];
				for (let i = 0; i < count; i++) {
					const p = document.createElement('span');
					p.className = variant ? 'spark ' + variant : 'spark';
					const size = rnd(2, 5);
					p.style.width = size + 'px';
					p.style.height = size + 'px';
					slide.appendChild(p);
					pts.push(p);
				}
				return pts;
			}
			const at = (p: HTMLElement, left: number, top: number) => {
				p.style.left = left + '%';
				p.style.top = top + '%';
			};
			const size = (p: HTMLElement, w: number, h: number) => {
				p.style.width = w + 'px';
				p.style.height = h + 'px';
			};

			const particleStyles: Record<string, (slide: HTMLElement) => void> = {
				// Couverture : poussière qui monte doucement, traversée de fins traits de lumière —
				// le rideau se lève, rien ne presse encore.
				drift: (slide) => {
					spawn(slide, 26).forEach((p) => {
						at(p, rnd(4, 96), rnd(6, 96));
						gsap.to(p, {
							y: '-=' + rnd(30, 70),
							x: '+=' + rnd(-15, 15),
							opacity: () => rnd(0.2, 0.75),
							scale: () => rnd(0.6, 1.5),
							duration: () => rnd(4, 8),
							repeat: -1,
							yoyo: true,
							ease: 'sine.inOut',
							delay: rnd(0, 4)
						});
					});
					spawn(slide, 12, 'streak').forEach((p) => {
						size(p, 1.5, rnd(40, 120));
						at(p, rnd(2, 98), rnd(55, 105));
						const rise = rnd(5, 9);
						gsap
							.timeline({ repeat: -1, delay: rnd(0, 8) })
							.fromTo(p, { opacity: 0 }, { opacity: rnd(0.25, 0.6), duration: 0.9 }, 0)
							.to(p, { y: '-=' + rnd(300, 560), duration: rise, ease: 'none' }, 0)
							.to(p, { opacity: 0, duration: 1.4 }, rise - 1.4);
					});
				},
				// Ticket déchiré : confettis carrés et bouts de coupon qui tombent en se retournant
				// (la bascule sur scaleX suffit à faire croire à une vraie rotation dans l'espace).
				confetti: (slide) => {
					const fall = (p: HTMLElement, spin: number) => {
						at(p, rnd(0, 100), rnd(-20, 12));
						gsap.set(p, { rotation: rnd(0, 360) });
						gsap.to(p, {
							y: '+=' + rnd(340, 620),
							x: '+=' + rnd(-60, 60),
							rotation: '+=' + spin,
							opacity: () => rnd(0.35, 1),
							duration: () => rnd(4, 8),
							repeat: -1,
							ease: 'none',
							delay: rnd(0, 6)
						});
						gsap.to(p, { scaleX: 0.35, duration: rnd(0.6, 1.5), repeat: -1, yoyo: true, ease: 'sine.inOut', delay: rnd(0, 2) });
					};
					spawn(slide, 28, 'square').forEach((p) => {
						size(p, rnd(5, 9), rnd(5, 9));
						fall(p, rnd(180, 540));
					});
					spawn(slide, 18, 'square').forEach((p) => {
						size(p, rnd(4, 6), rnd(12, 22));
						fall(p, rnd(-540, -180));
					});
				},
				// Braises : des points qui montent vite, doublés de traînées plus longues et plus
				// lumineuses — un feu ne crache pas que des points de la même taille.
				ember: (slide) => {
					spawn(slide, 34).forEach((p) => {
						at(p, rnd(0, 100), rnd(45, 100));
						gsap.to(p, {
							y: '-=' + rnd(90, 180),
							x: '+=' + rnd(-25, 25),
							opacity: () => rnd(0.3, 0.95),
							scale: () => rnd(0.5, 1.3),
							duration: () => rnd(1.8, 3.6),
							repeat: -1,
							ease: 'power1.out',
							delay: rnd(0, 3.5)
						});
					});
					spawn(slide, 14, 'streak').forEach((p) => {
						size(p, 2, rnd(14, 38));
						at(p, rnd(0, 100), rnd(80, 105));
						const rise = rnd(2.2, 4);
						gsap
							.timeline({ repeat: -1, delay: rnd(0, 4) })
							.fromTo(p, { opacity: 0 }, { opacity: rnd(0.4, 0.9), duration: 0.35 }, 0)
							.to(p, { y: '-=' + rnd(220, 420), x: '+=' + rnd(-50, 50), duration: rise, ease: 'power1.out' }, 0)
							.to(p, { opacity: 0, duration: 0.9 }, rise - 0.9);
					});
				},
				// Humeur : des anneaux creux qui remontent en tanguant. Le contour plutôt que le
				// plein donne tout de suite un registre plus doux que les autres écrans.
				bubble: (slide) => {
					spawn(slide, 24, 'ring').forEach((p) => {
						const d = rnd(6, 24);
						size(p, d, d);
						at(p, rnd(4, 96), rnd(30, 115));
						gsap.to(p, { y: '-=' + rnd(240, 480), duration: rnd(8, 14), repeat: -1, ease: 'none', delay: rnd(0, 9) });
						gsap.to(p, { x: '+=' + rnd(-28, 28), duration: rnd(2, 4), repeat: -1, yoyo: true, ease: 'sine.inOut' });
						gsap.to(p, { opacity: () => rnd(0.15, 0.6), duration: rnd(2, 4), repeat: -1, yoyo: true, ease: 'sine.inOut', delay: rnd(0, 3) });
					});
				},
				// Support : des croix de visée qui clignotent et pivotent, sous le balayage radar du
				// décor — on surveille, on ne flotte pas.
				twinkle: (slide) => {
					spawn(slide, 26, 'cross').forEach((p) => {
						const d = rnd(7, 17);
						size(p, d, d);
						at(p, rnd(4, 96), rnd(6, 96));
						gsap.set(p, { rotation: rnd(-20, 20) });
						gsap.to(p, {
							opacity: () => rnd(0.1, 0.9),
							scale: () => rnd(0.5, 1.4),
							rotation: '+=90',
							duration: () => rnd(1.4, 3),
							repeat: -1,
							yoyo: true,
							ease: 'sine.inOut',
							delay: rnd(0, 3)
						});
					});
				},
				// Volume : tout tourne autour du centre, en écho à la spirale de l'écran.
				orbit: (slide) => {
					spawn(slide, 22).forEach((p) => {
						at(p, 50, 50);
						const radius = rnd(14, 44);
						const dir = Math.random() < 0.5 ? 1 : -1;
						const proxy = { a: rnd(0, 360) };
						const applyOrbit = () => {
							const rad = (proxy.a * Math.PI) / 180;
							p.style.transform = `translate(${Math.cos(rad) * radius}vmin, ${Math.sin(rad) * radius}vmin)`;
						};
						applyOrbit();
						gsap.to(proxy, { a: '+=' + dir * 360, duration: () => rnd(7, 16), repeat: -1, ease: 'none', onUpdate: applyOrbit });
						gsap.to(p, { opacity: () => rnd(0.3, 0.9), duration: () => rnd(1.5, 3), repeat: -1, yoyo: true, ease: 'sine.inOut', delay: rnd(0, 3) });
					});
				},
				// Duo : deux courants qui se croisent en sens inverse, l'un à l'accent, l'autre
				// éteint — les mêmes deux couleurs que les cercles de l'illustration.
				sway: (slide) => {
					spawn(slide, 30).forEach((p, i) => {
						const rightward = i % 2 === 0;
						if (!rightward) p.classList.add('dim');
						at(p, rightward ? rnd(-12, 42) : rnd(58, 112), rnd(10, 94));
						gsap.to(p, { x: (rightward ? 1 : -1) * rnd(440, 780), duration: rnd(9, 17), repeat: -1, ease: 'none', delay: rnd(0, 9) });
						gsap.to(p, { y: '+=' + rnd(18, 48), duration: rnd(2.2, 4.2), repeat: -1, yoyo: true, ease: 'sine.inOut' });
						gsap.to(p, { opacity: () => rnd(0.2, 0.8), duration: rnd(1.6, 3), repeat: -1, yoyo: true, ease: 'sine.inOut', delay: rnd(0, 3) });
					});
				},
				// Récap : vraie gerbe de feu d'artifice — montée en power2.out, retombée en
				// power2.in. Une seule tween linéaire ne donnerait qu'une pluie, pas une gerbe.
				fountain: (slide) => {
					const shoot = (p: HTMLElement) => {
						at(p, rnd(15, 85), 100);
						gsap.set(p, { rotation: rnd(0, 360) });
						const up = rnd(1.6, 2.4);
						const down = rnd(1.8, 2.6);
						gsap
							.timeline({ repeat: -1, delay: rnd(0, 5) })
							.fromTo(p, { opacity: 0 }, { opacity: rnd(0.5, 1), duration: 0.3 }, 0)
							.to(p, { x: '+=' + rnd(-160, 160), rotation: '+=' + rnd(180, 720), duration: up + down, ease: 'none' }, 0)
							.to(p, { y: '-=' + rnd(300, 520), duration: up, ease: 'power2.out' }, 0)
							.to(p, { y: '+=' + rnd(260, 460), duration: down, ease: 'power2.in' }, up)
							.to(p, { opacity: 0, duration: 0.9 }, up + down - 0.9);
					};
					spawn(slide, 24).forEach(shoot);
					spawn(slide, 14, 'square').forEach((p) => {
						size(p, rnd(3, 5), rnd(3, 10));
						shoot(p);
					});
				}
			};

			// On relève ce que la construction a ajouté à la timeline globale, plutôt que de faire
			// remonter la liste par chaque style : ça capture aussi les tweens qui n'animent pas
			// l'élément lui-même mais un proxy (orbit, sway), introuvables via getTweensOf(élément).
			const running = () => new Set(gsap.globalTimeline.getChildren(false, true, true));
			document.querySelectorAll<HTMLElement>('.slide').forEach((slide) => {
				const style = slide.dataset.particles ?? 'drift';
				const before = running();
				(particleStyles[style] ?? particleStyles.drift)(slide);
				slideAnims.set(slide, [...running()].filter((a) => !before.has(a)));
			});
		}

		// Écran « pas encore de wrapped » : un seul écran, donc rien à câbler en dessous (navigation,
		// chapitres, musique, export — tout ça n'existe pas dans ce cas). Il traverse en revanche tout
		// le décor ci-dessus, et prepareRing/revealRing lui vont tels quels : c'est ce qui le fait
		// appartenir au même monde que le récap, au lieu d'être une page d'attente posée à côté.
		if (!w) {
			const screen = document.querySelector<HTMLElement>('.slide');
			if (screen && !reduceMotion) {
				prepareRing(screen);
				gsap.from('.empty-content > :not(.cover-mark)', {
					y: 26,
					opacity: 0,
					duration: 0.7,
					ease: 'power3.out',
					stagger: 0.09,
					delay: 0.35
				});
				gsap.from('.chrome', { y: -18, opacity: 0, duration: 0.7, ease: 'power2.out' });
				revealRing(screen);
			}
			return;
		}

		// ============================================================
		// Navigation
		// ============================================================
		const reel = document.getElementById('reel')!;
		const slides = Array.from(document.querySelectorAll<HTMLElement>('.slide'));
		const chaptersWrap = document.getElementById('chapters')!;
		const prevBtn = document.getElementById('prevBtn') as HTMLButtonElement;
		const nextBtn = document.getElementById('nextBtn') as HTMLButtonElement;
		// Toujours reparti de la couverture à l'ouverture — jamais de reprise sur le dernier écran vu.
		let index = 0;

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

		// Cache le tracé instantanément, dès le départ de la navigation (pendant que l'écran glisse
		// encore hors champ) — sans ça, le dessin masqué/redessiné (revealRing ci-dessous, retardé
		// jusqu'à l'arrivée) se voit d'abord complet le temps du glissement, puis "saute" à vide
		// avant de se redessiner : un reset visible plutôt qu'une révélation propre.
		function prepareRing(slide: HTMLElement) {
			const paths = slide.querySelectorAll<SVGPathElement>('svg[data-shape] path');
			paths.forEach((p) => {
				const len = p.getTotalLength ? p.getTotalLength() : 0;
				if (!len) return;
				if (reduceMotion) {
					p.style.strokeDasharray = 'none';
					return;
				}
				p.style.strokeDasharray = String(len);
				p.style.strokeDashoffset = String(len);
				// Remplissage coupé au départ : sinon le volume est déjà là, plein, avant que le
				// moindre trait ne soit tracé — on ne verrait qu'un contour se poser sur une forme
				// déjà visible. Le fil de fer se dessine, la matière arrive ensuite.
				p.style.fillOpacity = '0';
			});
		}

		function revealRing(slide: HTMLElement) {
			if (!reduceMotion) {
				// Léger décalage d'une facette à l'autre : le volume se construit sous les yeux au lieu
				// d'apparaître d'un bloc — c'est ce qui rend le tracé lisible sur un solide à 30 faces.
				slide.querySelectorAll<SVGPathElement>('svg[data-shape] path').forEach((p, i) => {
					const len = p.getTotalLength ? p.getTotalLength() : 0;
					if (!len) return;
					gsap.fromTo(
						p,
						{ strokeDashoffset: len },
						{ strokeDashoffset: 0, duration: 1.1, ease: 'power2.out', delay: i * 0.012 }
					);
					gsap.to(p, { fillOpacity: 1, duration: 0.7, ease: 'power1.out', delay: 0.75 + i * 0.012 });
				});
			}
			const ring = slide.querySelector<SVGElement>('[data-motion] svg[data-shape]');
			const solid = ring ? solids.get(ring) : undefined;
			if (!ring || !solid || reduceMotion) return;
			gsap.killTweensOf(ring);
			solid.spin?.kill();
			const mode = ring.closest<HTMLElement>('[data-motion]')?.getAttribute('data-motion') ?? 'spin';
			// Le tracé doit être fini avant que les faces bougent : tant que le pointillé est posé,
			// un `d` qui change à chaque frame décalerait le trait en cours de dessin.
			const onStart = () => solid.paths.forEach((p) => (p.style.strokeDasharray = 'none'));
			const onUpdate = () => drawSolid(solid);
			solid.spin =
				mode === 'spin'
					? gsap.to(solid.rot, { ry: solid.rot.ry + Math.PI * 2, duration: 26, ease: 'none', repeat: -1, delay: 1.6, onStart, onUpdate })
					: // Un tour complet mettrait les silhouettes plates (ticket, bouclier) de profil, donc
						// invisibles la moitié du temps : un balancement les garde lisibles tout en donnant
						// le relief.
						gsap.to(solid.rot, { ry: 0.62, rx: 0.08, duration: 7, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 1.6, onStart, onUpdate });
			if (mode !== 'spin') gsap.to(ring, { y: '+=12', duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 1.1 });
		}

		// Sélecteurs génériques (pas de classe "reveal-item" à poser partout dans le markup) : couvre
		// les blocs de texte/actions de chaque mise en page (stat / cover / headline / summary) d'un
		// coup. .stat-number matche aussi les deux chiffres de l'écran volume (headline-stats) sans
		// avoir besoin de cibler leur conteneur séparément (évite un double décalage imbriqué).
		const REVEAL_SELECTOR = [
			'.eyebrow',
			'.avatar-pair',
			'.stat-number',
			'.desc',
			'.icon-row',
			'.cover-title',
			'.cover-sub',
			'.cover-cta',
			'.headline-title',
			'.headline-sub',
			'.swatch-grid',
			'.summary-eyebrow',
			'.summary-title',
			'.summary-desc',
			'.summary-actions',
			'.pass'
		].join(', ');

		// Même logique que prepareRing/revealRing : caché tout de suite (pendant que l'écran est
		// encore hors champ), animé seulement une fois arrivé — sinon le texte s'affiche en entier
		// pendant le glissement et "l'animation" qu'on voit n'est qu'un sursaut sur un contenu déjà là.
		function prepareContent(slide: HTMLElement) {
			const items = slide.querySelectorAll<HTMLElement>(REVEAL_SELECTOR);
			if (items.length === 0 || reduceMotion) return;
			gsap.set(items, { y: 24, opacity: 0 });
		}

		function revealContent(slide: HTMLElement) {
			const items = slide.querySelectorAll<HTMLElement>(REVEAL_SELECTOR);
			if (items.length === 0) return;
			if (reduceMotion) {
				gsap.set(items, { clearProps: 'all' });
				return;
			}
			gsap.to(items, { y: 0, opacity: 1, duration: 0.65, ease: 'power3.out', stagger: 0.08, overwrite: true });
		}

		// Met un écran en veille : ses tweens de particules (GSAP) et les animations CSS de son décor
		// (grain, halo, balayage, backdrop) sont mis en pause. Un écran hors champ ne coûte alors
		// plus rien par frame — c'était ça le vrai poids, pas telle ou telle animation isolée.
		// getAnimations({subtree:true}) atteint les ::before/::after des décors, qu'une règle CSS ne
		// pourrait pas viser ici : la classe qui pilote l'état serait posée en JS, donc absente du
		// markup, donc la règle serait élaguée du build par Svelte. Les transitions sont laissées
		// tranquilles (les figer à mi-course laisserait un état visuel bloqué).
		// Les tweens infinis posés par revealRing visent le SVG directement : getTweensOf suffit.
		function setIdle(slide: HTMLElement, idle: boolean) {
			for (const a of slide.getAnimations({ subtree: true })) {
				if ('animationName' in a) idle ? a.pause() : a.play();
			}
			const ring = slide.querySelector('[data-motion] svg[data-shape]');
			for (const a of slideAnims.get(slide) ?? []) a.paused(idle);
			if (ring) for (const t of gsap.getTweensOf(ring)) t.paused(idle);
			// La rotation 3D anime un objet proxy, pas le SVG : getTweensOf ne la trouverait pas.
			// Sans ça, un solide hors champ continuerait à reprojeter ses ~30 faces à chaque frame.
			for (const svg of slide.querySelectorAll<SVGElement>('svg[data-shape]')) solids.get(svg)?.spin?.paused(idle);
		}

		function place() {
			const x = -index * window.innerWidth;
			gsap.set(reel, { x });
		}

		// Au tout premier appel (chargement de page), le reel est déjà à la bonne position (posée
		// par place()) — inutile d'attendre un tween qui ne bouge visuellement rien. Pour toute
		// navigation suivante en revanche, le contenu ne doit se révéler qu'une fois l'écran
		// vraiment arrivé à l'écran : le lancer en même temps que le glissement du reel (comme
		// avant) le fait apparaître pendant qu'il est encore hors champ, donc invisible.
		let firstGoTo = true;
		// Sons de navigation : un tick discret par changement d'écran, un petit "rewind" distinct pour
		// le bouton recommencer — coupés dès que bgm est en pause (le mute doit couper toute l'ambiance
		// sonore de la page, pas juste la musique).
		function goTo(i: number, sound: 'step' | 'restart' | 'none' = 'step') {
			const prevIndex = index;
			index = Math.max(0, Math.min(slides.length - 1, i));
			if (index !== prevIndex && !firstGoTo && !bgm.paused) {
				if (sound === 'restart') {
					beep(659.25, { duration: 0.1, type: 'triangle', volume: 0.55 });
					beep(392, { offset: 0.09, duration: 0.16, type: 'triangle', volume: 0.55 });
				} else if (sound === 'step') {
					beep(523.25, { duration: 0.06, type: 'triangle', volume: 0.4 });
				}
			}
			const x = -index * window.innerWidth;
			const active = slides[index];
			chapters.forEach((c, ci) => c.classList.toggle('active', ci === index));
			revealChapter(index, true);
			prevBtn.disabled = index === 0;
			nextBtn.disabled = index === slides.length - 1;
			prepareRing(active);
			prepareContent(active);
			// Réveillé avant le glissement (il traverse l'écran, il doit être vivant pendant le
			// trajet), les autres endormis seulement à l'arrivée — sinon on couperait l'écran qu'on
			// est encore en train de quitter, en plein champ.
			setIdle(active, false);

			function finishReveal() {
				slides.forEach((s) => s !== active && setIdle(s, true));
				active.querySelectorAll<HTMLElement>('.count').forEach(animateNumber);
				revealRing(active);
				revealContent(active);
			}

			if (reduceMotion) {
				reel.style.transform = `translateX(${x}px)`;
				finishReveal();
			} else if (firstGoTo) {
				finishReveal();
			} else {
				gsap.to(reel, { x, duration: 0.7, ease: 'power3.inOut', onComplete: finishReveal });
			}
			firstGoTo = false;
		}

		// Sortie du wrapped : le miroir exact de l'entrée (cf. .wrap-glitch dans app.css) — l'écran
		// s'éteint comme un tube cathodique, l'image se compresse sur une ligne de lumière qui se
		// referme sur elle-même, et c'est seulement là qu'on part. Un signal sonore descendant
		// accompagne la coupure, et la musique baisse en même temps plutôt que d'être coupée net par
		// le déchargement de la page.
		// La navigation reste un rechargement complet (l'appli reprend la main sur une page propre :
		// .app est en position:fixed par-dessus tout, et l'AudioContext meurt avec la page).
		let leaving = false;
		function closeWrapped() {
			if (leaving) return;
			leaving = true;
			if (!bgm.paused) {
				beep(392, { duration: 0.14, type: 'sine', volume: 0.55 });
				beep(261.63, { offset: 0.1, duration: 0.18, type: 'sine', volume: 0.55 });
				gsap.to(bgm, { volume: 0, duration: 0.6, ease: 'power2.in' });
			}
			const leave = () => (window.location.href = '/imputation');
			if (reduceMotion) {
				setTimeout(leave, 160);
				return;
			}
			const line = document.createElement('div');
			line.className = 'crt-line';
			appEl!.appendChild(line);
			gsap
				.timeline({ onComplete: leave })
				.to('.chrome', { y: -34, opacity: 0, duration: 0.28, ease: 'power2.in' }, 0)
				.to('.nav-arrow', { y: 34, opacity: 0, duration: 0.28, ease: 'power2.in' }, 0)
				.to('.spark', { opacity: 0, scale: 0, duration: 0.3, ease: 'power2.in', stagger: { amount: 0.22, from: 'random' } }, 0)
				.to('.stage', { scaleY: 0.004, scaleX: 1.06, duration: 0.34, ease: 'power3.in' }, 0.16)
				.set(line, { opacity: 1 }, 0.5)
				.set('.stage', { opacity: 0 }, 0.5)
				.to(line, { scaleX: 0, opacity: 0, duration: 0.32, ease: 'power2.in' }, 0.54);
		}
		document.getElementById('closeBtn')?.addEventListener('click', (e) => {
			e.preventDefault();
			closeWrapped();
		});

		window.addEventListener('resize', place);
		prevBtn.addEventListener('click', () => goTo(index - 1));
		nextBtn.addEventListener('click', () => goTo(index + 1));
		document.getElementById('tapLeft')?.addEventListener('click', () => goTo(index - 1));
		document.getElementById('tapRight')?.addEventListener('click', () => goTo(index + 1));
		document.getElementById('startBtn')?.addEventListener('click', () => {
			goTo(index + 1);
			startAudio();
		});
		document.getElementById('restartBtn')?.addEventListener('click', () => goTo(0, 'restart'));
		window.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowRight') goTo(index + 1);
			if (e.key === 'ArrowLeft') goTo(index - 1);
			if (e.key === 'Escape') closeWrapped();
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

		place();
		goTo(index);
		if (!reduceMotion) {
			// L'image "se stabilise" en arrivant : ça prolonge le rideau qui vient de s'ouvrir côté
			// layout (transition glitch) au lieu de laisser la couverture apparaître déjà posée.
			gsap.from('.stage', { opacity: 0, scaleY: 0.86, scaleX: 1.04, duration: 0.75, ease: 'power3.out' });
			gsap.from('.chrome', { y: -18, opacity: 0, duration: 0.7, ease: 'power2.out' });
			// Petit pouls continu sur "Commencer" pour attirer l'œil dès l'arrivée sur la couverture.
			const cta = document.getElementById('startBtn');
			if (cta) gsap.to(cta, { scale: 1.045, duration: 1.1, repeat: -1, yoyo: true, ease: 'sine.inOut' });
		}

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
			// Toujours audible (même en train de couper le son) : c'est le clic qui confirme le
			// changement d'état, contrairement aux autres sons de la page qui, eux, se taisent en muet.
			if (bgm.paused) {
				startAudio();
				beep(440, { duration: 0.05, type: 'triangle', volume: 0.5 });
				beep(659.25, { offset: 0.05, duration: 0.09, type: 'triangle', volume: 0.52 });
			} else {
				beep(349.23, { duration: 0.1, type: 'triangle', volume: 0.52 });
				bgm.pause();
			}
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

		// ---- carte résumé : export PNG (téléchargement navigateur classique) ----
		const actionToast = document.getElementById('actionToast')!;
		function showToast(msg: string) {
			actionToast.textContent = msg;
			actionToast.classList.add('show');
			if (!reduceMotion) gsap.fromTo(actionToast, { scale: 0.85 }, { scale: 1, duration: 0.4, ease: 'back.out(3)' });
			setTimeout(() => actionToast.classList.remove('show'), 2200);
		}

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
	<!-- Même coquille que le récap (chrome, stage, slide) : le décor injecté au montage — grain,
	     halo, rayons, particules, engrenage 3D — s'applique sans une ligne de code en plus. -->
	<div class="app" data-accent="red">
		<div class="chrome">
			<div class="brand">✦ IMPUTO <span>WRAPPED</span></div>
			<div class="chrome-actions">
				<a class="icon-btn" href="/imputation" aria-label="Retour à mon imputation">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
						><path d="M6 6l12 12M18 6L6 18" /></svg
					>
				</a>
			</div>
		</div>

		<div class="stage">
			<section class="slide" data-layout="cover" data-particles="drift" data-backdrop="rays">
				<div class="glow"></div>
				<div class="content empty-content">
					<!-- L'engrenage tourne pour de bon : c'est lui qui dit « ça travaille, repasse plus
					     tard », mieux qu'une phrase de plus. -->
					<div class="cover-mark" data-motion="spin">
						<svg data-shape="gear" viewBox="0 0 200 200"></svg>
					</div>
					<h1 class="cover-title">Ton wrapped {data.year} est encore en fabrication.</h1>
					<p class="cover-sub">
						Le récap se génère automatiquement chaque nuit pendant la période. Reviens un peu plus tard — les engrenages tournent.
					</p>
					<a class="cover-cta" href="/imputation">
						Retour à mon imputation
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
							><path d="M5 12h14M13 6l6 6-6 6" /></svg
						>
					</a>
				</div>
			</section>
		</div>
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
				<a class="icon-btn" id="closeBtn" href="/imputation" aria-label="Quitter le wrapped">
					<svg><use href="#i-close" /></svg>
				</a>
			</div>
		</div>

		<div class="stage">
			<div class="reel" id="reel">
				<section class="slide" data-accent="green" data-layout="cover" data-icon="i-home" data-particles="drift" data-backdrop="rays">
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
					<section class="slide" data-accent="violet" data-icon="i-ticket" data-particles="confetti" data-backdrop="dashes">
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
					<section class="slide" data-accent="amber" data-flip="1" data-icon="i-flame" data-particles="ember" data-backdrop="heat">
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
					<section class="slide" data-accent="magenta" data-icon="i-face" data-particles="bubble" data-backdrop="waves">
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
							<div class="ring-wrap" data-motion="float"><svg data-shape="coin" viewBox="0 0 200 200"></svg></div>
						</div>
					</section>
				{/if}

				{#if w.supportEnabled && w.supportCount > 0}
					<section class="slide" data-accent="cyan" data-flip="1" data-icon="i-shield" data-particles="twinkle" data-backdrop="radar">
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
					<section class="slide" data-accent="violet" data-layout="headline" data-icon="i-activity" data-particles="orbit" data-backdrop="grid">
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
					<section class="slide" data-accent="violet" data-flip="1" data-icon="i-people" data-particles="sway" data-backdrop="beams">
						<div class="glow"></div>
						<div class="content">
							<div class="stat">
								<div class="eyebrow"><svg><use href="#i-people" /></svg>Duo de l'année</div>
								<div class="avatar-pair">
									<div class="avatar-chip me"><UserAvatar userId={data.user?.id} name={data.user?.displayName ?? 'Toi'} size={44} /></div>
									<div class="avatar-chip them"><UserAvatar userId={w.duo.userId} name={w.duo.displayName} size={44} /></div>
								</div>
								<div class="stat-number"><span class="count" data-target={w.duo.ticketsInCommon}>0</span><span class="unit">tickets en commun</span></div>
								<p class="desc">Toi et <mark>{w.duo.displayName}</mark> avez bossé sur {w.duo.ticketsInCommon} tickets ensemble cette année. Ton duo le plus productif.</p>
								<div class="icon-row"><svg><use href="#i-globe" /></svg><svg><use href="#i-ticket" /></svg></div>
							</div>
							<div class="ring-wrap" data-motion="float"><svg data-shape="duo" viewBox="0 0 200 200"></svg></div>
						</div>
					</section>
				{/if}

				<section class="slide" data-accent="green" data-layout="summary" data-icon="i-flag" data-particles="fountain" data-backdrop="burst">
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
						<div class="summary-side">
							<div class="summary-mark" data-motion="spin"><svg data-shape="star" viewBox="0 0 200 200"></svg></div>
							<div class="summary-eyebrow"><svg><use href="#i-flag" /></svg>Ton année</div>
							<h2 class="summary-title">En résumé</h2>
							<p class="summary-desc">Ta carte Wrapped, prête à garder ou à montrer à l'équipe.</p>
							<div class="summary-actions">
								<button class="btn btn-primary" id="downloadBtn"><svg><use href="#i-download" /></svg>Télécharger l'image</button>
							</div>
							<span class="share-toast" id="actionToast"></span>
						</div>
					</div>
				</section>
			</div>
		</div>

		<button class="nav-arrow prev" id="prevBtn" aria-label="Écran précédent"><svg><use href="#i-arrow-l" /></svg></button>
		<button class="nav-arrow next" id="nextBtn" aria-label="Écran suivant"><svg><use href="#i-arrow-r" /></svg></button>
		<!-- Des div, pas des button : un button prend le focus au clic (tabindex="-1" ne bloque que le
		     Tab), et la flèche suivante le repasse en :focus-visible — soit un cadre d'accent autour
		     de 22% de l'écran. Ces zones ne sont qu'un raccourci tactile qui double les flèches, déjà
		     focusables et accessibles : elles n'ont rien à recevoir. -->
		<div class="tap-zone tap-left" id="tapLeft" aria-hidden="true"></div>
		<div class="tap-zone tap-right" id="tapRight" aria-hidden="true"></div>
	</div>

	<canvas id="exportCanvas" width="900" height="1260" style="display:none"></canvas>

	<!-- Musique d'ambiance : loop natif (relance automatiquement à la fin). -->
	<audio id="bgm" src="/wrapped_music.mp3" loop preload="auto"></audio>
{/if}

<style>
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
		--red: #ff5468;
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
		/* Colonne fixée : l'écran d'attente n'a pas de chapitres au centre, sans ça les actions
		   viendraient se caler au milieu de la barre. */
		grid-column: 3;
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

	/* Empilement du fond, du plus loin au plus près : dégradé de base (::after) < grain (::before) <
	   halo < décor + balayage < particules < contenu. Tout est en z-index négatif explicite parce
	   qu'un ::after compte comme le DERNIER enfant : à z-index égal il repassait par-dessus le halo
	   et le décor (donc un aplat opaque sur toute l'ambiance), l'ordre du DOM ne suffit pas ici. */
	.slide::before {
		content: '';
		position: absolute;
		inset: -40px;
		z-index: -4;
		background-image: radial-gradient(circle, var(--accent) 1px, transparent 1.3px);
		background-size: 15px 15px;
		opacity: 0.22;
		animation: grain-drift 14s linear infinite;
	}
	.slide::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -5;
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
	/* Posé sur .app (et non sur la slide) pour que le chrome — la marque en haut à gauche — vire
	   aussi : l'écran d'attente doit être rouge en entier, pas rouge avec un logo vert. */
	.app[data-accent='red'] {
		--accent: var(--red);
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
		z-index: -3;
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
		z-index: -2;
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
		z-index: -1;
	}
	.slide :global(.spark.square) {
		border-radius: 1px;
	}
	/* Traînée : le dégradé (transparent -> accent) donne le sens du mouvement, un trait plein
	   ressemblerait juste à une barre qui glisse. */
	.slide :global(.spark.streak) {
		border-radius: 2px;
		background: linear-gradient(180deg, transparent, var(--accent));
	}
	.slide :global(.spark.ring) {
		background: none;
		border: 1.5px solid var(--accent);
	}
	.slide :global(.spark.cross) {
		border-radius: 0;
		background:
			linear-gradient(var(--accent), var(--accent)) center / 100% 1.5px no-repeat,
			linear-gradient(var(--accent), var(--accent)) center / 1.5px 100% no-repeat;
	}
	.slide :global(.spark.dim) {
		background: var(--fg-dim);
	}

	/* ============================================================
	   Décors de fond, un par écran (cf. data-backdrop). Tout est en gradients animés par
	   transform/opacity : aucune boucle JS ne tourne pour ces couches, seules les particules ont
	   besoin de GSAP. Chaque décor est teinté par --accent de l'écran, donc change de couleur en
	   même temps que lui.
	   ============================================================ */
	.slide :global(.backdrop) {
		position: absolute;
		inset: 0;
		z-index: -2;
		pointer-events: none;
		overflow: hidden;
	}

	/* Couverture : colonnes de lumière qui défilent lentement, fondues en haut et en bas. */
	.slide :global(.bd-rays) {
		-webkit-mask-image: linear-gradient(0deg, transparent 2%, #000 34%, #000 62%, transparent 96%);
		mask-image: linear-gradient(0deg, transparent 2%, #000 34%, #000 62%, transparent 96%);
	}
	.slide :global(.bd-rays)::before {
		content: '';
		position: absolute;
		inset: -10% -20%;
		background: repeating-linear-gradient(96deg, transparent 0 78px, color-mix(in srgb, var(--accent) 38%, transparent) 78px 81px);
		opacity: 0.6;
		animation: bd-slide-x 16s linear infinite;
	}
	@keyframes bd-slide-x {
		to {
			transform: translateX(-160px);
		}
	}

	/* Ticket : rangées de perforations qui défilent, comme un coupon qu'on déroule. */
	.slide :global(.bd-dashes)::before {
		content: '';
		position: absolute;
		inset: -10%;
		background-image: repeating-linear-gradient(90deg, color-mix(in srgb, var(--accent) 55%, transparent) 0 16px, transparent 16px 34px);
		-webkit-mask-image: repeating-linear-gradient(0deg, #000 0 2.5px, transparent 2.5px 66px);
		mask-image: repeating-linear-gradient(0deg, #000 0 2.5px, transparent 2.5px 66px);
		opacity: 0.8;
		animation: bd-dashes 5s linear infinite;
	}
	@keyframes bd-dashes {
		to {
			transform: translateX(68px);
		}
	}

	/* Série : deux panaches de chaleur qui montent du bas, décalés dans le temps. */
	.slide :global(.bd-heat)::before,
	.slide :global(.bd-heat)::after {
		content: '';
		position: absolute;
		left: -20%;
		right: -20%;
		bottom: -25%;
		height: 80%;
		background: radial-gradient(58% 100% at 32% 100%, color-mix(in srgb, var(--accent) 40%, transparent), transparent 72%);
		filter: blur(30px);
		animation: bd-heat 6s ease-in-out infinite alternate;
	}
	.slide :global(.bd-heat)::after {
		background: radial-gradient(46% 100% at 74% 100%, color-mix(in srgb, var(--accent) 32%, transparent), transparent 72%);
		animation-duration: 8s;
		animation-delay: -3s;
	}
	@keyframes bd-heat {
		from {
			transform: translateY(8%) scaleX(1);
			opacity: 0.3;
		}
		to {
			transform: translateY(-10%) scaleX(1.18);
			opacity: 0.62;
		}
	}

	/* Humeur : ondes concentriques qui s'écartent — un dégradé radial répété qu'on grossit, les
	   anneaux s'écartent tout seuls sans avoir à en animer un par un. */
	.slide :global(.bd-waves)::before,
	.slide :global(.bd-waves)::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 120vmax;
		height: 120vmax;
		margin: -60vmax;
		border-radius: 50%;
		background: repeating-radial-gradient(circle at 50% 50%, transparent 0 48px, color-mix(in srgb, var(--accent) 26%, transparent) 48px 50px);
		animation: bd-waves 8s linear infinite;
	}
	.slide :global(.bd-waves)::after {
		animation-delay: -4s;
	}
	@keyframes bd-waves {
		0% {
			transform: scale(0.5);
			opacity: 0;
		}
		25% {
			opacity: 0.5;
		}
		100% {
			transform: scale(1);
			opacity: 0;
		}
	}

	/* Support : balayage radar + cercles de portée. */
	.slide :global(.bd-radar)::before {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 130vmax;
		height: 130vmax;
		margin: -65vmax;
		border-radius: 50%;
		background: conic-gradient(from 0deg, color-mix(in srgb, var(--accent) 30%, transparent) 0deg, transparent 46deg);
		opacity: 0.38;
		animation: bd-spin 7s linear infinite;
	}
	.slide :global(.bd-radar)::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 110vmin;
		height: 110vmin;
		margin: -55vmin;
		border-radius: 50%;
		background: repeating-radial-gradient(circle at 50% 50%, transparent 0 62px, color-mix(in srgb, var(--accent) 22%, transparent) 62px 63px);
		opacity: 0.5;
	}
	@keyframes bd-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Volume : sol en perspective qui défile vers l'horizon. */
	/* La perspective place l'horizon à `perspective / tan(angle)` au-dessus de l'origine (ici ~300px)
	   : c'est toute la hauteur d'écran que le sol peut occuper. Une origine posée trop bas sortait
	   donc la grille entière du cadre — d'où bottom:0 et une perspective large plutôt que courte. */
	.slide :global(.bd-grid)::before {
		content: '';
		position: absolute;
		left: -60%;
		right: -60%;
		bottom: 0;
		height: 180%;
		background-image:
			repeating-linear-gradient(90deg, color-mix(in srgb, var(--accent) 55%, transparent) 0 1px, transparent 1px 72px),
			repeating-linear-gradient(0deg, color-mix(in srgb, var(--accent) 55%, transparent) 0 1px, transparent 1px 72px);
		transform: perspective(1600px) rotateX(68deg);
		transform-origin: 50% 100%;
		-webkit-mask-image: linear-gradient(0deg, #000 0 6%, transparent 62%);
		mask-image: linear-gradient(0deg, #000 0 6%, transparent 62%);
		opacity: 0.5;
		animation: bd-grid 3.4s linear infinite;
	}
	/* Le défilement passe par translateY (dans le repère du plan, donc "vers l'horizon") et pas par
	   background-position : celui-ci repeint tout le calque à chaque frame — un calque haut de 180%
	   d'écran, masqué et mis en perspective — alors qu'une transform reste sur le compositeur. */
	@keyframes bd-grid {
		from {
			transform: perspective(1600px) rotateX(68deg) translateY(0);
		}
		to {
			transform: perspective(1600px) rotateX(68deg) translateY(72px);
		}
	}

	/* Duo : deux faisceaux inclinés qui se croisent et se recroisent lentement. */
	.slide :global(.bd-beams)::before,
	.slide :global(.bd-beams)::after {
		content: '';
		position: absolute;
		top: -70%;
		bottom: -70%;
		left: 50%;
		width: 34vmax;
		background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 22%, transparent), transparent);
		filter: blur(10px);
		animation: bd-beam-a 10s ease-in-out infinite alternate;
	}
	.slide :global(.bd-beams)::after {
		background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--fg-dim) 20%, transparent), transparent);
		animation-name: bd-beam-b;
		animation-duration: 13s;
	}
	@keyframes bd-beam-a {
		from {
			transform: translateX(-125%) rotate(19deg);
		}
		to {
			transform: translateX(-55%) rotate(19deg);
		}
	}
	@keyframes bd-beam-b {
		from {
			transform: translateX(-40%) rotate(-19deg);
		}
		to {
			transform: translateX(20%) rotate(-19deg);
		}
	}

	/* Récap : gerbe de rayons qui tourne très lentement derrière la carte. */
	.slide :global(.bd-burst)::before {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 130vmax;
		height: 130vmax;
		margin: -65vmax;
		background: repeating-conic-gradient(
			from 0deg at 50% 50%,
			color-mix(in srgb, var(--accent) 20%, transparent) 0deg 4deg,
			transparent 4deg 15deg
		);
		-webkit-mask-image: radial-gradient(circle at 50% 50%, transparent 10%, #000 40%, transparent 70%);
		mask-image: radial-gradient(circle at 50% 50%, transparent 10%, #000 40%, transparent 70%);
		opacity: 0.35;
		animation: bd-spin 48s linear infinite;
	}

	/* Ligne de coupure de l'écran de sortie (cf. closeWrapped) : c'est elle qui reste une fraction
	   de seconde quand l'image s'est écrasée, avant de se refermer sur elle-même. */
	.app :global(.crt-line) {
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 2px;
		margin-top: -1px;
		z-index: 30;
		background: #fff;
		box-shadow:
			0 0 24px 6px color-mix(in srgb, var(--green) 75%, transparent),
			0 0 70px 18px color-mix(in srgb, var(--green) 30%, transparent);
		opacity: 0;
		pointer-events: none;
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

	/* Capots translucides + parois plus sourdes : chaque arête reste visible (le solide se lit comme
	   un fil de fer) mais l'empilement des faces donne la matière. Traits fins : là où il y avait
	   deux chemins, il y en a maintenant une trentaine.
	   Portée `.slide` plutôt qu'une liste de conteneurs : les quatre emplacements de solides
	   (illustration, marque de couverture, filigrane de la carte, étoile du récap) partagent le même
	   rendu, les énumérer un par un ne faisait qu'inviter à en oublier un au prochain ajout. */
	.slide :global(.rw-outer) {
		fill: color-mix(in srgb, var(--accent) 20%, transparent);
		stroke: var(--accent);
		stroke-width: 2.4;
		stroke-linejoin: round;
	}
	.slide :global(.rw-side) {
		fill: color-mix(in srgb, var(--accent) 9%, transparent);
		stroke: color-mix(in srgb, var(--accent) 55%, transparent);
		stroke-width: 1.6;
		stroke-linejoin: round;
	}
	.slide :global(.rw-hub) {
		fill: color-mix(in srgb, var(--accent) 55%, transparent);
		stroke: var(--accent);
		stroke-width: 1.6;
		stroke-linejoin: round;
	}
	.slide :global(.rw-mark-fill) {
		fill: var(--fg);
		stroke: var(--fg);
		stroke-width: 1.2;
		stroke-linejoin: round;
	}
	.slide :global(.rw-outer-dim) {
		fill: color-mix(in srgb, var(--fg-dim) 14%, transparent);
		stroke: var(--fg-dim);
		stroke-width: 2;
		stroke-linejoin: round;
	}
	.slide :global(.rw-side-dim) {
		fill: color-mix(in srgb, var(--fg-dim) 7%, transparent);
		stroke: color-mix(in srgb, var(--fg-dim) 60%, transparent);
		stroke-width: 1.4;
		stroke-linejoin: round;
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

	.avatar-pair {
		display: flex;
	}
	.avatar-chip {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 2px solid var(--ink);
		overflow: hidden;
	}
	.avatar-chip.me {
		z-index: 1;
	}
	.avatar-chip.them {
		margin-left: -14px;
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
		color: var(--accent);
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
		border: 1.6px solid var(--accent);
		background: transparent;
		color: var(--accent);
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
	.cover-cta svg {
		width: 15px;
		height: 15px;
		flex-shrink: 0;
	}
	/* Le CTA est un <button> sur la couverture, un <a> sur l'écran d'attente. */
	a.cover-cta {
		text-decoration: none;
	}
	/* Titre un cran plus large et plus petit que sur la couverture : la phrase est plus longue, et à
	   16ch elle tombait sur trois lignes qui écrasaient l'engrenage. */
	.empty-content .cover-title {
		max-width: 24ch;
		font-size: clamp(2rem, 5.2vw, 3.4rem);
	}
	.empty-content .cover-sub {
		max-width: 52ch;
		text-wrap: balance;
	}
	.cover-cta:hover {
		background: var(--accent);
		color: var(--ink);
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

	.summary-side {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
	}
	.summary-mark {
		color: var(--green);
		margin-bottom: 1.4rem;
	}
	.summary-mark svg {
		width: 112px;
		height: 112px;
		overflow: visible;
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
	/* Sans dimensions, un <svg> inline se dessine en 300×150 : le petit drapeau occupait la moitié
	   de la colonne. Les autres eyebrows ont toujours eu leur règle, celle-ci manquait. */
	.summary-eyebrow svg {
		width: 15px;
		height: 15px;
		flex-shrink: 0;
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
	.share-toast {
		display: block;
		margin-top: 0.8rem;
		font-size: 0.78rem;
		color: var(--green);
		opacity: 0;
		transition: opacity 0.25s;
	}
	/* Même raison que .idle ci-dessus : la classe est ajoutée par showToast(), donc élaguée si elle
	   n'est pas globale — le toast « Image enregistrée » restait invisible. */
	:global(.share-toast.show) {
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
		cursor: pointer;
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
