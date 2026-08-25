<script lang="ts">
	import { enhance } from '$app/forms';
	import PasswordField from '$lib/components/PasswordField.svelte';
	import ModalErrorToast from '$lib/components/ModalErrorToast.svelte';
	let { form } = $props();

	// Décompte du blocage anti brute-force : le serveur donne le délai restant à chaque tentative
	// refusée, le client l'affiche en direct plutôt qu'un message statique qui se périme.
	let remainingMs = $state(0);
	// Changer d'email annule le blocage affiché (il ne vaut que pour l'adresse essayée) : ce drapeau
	// masque le toast jusqu'à la prochaine vraie réponse du serveur, plutôt que de laisser un
	// message obsolète affiché sans compte à rebours.
	let dismissed = $state(false);
	$effect(() => {
		dismissed = false;
		if (!form || !('retryAfterMs' in form) || !form.retryAfterMs) return;
		remainingMs = Number(form.retryAfterMs);
		const t = setInterval(() => {
			remainingMs = Math.max(0, remainingMs - 1000);
			if (remainingMs <= 0) clearInterval(t);
		}, 1000);
		return () => clearInterval(t);
	});
	const locked = $derived(remainingMs > 0);
	const countdown = $derived(
		`${Math.floor(remainingMs / 60000)}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')}`
	);
	const toastMessage = $derived(
		dismissed ? null : locked ? `Trop de tentatives sur ce compte. Réessayez dans ${countdown}.` : (form?.error ?? null)
	);
	function onEmailInput() {
		remainingMs = 0;
		dismissed = true;
	}
</script>

<div class="auth-wrap">
	<div class="auth-card">
		<div class="mark">
			<svg viewBox="108 84 296 296" fill="#fff" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
				<rect x="132" y="284" width="64" height="96" rx="30" />
				<rect x="224" y="230" width="64" height="150" rx="30" />
				<rect x="316" y="170" width="64" height="210" rx="30" />
				<circle cx="348" cy="116" r="32" />
			</svg>
		</div>
		<h2>Bon retour 👋</h2>
		<p class="sub">Connectez-vous à votre espace Imputo.</p>

		<form method="POST" use:enhance>
			<div class="field">
				<label for="em">Email</label>
				<input
					id="em"
					name="email"
					type="email"
					value={form?.values?.email ?? ''}
					oninput={onEmailInput}
					placeholder="vous@entreprise.com"
					required
				/>
			</div>
			<PasswordField id="pw" name="password" label="Mot de passe" autocomplete="current-password" required />
			<button class="btn btn-primary" type="submit" disabled={locked}>
				{locked ? `Réessayer dans ${countdown}` : 'Se connecter'}
			</button>
		</form>

		<div class="auth-foot">Pas encore d'espace ? <a href="/register">Créer un espace</a></div>
	</div>
</div>

{#if toastMessage}<ModalErrorToast message={toastMessage} />{/if}
