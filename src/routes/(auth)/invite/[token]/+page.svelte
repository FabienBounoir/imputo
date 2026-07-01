<script lang="ts">
	import { enhance } from '$app/forms';
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
				<div class="field">
					<label for="pw">Mot de passe</label>
					<input id="pw" name="password" type="password" placeholder="8 caractères minimum" required />
				</div>
				<div class="field">
					<label for="cf">Confirmer</label>
					<input id="cf" name="confirm" type="password" required />
				</div>
				<button class="btn btn-primary" type="submit">Activer mon compte</button>
			</form>
		{/if}
	</div>
</div>
