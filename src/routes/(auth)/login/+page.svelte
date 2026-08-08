<script lang="ts">
	import { enhance } from '$app/forms';
	import PasswordField from '$lib/components/PasswordField.svelte';
	let { form } = $props();
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

		{#if form?.error}<div class="flash error">{form.error}</div>{/if}

		<form method="POST" use:enhance>
			<div class="field">
				<label for="em">Email</label>
				<input id="em" name="email" type="email" value={form?.values?.email ?? ''} placeholder="vous@entreprise.com" required />
			</div>
			<PasswordField id="pw" name="password" label="Mot de passe" autocomplete="current-password" required />
			<button class="btn btn-primary" type="submit">Se connecter</button>
		</form>

		<div class="auth-foot">Pas encore d'espace ? <a href="/register">Créer un espace</a></div>
	</div>
</div>
