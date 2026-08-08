<script lang="ts">
	let {
		id,
		name,
		label,
		placeholder = '',
		required = false,
		autocomplete
	}: {
		id: string;
		name: string;
		label: string;
		placeholder?: string;
		required?: boolean;
		autocomplete?: HTMLInputElement['autocomplete'];
	} = $props();

	let show = $state(false);
</script>

<div class="field">
	<label for={id}>{label}</label>
	<div class="pw-field">
		<input {id} {name} type={show ? 'text' : 'password'} {placeholder} {required} {autocomplete} />
		<button
			type="button"
			class="pw-toggle"
			onclick={() => (show = !show)}
			aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
		>
			{show ? '🙈' : '👁️'}
		</button>
	</div>
</div>
