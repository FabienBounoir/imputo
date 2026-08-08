<script lang="ts">
	import { page } from '$app/stores';

	const status = $derived($page.status);
	const isServerError = $derived(status >= 500);

	const titles: Record<number, string> = {
		400: 'Requête invalide',
		401: 'Non autorisé',
		403: 'Accès refusé',
		404: 'Page introuvable',
		429: 'Trop de requêtes',
		500: 'Erreur serveur',
		503: 'Service indisponible'
	};

	const title = $derived(
		titles[status] ?? (isServerError ? 'Erreur serveur' : 'Une erreur est survenue')
	);
	const subtitles: Record<number, string> = {
		401: "Vous devez être connecté pour accéder à cette page.",
		403: "Vous n'avez pas les droits nécessaires pour accéder à cette page.",
		404: "Cette page n'existe pas ou a été déplacée."
	};
	const subtitle = $derived(
		subtitles[status] ??
			(isServerError
				? "Quelque chose s'est mal passé de notre côté. Réessayez dans un instant."
				: "Une erreur est survenue.")
	);
</script>

<svelte:head>
	<title>{status} · Imputo</title>
</svelte:head>

<div class="err-page">
	<div class="plug">
		<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="12" cy="12" r="10" />
			<line x1="12" y1="8" x2="12" y2="13" />
			<line x1="12" y1="16" x2="12" y2="16.01" />
		</svg>
	</div>

	<div class="code">{status}</div>
	<h1>{title}</h1>
	<p class="sub">{subtitle}</p>

	<div class="actions">
		<a class="btn btn-primary" href="/">Retour à l'accueil</a>
		<button class="btn btn-ghost" type="button" onclick={() => history.back()}>
			Page précédente
		</button>
	</div>
</div>

<style>
	.err-page {
		min-height: 100vh;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 24px;
	}
	.plug {
		width: 56px;
		margin-bottom: 12px;
	}
	.plug svg {
		width: 100%;
		height: auto;
	}
	.code {
		font-family: var(--font-display);
		font-size: 15px;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: var(--text-mute);
		text-transform: uppercase;
	}
	.err-page h1 {
		font-family: var(--font-display);
		font-size: clamp(26px, 4vw, 36px);
		font-weight: 600;
		letter-spacing: -0.02em;
		margin-top: 6px;
	}
	.sub {
		color: var(--text-mute);
		font-size: 14.5px;
		margin-top: 8px;
		max-width: 380px;
	}
	.actions {
		display: flex;
		gap: 10px;
		margin-top: 26px;
	}
</style>
