/**
 * Dessin des badges — SVG autonome, sans dépendance ni bitmap.
 *
 * Trois couches indépendantes, c'est ce qui fait la variété sans multiplier le code :
 *   • une MONTURE parmi cinq silhouettes (écusson, temple, arche, hexagone, bannière) ;
 *   • une PALETTE de ciel propre au badge ;
 *   • une SCÈNE propre au badge, sertie dans la fenêtre de la monture.
 * Deux badges ne partagent donc jamais la même combinaison, alors qu'une seule monture et un seul
 * jeu de filtres sont à maintenir.
 *
 * Le relief n'est pas un dégradé peint à la main : c'est un filtre SVG standard — flou de l'alpha,
 * puis feSpecularLighting avec une source ponctuelle déplaçable. Bouger cette source (pointeur,
 * gyroscope, rotation d'une animation) fait glisser le reflet sur le métal. three.js pèserait
 * ~600 ko pour ce que six primitives SVG donnent déjà, et le rendu reste des <path> : net à toutes
 * les tailles et exportable côté serveur, comme avatarSvg.
 *
 * Aucune donnée utilisateur n'entre ici — tout vient de ce fichier et du catalogue — donc
 * l'injection du résultat via {@html} n'ouvre aucune surface d'attaque.
 */

export type MaterialKey = 'stone' | 'bronze' | 'silver' | 'gold' | 'irid';

export const MATERIALS: Record<MaterialKey, { name: string; stops: string[]; spec: number; exp: number; tint: string }> =
	{
		stone: { name: 'Pierre', stops: ['#8d8a84', '#c9c6bf', '#f0eee9', '#a7a39c', '#6f6c66'], spec: 0.55, exp: 12, tint: '#cfcbc3' },
		bronze: { name: 'Bronze', stops: ['#6b3f1c', '#b4712f', '#e8b169', '#9a5c26', '#5a3416'], spec: 1.0, exp: 22, tint: '#c9833c' },
		silver: { name: 'Argent', stops: ['#7c8794', '#c3cdd8', '#ffffff', '#9aa5b1', '#6a747f'], spec: 1.3, exp: 30, tint: '#cfdae6' },
		gold: { name: 'Or', stops: ['#8a6414', '#d9a93a', '#fff2bf', '#c08f28', '#7a570f'], spec: 1.45, exp: 34, tint: '#e8bf55' },
		irid: { name: 'Iridium', stops: ['#5b3fa0', '#2f9bd6', '#eafff4', '#d95fa8', '#4a2f8c'], spec: 1.7, exp: 40, tint: '#9b6fe0' }
	};

export const TIER_MATERIAL: MaterialKey[] = ['stone', 'bronze', 'silver', 'gold', 'irid'];
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/* ------------------------------------------------------------------ montures */
type Shape = { frame: string; window: string; medal: [number, number]; crest?: string };

const SHAPES: Record<string, Shape> = {
	// Écusson classique, pointe en bas.
	shield: {
		frame: 'M100 4 L172 36 L178 48 L178 116 C178 162 142 194 100 208 C58 194 22 162 22 116 L22 48 L28 36 Z',
		window: 'M100 26 L158 52 L162 60 L162 114 C162 148 134 172 100 184 C66 172 38 148 38 114 L38 60 L42 52 Z',
		medal: [100, 182],
		crest: 'M74 26 C84 16 92 14 99 14 M126 26 C116 16 108 14 101 14'
	},
	// Fronton de temple : deux rampants et une base droite.
	temple: {
		frame: 'M100 6 L180 52 L180 64 L170 64 L170 186 C170 196 164 202 154 202 L46 202 C36 202 30 196 30 186 L30 64 L20 64 L20 52 Z',
		window: 'M100 30 L158 64 L158 178 L42 178 L42 64 Z',
		medal: [100, 194],
		crest: 'M60 44 L100 22 L140 44'
	},
	// Arche : plein cintre en haut, épaules verticales.
	arch: {
		frame: 'M100 6 C142 6 172 38 172 82 L172 172 C172 186 162 196 148 196 L52 196 C38 196 28 186 28 172 L28 82 C28 38 58 6 100 6 Z',
		window: 'M100 26 C132 26 156 50 156 84 L156 164 C156 172 150 178 142 178 L58 178 C50 178 44 172 44 164 L44 84 C44 50 68 26 100 26 Z',
		medal: [100, 188]
	},
	// Hexagone posé sur la pointe : silhouette anguleuse, très différente des trois autres.
	hex: {
		frame: 'M100 4 L170 40 L170 138 L100 208 L30 138 L30 40 Z',
		window: 'M100 26 L154 54 L154 132 L100 184 L46 132 L46 54 Z',
		medal: [100, 174]
	},
	// Blason à bannière : deux pans d'étoffe qui pendent sous l'écu.
	banner: {
		frame: 'M100 6 L168 30 L168 116 C168 150 140 174 100 188 C60 174 32 150 32 116 L32 30 Z M60 174 L60 214 L78 202 L96 214 L96 186 M140 174 L140 214 L122 202 L104 214 L104 186',
		window: 'M100 28 L152 46 L152 112 C152 140 130 158 100 170 C70 158 48 140 48 112 L48 46 Z',
		medal: [100, 178]
	}
};

/* -------------------------------------------------------------------- scènes */
// Aplats francs, peu de nuances : lisible à 80 px comme à 300. Le sujet occupe ~45 % de la fenêtre
// pour que le décor respire — un sujet plein cadre mange son propre arrière-plan.

const stars = (pts: [number, number, number][]) =>
	pts.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="0.65"/>`).join('');

const ground = (fill = '#0f1734') =>
	`<path d="M20 150 C56 142 84 152 100 152 C122 152 148 142 180 150 L180 210 L20 210 Z" fill="${fill}"/>`;

type Art = { shape: keyof typeof SHAPES; sky: [string, string, string]; scene: (id: string) => string };

export const ART: Record<string, Art> = {
	// Série de jours : un sentier de dalles qui file vers un soleil levant.
	assidu: {
		shape: 'arch',
		sky: ['#11224a', '#3b3a76', '#e0794a'],
		scene: () => `
			<circle cx="100" cy="118" r="26" fill="#ffd08a" opacity="0.95"/>
			<path d="M30 138 L170 138 L170 96 L30 96 Z" fill="none"/>
			<path d="M44 150 L156 150 L138 132 L62 132 Z" fill="#1b2550"/>
			${[0, 1, 2, 3].map((i) => `<rect x="${78 - i * 12}" y="${140 - i * 6}" width="${44 + i * 24}" height="5" rx="2.5" fill="#ffce8a" opacity="${0.9 - i * 0.18}"/>`).join('')}
			${ground('#101a3c')}
			<path d="M20 152 C60 146 140 146 180 152 L180 158 C140 152 60 152 20 158 Z" fill="#c9762f" opacity="0.5"/>`
	},
	// Ponctualité : une horloge dont l'aiguille marque l'heure pile, au petit matin.
	ponctuel: {
		shape: 'hex',
		sky: ['#0e1f45', '#2b4076', '#8fb2d8'],
		scene: (id) => `
			${stars([[64, 52, 1.4], [136, 46, 1.2]])}
			<circle cx="100" cy="104" r="34" fill="#f3f0e6" stroke="#0a0a0c" stroke-width="3"/>
			<circle cx="100" cy="104" r="34" fill="url(#met-${id})" opacity="0.25"/>
			${Array.from({ length: 12 }, (_, i) => {
				const a = (i / 12) * Math.PI * 2;
				const x = 100 + Math.sin(a) * 27;
				const y = 104 - Math.cos(a) * 27;
				return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i % 3 === 0 ? 2.2 : 1.2}" fill="#1b2550"/>`;
			}).join('')}
			<path d="M100 104 L100 84" stroke="#1b2550" stroke-width="3.4" stroke-linecap="round"/>
			<path d="M100 104 L118 112" stroke="#c62f14" stroke-width="2.6" stroke-linecap="round"/>
			<circle cx="100" cy="104" r="3" fill="#c62f14"/>
			${ground('#16214d')}`
	},
	// RAE frais : une goutte au-dessus d'un bassin, ondes concentriques.
	'rae-frais': {
		shape: 'arch',
		sky: ['#06263a', '#0f4f63', '#67c6b5'],
		scene: () => `
			<path d="M100 54 C114 78 124 90 124 104 C124 118 113 128 100 128 C87 128 76 118 76 104 C76 90 86 78 100 54 Z"
			      fill="#9fe8dd" stroke="#0a0a0c" stroke-width="2.4"/>
			<path d="M100 78 C108 92 113 100 113 108 C113 117 107 123 100 123 C93 123 87 117 87 108 C87 100 92 92 100 78 Z" fill="#e6fffb" opacity="0.8"/>
			${[0, 1, 2].map((i) => `<ellipse cx="100" cy="${150 + i * 8}" rx="${26 + i * 22}" ry="${5 + i * 2}" fill="none" stroke="#8fe3d6" stroke-width="2" opacity="${0.7 - i * 0.2}"/>`).join('')}
			<path d="M20 146 L180 146 L180 210 L20 210 Z" fill="#07344a"/>`
	},
	// Chiffrage : compas et plan, ambiance atelier.
	chiffreur: {
		shape: 'temple',
		sky: ['#152036', '#2d3f5e', '#7d6a9c'],
		scene: () => `
			<rect x="52" y="92" width="96" height="66" rx="3" fill="#e8e3d4" stroke="#0a0a0c" stroke-width="2.4"/>
			${[0, 1, 2, 3].map((i) => `<path d="M62 ${104 + i * 13} L${i % 2 ? 122 : 138} ${104 + i * 13}" stroke="#7d8aa6" stroke-width="2.4" stroke-linecap="round"/>`).join('')}
			<path d="M100 48 L74 100" stroke="#d9a93a" stroke-width="5" stroke-linecap="round"/>
			<path d="M100 48 L126 100" stroke="#c08f28" stroke-width="5" stroke-linecap="round"/>
			<circle cx="100" cy="48" r="5.5" fill="#fff2bf" stroke="#0a0a0c" stroke-width="2"/>
			<path d="M78 88 C88 95 112 95 122 88" fill="none" stroke="#d9a93a" stroke-width="2.4"/>`
	},
	// Estimation juste : une flèche plantée au centre de la cible.
	'dans-le-mille': {
		shape: 'hex',
		sky: ['#101a43', '#33305f', '#b05a4a'],
		scene: () => `
			${[34, 25, 16, 8].map((r, i) => `<circle cx="100" cy="104" r="${r}" fill="${i % 2 ? '#f3f0e6' : '#c62f14'}" stroke="#0a0a0c" stroke-width="${i === 0 ? 2.6 : 1.4}"/>`).join('')}
			<circle cx="100" cy="104" r="3.4" fill="#1b2550"/>
			<path d="M148 60 L104 100" stroke="#e8e3d4" stroke-width="4" stroke-linecap="round"/>
			<path d="M148 60 L136 62 L146 72 Z" fill="#d9a93a" stroke="#0a0a0c" stroke-width="1.4"/>
			${ground('#141c40')}`
	},
	// Team mood : une urne et des bulletins qui volent.
	'voix-du-peuple': {
		shape: 'arch',
		sky: ['#1a1440', '#402a66', '#d1698f'],
		scene: () => `
			${stars([[56, 48, 1.4], [146, 54, 1.2], [120, 38, 1]])}
			<path d="M64 116 L136 116 L130 166 L70 166 Z" fill="#3d4f86" stroke="#0a0a0c" stroke-width="2.4"/>
			<rect x="86" y="110" width="28" height="7" rx="2" fill="#1b2550"/>
			<rect x="74" y="80" width="24" height="30" rx="2" fill="#f3f0e6" stroke="#0a0a0c" stroke-width="2" transform="rotate(-14 86 95)"/>
			<rect x="104" y="70" width="24" height="30" rx="2" fill="#e8e3d4" stroke="#0a0a0c" stroke-width="2" transform="rotate(12 116 85)"/>
			<path d="M80 92 h12 M80 98 h8" stroke="#7d8aa6" stroke-width="2" stroke-linecap="round" transform="rotate(-14 86 95)"/>
			${ground('#171245')}`
	},
	// Objectifs tenus : une coche massive posée sur un ruban.
	'parole-tenue': {
		shape: 'hex',
		sky: ['#0d2a22', '#1c4f3c', '#86c46a'],
		scene: () => `
			<circle cx="100" cy="104" r="38" fill="#143a2e" stroke="#0a0a0c" stroke-width="2.4"/>
			<path d="M78 104 L94 120 L126 88" fill="none" stroke="#a8e66a" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
			<path d="M78 104 L94 120 L126 88" fill="none" stroke="#0a0a0c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.4"/>
			<path d="M44 152 L156 152 L146 168 L54 168 Z" fill="#2c6b4f" stroke="#0a0a0c" stroke-width="2"/>
			${ground('#0b2a20')}`
	},
	// Tour de garde : un phare qui balaie la nuit.
	'de-garde': {
		shape: 'shield',
		sky: ['#08142e', '#1b2a55', '#3c5a86'],
		scene: () => `
			${stars([[58, 46, 1.5], [140, 40, 1.2], [78, 34, 1]])}
			<path d="M120 78 L178 58 L178 100 Z" fill="#ffe9a8" opacity="0.28"/>
			<path d="M88 152 L94 86 L112 86 L118 152 Z" fill="#33406e" stroke="#0a0a0c" stroke-width="2.2"/>
			<rect x="90" y="112" width="26" height="7" fill="#22305f"/>
			<rect x="92" y="70" width="22" height="18" rx="3" fill="#ffd98a" stroke="#0a0a0c" stroke-width="2.2"/>
			<path d="M96 62 L110 62 L112 70 L94 70 Z" fill="#3d4f86" stroke="#0a0a0c" stroke-width="2"/>
			${ground('#0c1730')}
			<path d="M20 154 C60 150 140 158 180 152 L180 210 L20 210 Z" fill="#081228"/>`
	},
	// Support : la flamme, cernée de métal comme un pin cloisonné.
	pompier: {
		shape: 'shield',
		sky: ['#101a43', '#25306b', '#6b3a55'],
		scene: (id) => `
			<circle cx="136" cy="58" r="8.5" fill="#ffeab0" opacity="0.92"/>
			${stars([[60, 50, 1.6], [78, 41, 1.2], [118, 38, 1.4]])}
			<ellipse cx="78" cy="62" rx="22" ry="13" fill="#8e96b8" opacity="0.16"/>
			<ellipse cx="108" cy="50" rx="17" ry="10" fill="#8e96b8" opacity="0.12"/>
			<path d="M38 132 L38 118 L48 118 L48 110 L58 110 L58 120 L70 120 L70 104 L80 104 L80 120
			         L92 120 L92 112 L104 112 L104 122 L118 122 L118 106 L128 106 L128 122 L140 122
			         L140 116 L150 116 L150 132 Z" fill="#16214d"/>
			<path d="M84 150 L84 122 L100 112 L116 122 L116 150 Z" fill="#22305f"/>
			<path d="M80 124 L100 110 L120 124 Z" fill="#2c3c71"/>
			<rect x="94" y="134" width="12" height="16" rx="1" fill="#ffc46a" opacity="0.9"/>
			<path d="M100 70 C114 92 127 102 127 122 C127 142 115 155 100 155 C85 155 73 142 73 122
			         C73 107 83 102 90 92 C92 104 98 107 99 100 C102 92 96 83 100 70 Z"
			      fill="url(#fire-${id})" stroke="#0a0a0c" stroke-width="2.2" filter="url(#bevelSoft-${id})"/>
			<path d="M100 94 C110 108 116 116 116 128 C116 140 109 148 100 148 C91 148 84 140 84 128
			         C84 118 92 112 100 94 Z" fill="#ff9a3c" opacity="0.95"/>
			<path d="M100 114 C106 124 110 129 110 136 C110 144 105 149 100 149 C95 149 90 144 90 136
			         C90 129 94 124 100 114 Z" fill="#ffe09a"/>
			${ground()}`
	},
	// Congés anticipés : une longue-vue braquée sur un horizon lointain.
	prevoyant: {
		shape: 'arch',
		sky: ['#0b1c3e', '#27407a', '#e2a05c'],
		scene: () => `
			<circle cx="132" cy="62" r="10" fill="#ffe0a3" opacity="0.9"/>
			${stars([[62, 48, 1.4], [88, 38, 1.1]])}
			<path d="M56 140 L128 88" stroke="#3d4f86" stroke-width="15" stroke-linecap="round"/>
			<path d="M56 140 L128 88" stroke="#5d72a8" stroke-width="9" stroke-linecap="round"/>
			<circle cx="132" cy="85" r="10" fill="#cfe3ff" stroke="#0a0a0c" stroke-width="2.2"/>
			<circle cx="54" cy="142" r="7" fill="#22305f" stroke="#0a0a0c" stroke-width="2"/>
			<path d="M84 152 L92 168 L74 168 Z" fill="#22305f"/>
			${ground('#0d1b3a')}`
	},
	// Duo : deux anneaux enchaînés, l'un devant l'autre.
	binome: {
		shape: 'banner',
		sky: ['#151038', '#37306e', '#9a5ba6'],
		scene: (id) => `
			${stars([[62, 46, 1.4], [140, 52, 1.2]])}
			<circle cx="84" cy="104" r="28" fill="none" stroke="url(#met-${id})" stroke-width="10"/>
			<circle cx="84" cy="104" r="28" fill="none" stroke="#0a0a0c" stroke-width="2" opacity="0.5"/>
			<circle cx="118" cy="116" r="28" fill="none" stroke="#cfd8ff" stroke-width="9"/>
			<circle cx="118" cy="116" r="28" fill="none" stroke="#0a0a0c" stroke-width="2" opacity="0.45"/>
			<path d="M92 84 A28 28 0 0 1 108 92" fill="none" stroke="url(#met-${id})" stroke-width="10"/>
			${ground('#130f33')}`
	},
	// Découvertes : rose des vents en gros plan. Une carte dépliée ne donnait qu'un aplat beige
	// informe à petite taille ; une rose a une silhouette rayonnante qui reste lisible à 80 px.
	explorateur: {
		shape: 'banner',
		sky: ['#0b2233', '#1b4a5e', '#d9b877'],
		scene: (id) => `
			${stars([[58, 48, 1.4], [140, 44, 1.2], [120, 34, 1]])}
			<circle cx="100" cy="104" r="46" fill="#0e3346" opacity="0.85"/>
			<circle cx="100" cy="104" r="46" fill="none" stroke="url(#met-${id})" stroke-width="3"/>
			<circle cx="100" cy="104" r="38" fill="none" stroke="#8fc6d8" stroke-width="1.2" opacity="0.7"/>
			${Array.from({ length: 8 }, (_, i) => {
				const a = (i / 8) * Math.PI * 2;
				const long = i % 2 === 0 ? 40 : 24;
				const w = i % 2 === 0 ? 9 : 6;
				const tx = (100 + Math.sin(a) * long).toFixed(1);
				const ty = (104 - Math.cos(a) * long).toFixed(1);
				const lx = (100 + Math.sin(a + Math.PI / 2) * w).toFixed(1);
				const ly = (104 - Math.cos(a + Math.PI / 2) * w).toFixed(1);
				const rx = (100 + Math.sin(a - Math.PI / 2) * w).toFixed(1);
				const ry = (104 - Math.cos(a - Math.PI / 2) * w).toFixed(1);
				// Une branche sur deux en clair : c'est ce contraste qui donne le relief de la rose.
				const fill = i === 0 ? '#c62f14' : i % 2 === 0 ? '#f3f0e6' : '#7aa8bd';
				return `<path d="M${tx} ${ty} L${lx} ${ly} L100 104 L${rx} ${ry} Z" fill="${fill}" stroke="#0a0a0c" stroke-width="1.4" stroke-linejoin="round"/>`;
			}).join('')}
			<circle cx="100" cy="104" r="5" fill="url(#met-${id})" stroke="#0a0a0c" stroke-width="1.6"/>
			<text x="100" y="58" text-anchor="middle" font-size="13" font-weight="700"
			      font-family="Georgia, serif" fill="#e8ddbd">N</text>`
	},
	// Clôtures : une balance en équilibre. Le fronton qu'il y avait ici doublait la monture temple —
	// un temple dessiné dans un temple, d'où la bouillie. La balance a une silhouette symétrique qui
	// se détache du cadre au lieu de le répéter.
	comptable: {
		shape: 'temple',
		sky: ['#1d1a32', '#3a3258', '#c08f28'],
		scene: (id) => `
			<!-- Le fléau d'abord, épais et cerné : c'est la barre horizontale qui fait lire « balance ».
			     Trop fine, elle disparaissait et il ne restait que deux coupelles flottantes. -->
			<path d="M100 84 L100 152" stroke="url(#met-${id})" stroke-width="7"/>
			<path d="M100 84 L100 152" stroke="#0a0a0c" stroke-width="1.6" opacity="0.5"/>
			<path d="M56 84 L144 84" stroke="#0a0a0c" stroke-width="11" stroke-linecap="round"/>
			<path d="M56 84 L144 84" stroke="url(#met-${id})" stroke-width="7.5" stroke-linecap="round"/>
			<!-- Index posé SUR le fléau (base à y=84) : détaché, il avait l'air de flotter. -->
			<path d="M100 66 L109 84 L91 84 Z" fill="url(#met-${id})" stroke="#0a0a0c" stroke-width="1.8" stroke-linejoin="round"/>
			<!-- Suspentes + plateaux : des arcs, pas des ellipses pleines — un plateau vu de trois
			     quarts se lit mieux qu'un disque, qui passerait pour une pièce de plus. -->
			${[56, 144].map(
				(x) => `
				<path d="M${x} 86 L${x - 15} 108 M${x} 86 L${x + 15} 108" stroke="#cbb27a" stroke-width="1.8"/>
				<path d="M${x - 21} 108 A21 21 0 0 0 ${x + 21} 108 Z" fill="url(#met-${id})" stroke="#0a0a0c" stroke-width="2.2"/>`
			).join('')}
			${[0, 1, 2].map((i) => `<ellipse cx="${140 + (i % 2) * 7}" cy="${104 - i * 5}" rx="9" ry="3.4" fill="#ffe09a" stroke="#0a0a0c" stroke-width="1.2"/>`).join('')}
			<!-- Socle large et posé au-dessus de la ligne de sol, sinon il s'y noie. -->
			<path d="M70 164 L130 164 L120 152 L80 152 Z" fill="url(#met-${id})" stroke="#0a0a0c" stroke-width="2.2" stroke-linejoin="round"/>
			<path d="M20 166 C56 160 84 168 100 168 C122 168 148 160 180 166 L180 210 L20 210 Z" fill="#191630"/>`
	}
};

/** Repli tant qu'un badge n'a pas sa scène : même monture, ciel neutre et monogramme. */
const DEFAULT_ART: Art = {
	shape: 'shield',
	sky: ['#101a43', '#25306b', '#6b3a55'],
	scene: () => ''
};

/**
 * Badge non décroché : une plaque muette, la MÊME pour tous.
 *
 * Griser le vrai dessin révélait la monture, le ciel et la scène — donc toute la surprise, pour les
 * treize badges d'un coup. Une silhouette unique ne dit rien de ce qui attend : ni la forme, ni la
 * couleur, ni le sujet. Le nom et la consigne d'obtention, eux, restent en clair à côté : on doit
 * savoir ce qu'on peut gagner et comment, c'est le dessin seul qui se mérite.
 */
export function mysterySvg(uid: string, big = false): string {
	const plate = 'M100 10 L166 42 L166 118 C166 158 136 186 100 200 C64 186 34 158 34 118 L34 42 Z';
	return `
<svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
	<defs>
		<linearGradient id="mys-${uid}" x1="0" y1="0" x2="0.5" y2="1">
			<stop offset="0%" stop-color="#9b9892"/><stop offset="45%" stop-color="#cdc9c2"/>
			<stop offset="100%" stop-color="#807d78"/>
		</linearGradient>
		<filter id="mysbev-${uid}" x="-25%" y="-25%" width="150%" height="150%">
			<feGaussianBlur in="SourceAlpha" stdDeviation="${big ? 2.4 : 1.3}" result="blur"/>
			<feSpecularLighting in="blur" surfaceScale="${big ? 4 : 2.5}" specularConstant="0.5"
				specularExponent="14" lighting-color="#ffffff" result="spec">
				<fePointLight x="60" y="40" z="110"/>
			</feSpecularLighting>
			<feComposite in="spec" in2="SourceAlpha" operator="in" result="specCut"/>
			<feComposite in="SourceGraphic" in2="specCut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>
		</filter>
	</defs>
	<path d="${plate}" fill="url(#mys-${uid})" filter="url(#mysbev-${uid})"/>
	<path d="${plate}" fill="#6f6c66" opacity="0.42"/>
	<text x="100" y="136" text-anchor="middle" font-size="82" font-weight="700"
	      font-family="Georgia, 'Times New Roman', serif" fill="#4a4843" opacity="0.55">?</text>
</svg>`;
}

export type BadgeSvgOptions = {
	badgeId: string;
	/** 0 = pas encore décroché (rendu verrouillé par le composant), 1 à 5 sinon. */
	tier: number;
	/** Identifiant unique par instance : les ids de <defs> sont globaux dans le document. */
	uid: string;
	/** Grand format : biseau plus profond, relief plus marqué. */
	big?: boolean;
	/** Première lettre du nom, pour le repli quand la scène n'est pas dessinée. */
	letter?: string;
};

export function badgeSvg({ badgeId, tier, uid, big = false, letter = '?' }: BadgeSvgOptions): string {
	const key = TIER_MATERIAL[Math.max(0, Math.min(4, tier - 1))];
	const m = MATERIALS[key];
	const [s0, s1, s2, s3, s4] = m.stops;
	const art = ART[badgeId] ?? DEFAULT_ART;
	const shape = SHAPES[art.shape];
	const [mx, my] = shape.medal;
	const body =
		art.scene(uid) ||
		`<text x="100" y="128" text-anchor="middle" font-size="58" font-weight="700"
		       font-family="Georgia, 'Times New Roman', serif" fill="#dfe6ff" opacity="0.9">${letter}</text>`;

	return `
<svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
	<defs>
		<linearGradient id="met-${uid}" x1="0" y1="0" x2="0.6" y2="1">
			<stop offset="0%" stop-color="${s0}"/><stop offset="28%" stop-color="${s1}"/>
			<stop offset="46%" stop-color="${s2}"/><stop offset="66%" stop-color="${s3}"/>
			<stop offset="100%" stop-color="${s4}"/>
		</linearGradient>
		<linearGradient id="sky-${uid}" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color="${art.sky[0]}"/>
			<stop offset="58%" stop-color="${art.sky[1]}"/>
			<stop offset="100%" stop-color="${art.sky[2]}"/>
		</linearGradient>
		<linearGradient id="fire-${uid}" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color="#ffc32e"/><stop offset="45%" stop-color="#ef6a1c"/>
			<stop offset="100%" stop-color="#c62f14"/>
		</linearGradient>

		<filter id="bevel-${uid}" x="-25%" y="-25%" width="150%" height="150%">
			<feGaussianBlur in="SourceAlpha" stdDeviation="${big ? 2.6 : 1.4}" result="blur"/>
			<feSpecularLighting in="blur" surfaceScale="${big ? 5 : 3}" specularConstant="${m.spec}"
				specularExponent="${m.exp}" lighting-color="#ffffff" result="spec">
				<fePointLight x="60" y="40" z="110"/>
			</feSpecularLighting>
			<feComposite in="spec" in2="SourceAlpha" operator="in" result="specCut"/>
			<feComposite in="SourceGraphic" in2="specCut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>
		</filter>
		<!-- Même relief, très atténué : l'émail doit briller sans être délavé. -->
		<filter id="bevelSoft-${uid}" x="-25%" y="-25%" width="150%" height="150%">
			<feGaussianBlur in="SourceAlpha" stdDeviation="${big ? 2.2 : 1.2}" result="blur"/>
			<feSpecularLighting in="blur" surfaceScale="${big ? 3 : 2}" specularConstant="0.45"
				specularExponent="26" lighting-color="#ffffff" result="spec">
				<fePointLight x="60" y="40" z="110"/>
			</feSpecularLighting>
			<feComposite in="spec" in2="SourceAlpha" operator="in" result="specCut"/>
			<feComposite in="SourceGraphic" in2="specCut" operator="arithmetic" k1="0" k2="1" k3="0.55" k4="0"/>
		</filter>

		<linearGradient id="sheen-${uid}" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0%" stop-color="#fff" stop-opacity="0"/>
			<stop offset="45%" stop-color="#fff" stop-opacity="0"/>
			<stop offset="50%" stop-color="#fff" stop-opacity="${key === 'stone' ? 0.16 : 0.5}"/>
			<stop offset="55%" stop-color="#fff" stop-opacity="0"/>
			<stop offset="100%" stop-color="#fff" stop-opacity="0"/>
			<animateTransform attributeName="gradientTransform" type="translate"
				values="-1 -1; 1 1; -1 -1" dur="${key === 'irid' ? '3.2s' : '5.5s'}" repeatCount="indefinite"/>
		</linearGradient>

		<clipPath id="win-${uid}"><path d="${shape.window}"/></clipPath>
	</defs>

	<path d="${shape.frame}" fill="url(#met-${uid})" filter="url(#bevel-${uid})" fill-rule="evenodd"/>
	<g clip-path="url(#win-${uid})">
		<rect x="10" y="10" width="180" height="200" fill="url(#sky-${uid})"/>
		${body}
	</g>
	<!-- Liseré de cloisonnement : c'est lui qui fait lire « pin émaillé » et pas « dessin ». -->
	<path d="${shape.window}" fill="none" stroke="#0a0a0c" stroke-width="3.4"/>
	<path d="${shape.window}" fill="none" stroke="url(#met-${uid})" stroke-width="1.6" opacity="0.85"/>
	${shape.crest ? `<path d="${shape.crest}" fill="none" stroke="url(#met-${uid})" stroke-width="3" stroke-linecap="round" filter="url(#bevel-${uid})"/>` : ''}

	<circle cx="${mx}" cy="${my}" r="15" fill="url(#met-${uid})" stroke="#0a0a0c" stroke-width="1.6" filter="url(#bevel-${uid})"/>
	<text x="${mx}" y="${my + 6}" text-anchor="middle" font-size="15" font-weight="700"
	      font-family="Georgia, 'Times New Roman', serif" fill="#0a0a0c" opacity="0.72">${ROMAN[Math.max(1, tier)]}</text>

	<ellipse cx="84" cy="64" rx="50" ry="24" fill="#fff" opacity="0.1" clip-path="url(#win-${uid})"/>
	<path d="${shape.frame}" fill="url(#sheen-${uid})" fill-rule="evenodd"/>
</svg>`;
}
