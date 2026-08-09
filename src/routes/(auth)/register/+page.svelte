<script lang="ts">
	import { enhance } from '$app/forms';
	import PasswordField from '$lib/components/PasswordField.svelte';
	let { form } = $props();
	let workspaceName = $state(form?.values?.workspaceName ?? '');
	let displayName = $state(form?.values?.displayName ?? '');
	let email = $state(form?.values?.email ?? '');
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
		<h2>Créez votre espace</h2>
		<p class="sub">Un espace = une équipe. Vous en devenez l'admin.</p>

		{#if form?.error}<div class="flash error">{form.error}</div>{/if}

		<form method="POST" use:enhance>
			<div class="field">
				<label for="ws">Nom de l'espace</label>
				<input id="ws" name="workspaceName" bind:value={workspaceName} placeholder="Appli Mobile" required />
			</div>
			<div class="field">
				<label for="dn">Votre nom</label>
				<input id="dn" name="displayName" bind:value={displayName} placeholder="Fabien B." required />
			</div>
			<div class="field">
				<label for="em">Email professionnel</label>
				<input id="em" name="email" type="email" bind:value={email} placeholder="vous@entreprise.com" required />
			</div>
			<PasswordField
				id="pw"
				name="password"
				label="Mot de passe"
				placeholder="8 caractères minimum"
				autocomplete="new-password"
				required
			/>
			<button class="btn btn-primary" type="submit">Créer mon espace</button>
		</form>

		<div class="auth-foot">Déjà un espace ? <a href="/login">Se connecter</a></div>
	</div>
</div>
