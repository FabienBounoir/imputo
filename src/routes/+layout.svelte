<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { applyTheme, storedTheme, type ThemePref } from '$lib/theme';

	let { children, data } = $props();

	const SITE_DESC = 'Tickets, feuille de temps et reporting au même endroit.';

	// Applique la couleur d'accent de l'espace courant + la met en cache pour l'anti-flash.
	$effect(() => {
		const accent = data.workspace?.accentColor;
		if (accent) {
			document.documentElement.style.setProperty('--accent', accent);
			localStorage.setItem('imputo-accent', accent);
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

{@render children()}
