<script lang="ts">
	// Erreur liée à une action dans une modal (ex. suppression bloquée) : overlay fixe au-dessus de
	// tout (backdrop compris), jamais dans le flux — évite de décaler le contenu de la modal comme
	// le ferait un `.flash` classique.
	let { message }: { message: string } = $props();
</script>

<div class="modal-error-toast" role="alert">{message}</div>

<style>
	.modal-error-toast {
		position: fixed;
		top: 24px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 60;
		max-width: min(440px, calc(100vw - 48px));
		background: var(--warn-tint);
		color: var(--warn);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
		border-radius: 10px;
		padding: 10px 18px;
		font-size: 13px;
		font-weight: 600;
		text-align: center;
		box-shadow: var(--shadow-lg, 0 12px 30px rgba(0, 0, 0, 0.3));
	}
</style>
