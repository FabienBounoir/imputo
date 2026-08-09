<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { applyTheme, storedTheme, type ThemePref } from '$lib/theme';
	import { hslToHex } from '$lib/color';
	import { beep } from '$lib/sound';
	import { trackKonamiKey, initKonami } from '$lib/konami.svelte';
	import { Confetti } from 'svelte-confetti';

	let { children, data } = $props();

	const SITE_DESC = 'Tickets, feuille de temps et reporting au même endroit.';

	// Applique la couleur d'accent (fixe, ou défilante) + la met en cache pour l'anti-flash.
	// La préférence personnelle (Réglages) prend le pas sur celle de l'espace si elle est activée.
	// Vit ici (racine, toujours montée) pour continuer à défiler quelle que soit la page, et reprendre après un rechargement.
	$effect(() => {
		const ws = data.workspace;
		const u = data.user;
		const mode = u?.accentMode === 'WORKSPACE' || !u ? (ws?.accentRgb ? 'RGB' : 'STATIC') : u.accentMode;
		const color = mode === 'CUSTOM' ? u!.accentColor : ws?.accentColor;

		if (mode === 'RGB') {
			let hue = 0;
			const id = setInterval(() => {
				hue = (hue + 1) % 360;
				document.documentElement.style.setProperty('--accent', hslToHex(hue, 70, 50));
			}, 120);
			return () => clearInterval(id);
		}
		if (color) {
			document.documentElement.style.setProperty('--accent', color);
			localStorage.setItem('imputo-accent', color);
		} else {
			document.documentElement.style.removeProperty('--accent');
			localStorage.removeItem('imputo-accent');
		}
	});

	// Thème : préférence locale, initialisée depuis la préférence serveur au 1er passage.
	$effect(() => {
		let pref = storedTheme();
		if (!pref) {
			pref = ((data.user?.themePref ?? 'SYSTEM').toLowerCase() as ThemePref) || 'system';
			localStorage.setItem('imputo-theme', pref);
		}
		applyTheme(pref);
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const onChange = () => {
			if ((storedTheme() ?? 'system') === 'system') applyTheme('system');
		};
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	// Easter egg : gros ASCII art dans la console au chargement, pour les curieux qui ouvrent les devtools.
	$effect(() => {
		const art = String.raw`
█████ █   █ ████  █   █ █████  ███
  █   ██ ██ █   █ █   █   █   █   █
  █   █ █ █ ████  █   █   █   █   █
  █   █   █ █     █   █   █   █   █
  █   █   █ █     █   █   █   █   █
█████ █   █ █     █████   █    ███
`;
		console.log('%c' + art, 'color:#e0483e; font-weight:bold; font-family:monospace; font-size:12px; line-height:1.15;');
		console.log('%cSuivi & chiffrage — codé avec mon equipe (Sonnet, Opus, Fable).', 'color:#888; font-size:12px;');
		console.log(
			'%cCurieux ? D’autres secrets traînent sur le site',
			'color:#888; font-size:11px; font-style:italic;'
		);
	});

	// Easter egg : Konami code -> confettis + petit jingle + accent qui s'emballe 2s.
	// La détection est partagée (voir $lib/konami.svelte) : une fois débloqué, ça ouvre
	// aussi un réglage caché dans Réglages -> Apparence (forcer un thème de période).
	let confettiTrigger = $state(0);

	// Petit jingle "power-up" synthétisé, pas besoin d'un fichier audio.
	function playKonamiSound() {
		const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
		notes.forEach((freq, i) => beep(freq, { offset: i * 0.09, duration: 0.14 }));
	}

	function accentFrenzy() {
		const root = document.documentElement;
		const restore = root.style.getPropertyValue('--accent');
		let hue = 0;
		const id = setInterval(() => {
			hue = (hue + 15) % 360;
			root.style.setProperty('--accent', hslToHex(hue, 75, 55));
		}, 100);
		setTimeout(() => {
			clearInterval(id);
			if (restore) root.style.setProperty('--accent', restore);
			else root.style.removeProperty('--accent');
		}, 2000);
	}

	function handleKonamiKey(e: KeyboardEvent) {
		if (trackKonamiKey(e)) {
			if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) confettiTrigger++;
			playKonamiSound();
			accentFrenzy();
		}
	}

	$effect(() => {
		initKonami();
		window.addEventListener('keydown', handleKonamiKey);
		return () => window.removeEventListener('keydown', handleKonamiKey);
	});
</script>

<svelte:head>
	<title>Imputo</title>
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Imputo" />
	<meta property="og:title" content="Imputo — Suivi de chiffrage & d'imputation" />
	<meta property="og:description" content={SITE_DESC} />
	<meta property="og:image" content="{$page.url.origin}/og.png" />
	<meta property="og:url" content="{$page.url.origin}{$page.url.pathname}" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Imputo — Suivi de chiffrage & d'imputation" />
	<meta name="twitter:description" content={SITE_DESC} />
	<meta name="twitter:image" content="{$page.url.origin}/og.png" />
	<link rel="canonical" href="{$page.url.origin}{$page.url.pathname}" />
</svelte:head>

{#key confettiTrigger}
	{#if confettiTrigger > 0}
		<div class="konami-confetti" aria-hidden="true">
			<Confetti
				x={[-3, 3]}
				y={[0, 0.3]}
				amount={150}
				fallDistance="100vh"
				duration={3000}
				rounded
			/>
		</div>
	{/if}
{/key}

{@render children()}

<style>
	.konami-confetti {
		position: fixed;
		top: 0;
		left: 50%;
		z-index: 9999;
		pointer-events: none;
	}
</style>
