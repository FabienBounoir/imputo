<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const EMOJIS = [
		{ score: 1, emoji: '😞', label: 'Pas content' },
		{ score: 2, emoji: '🙁', label: 'Plutôt mécontent' },
		{ score: 3, emoji: '😐', label: 'Neutre' },
		{ score: 4, emoji: '🙂', label: 'Plutôt content' },
		{ score: 5, emoji: '😄', label: 'Très content' }
	];

	// Confidentialité écran partagé : tant que ce n'est pas révélé, le formulaire reste vide (le flou
	// seul ne suffit pas à cacher un score/message déjà présents dans le DOM).
	let revealed = $state(!data.myVote);
	let score = $state(revealed ? (data.myVote?.score ?? 0) : 0);
	let message = $state(revealed ? (data.myVote?.message ?? '') : '');

	function reveal() {
		revealed = true;
		score = data.myVote?.score ?? 0;
		message = data.myVote?.message ?? '';
	}

	const fmt = (iso: string) =>
		new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(
			new Date(iso + 'T00:00:00Z')
		);
</script>

<div class="topbar">
	<h1>Team mood<small>Du {fmt(data.periodStart)} au {fmt(data.periodEnd)}</small></h1>
</div>

<div class="content">
	<section class="card block mood-block">
		<h3>Comment vous sentez-vous ?</h3>
		<p class="hint">
			Votre vote est <b>anonyme</b>, y compris pour les admins : seuls les résultats agrégés de la plage sont
			visibles. Vous pouvez modifier votre vote tant que la plage est active.
		</p>

		{#if form?.error}<div class="flash error">{form.error}</div>{/if}
		{#if form?.ok}<div class="flash ok">Vote enregistré ✓</div>{/if}

		<div class="reveal-wrap">
			<form method="POST" use:enhance class:blurred={!revealed} inert={!revealed}>
				<div class="emoji-row">
					{#each EMOJIS as e (e.score)}
						<button
							type="button"
							class="emoji-btn"
							class:sel={score === e.score}
							title={e.label}
							aria-label={e.label}
							onclick={() => (score = e.score)}
						>
							<span class="emoji">{e.emoji}</span>
						</button>
					{/each}
				</div>
				<input type="hidden" name="score" value={score} />

				<div class="field">
					<label for="message">Un détail à ajouter ? (optionnel)</label>
					<textarea id="message" name="message" rows="5" bind:value={message} placeholder="Ce qui va bien, ce qui pèse en ce moment…"></textarea>
				</div>

				<button class="btn btn-primary" type="submit" disabled={score < 1}>
					{data.myVote ? 'Modifier mon vote' : 'Voter'}
				</button>
			</form>

			{#if !revealed}
				<div class="reveal-overlay">
					<p>Vous avez déjà voté sur cette plage.</p>
					<button class="btn btn-ghost" type="button" onclick={reveal}>
						👁️ Afficher mon vote
					</button>
				</div>
			{/if}
		</div>
	</section>
</div>

<style>
	.mood-block {
		max-width: 580px;
		padding: 28px 30px;
		margin-bottom: 18px;
		/* Filet de sécurité : quoi qu'il arrive, rien (halo de flou compris) ne peut déborder du
		   cadre arrondi de la card. */
		overflow: hidden;
	}
	.mood-block h3 {
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
		margin-bottom: 6px;
	}
	.hint {
		color: var(--text-mute);
		font-size: 13px;
		line-height: 1.5;
		margin-bottom: 20px;
	}
	.flash {
		margin-bottom: 16px;
	}

	/* Padding dédié (sans marge négative — ça déclenchait un bug de rendu Chromium où le halo de
	   flou "fuyait" hors de la card) : le flou dispose de sa propre marge de respiration avant
	   d'atteindre le bord de la zone, plutôt que de couper des éléments en bordure (bouton…). */
	.reveal-wrap {
		position: relative;
		padding: 16px;
		border-radius: var(--r-md);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 18px;
		transition: filter 0.2s;
	}
	form.blurred {
		filter: blur(9px);
		user-select: none;
	}
	.reveal-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		text-align: center;
		background: color-mix(in srgb, var(--surface) 55%, transparent);
		border-radius: var(--r-md);
	}
	.reveal-overlay p {
		font-size: 13.5px;
		color: var(--text-soft);
		font-weight: 600;
	}

	.emoji-row {
		display: flex;
		gap: 10px;
	}
	.emoji-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 14px 0;
		border-radius: var(--r-md);
		border: 2px solid var(--border);
		background: var(--surface-sunk);
		cursor: pointer;
		transition: border-color 0.15s, transform 0.1s;
	}
	.emoji-btn:hover {
		transform: translateY(-1px);
	}
	.emoji-btn.sel {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}
	.emoji {
		font-size: 28px;
	}

	.field {
		margin: 0;
	}
	textarea {
		width: 100%;
		resize: vertical;
		font: inherit;
		font-size: 14px;
		padding: 11px 13px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		outline: none;
	}
	textarea:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
		background: var(--surface);
	}

	button[type='submit'] {
		align-self: flex-start;
	}
</style>
