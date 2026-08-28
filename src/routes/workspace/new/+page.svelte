<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	let { form } = $props();
	$effect(() => {
		if (form?.error) toast.error(form.error);
	});
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
		<h2>Nouvel espace</h2>
		<p class="sub">Crée un espace de travail isolé dont tu seras administrateur.</p>

		<form method="POST" use:enhance>
			<div class="field">
				<label for="wn">Nom de l'espace</label>
				<input id="wn" name="workspaceName" placeholder="Ex. Application Mobile" required />
			</div>
			<button class="btn btn-primary" type="submit">Créer l'espace</button>
		</form>

		<div class="auth-foot"><a href="/imputation">← Retour à l'app</a></div>
	</div>
</div>
