<script lang="ts">
	import { enhance } from '$app/forms';
	import PasswordField from '$lib/components/PasswordField.svelte';
	let { data, form } = $props();
</script>

<div class="auth-wrap">
	<div class="auth-card">
		<div class="mark">i</div>
		{#if data.invalid}
			<h2>Lien invalide</h2>
			<p class="sub">Ce lien d'invitation est expiré ou a déjà été utilisé. Demandez à votre admin d'en générer un nouveau.</p>
			<a class="btn btn-ghost" href="/login">Aller à la connexion</a>
		{:else}
			<h2>Bienvenue 🎉</h2>
			<p class="sub">Définissez votre mot de passe pour activer le compte <b>{data.email}</b>.</p>

			{#if form?.error}<div class="flash error">{form.error}</div>{/if}

			<form method="POST" use:enhance>
				<PasswordField
					id="pw"
					name="password"
					label="Mot de passe"
					placeholder="8 caractères minimum"
					autocomplete="new-password"
					required
				/>
				<PasswordField id="cf" name="confirm" label="Confirmer" autocomplete="new-password" required />
				<button class="btn btn-primary" type="submit">Activer mon compte</button>
			</form>
		{/if}
	</div>
</div>
