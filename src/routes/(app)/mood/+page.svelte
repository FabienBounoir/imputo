<script lang="ts">
	import { enhance } from '$app/forms';
	import { scale } from 'svelte/transition';
	import type { SubmitFunction } from '@sveltejs/kit';

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

	// use:enhance reset le <form> natif par défaut après un succès : le texte de la textarea
	// disparaît visuellement (le DOM est reset) sans que `message` (le state Svelte) le soit,
	// et sans repasser en mode flouté. On désactive ce reset et on flout nous-mêmes, comme au
	// chargement d'une page où on a déjà voté.
	const handleVote: SubmitFunction = () => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type === 'success') revealed = false;
	};

	const REACTIONS: Record<number, string> = {
		1: 'On est là si besoin 💙',
		2: 'Ça va s’arranger, courage',
		3: 'Journée dans la moyenne',
		4: 'Content de le lire !',
		5: 'Trop bien, merci du partage !'
	};
	const selectedEmoji = $derived(EMOJIS.find((e) => e.score === score));
	const participationPct = $derived(
		data.participation.total > 0 ? Math.round((data.participation.voted / data.participation.total) * 100) : 0
	);

	const fmt = (iso: string) =>
		new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(
			new Date(iso + 'T00:00:00Z')
		);
</script>

<div class="topbar">
	<h1>Team mood<small>Du {fmt(data.periodStart)} au {fmt(data.periodEnd)}</small></h1>
</div>

<div class="content mood-layout">
	<section class="card block mood-block">
		<h3>Comment vous sentez-vous ?</h3>
		<p class="hint">
			Votre vote est <b>anonyme</b>, y compris pour les admins : seuls les résultats agrégés de la plage sont
			visibles. Vous pouvez modifier votre vote tant que la plage est active.
		</p>

		{#if form?.error}<div class="flash error">{form.error}</div>{/if}
		{#if form?.ok}<div class="flash ok">Vote enregistré ✓</div>{/if}

		<div class="reveal-wrap">
			<form method="POST" use:enhance={handleVote} class:blurred={!revealed} inert={!revealed}>
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

	<aside class="mood-side">
		<div class="card side-card reaction-card">
			{#key selectedEmoji?.score ?? 0}
				<span class="reaction-emoji" in:scale={{ duration: 220, start: 0.5 }}>{selectedEmoji?.emoji ?? '🤔'}</span>
			{/key}
			<p class="reaction-text">{selectedEmoji ? REACTIONS[selectedEmoji.score] : 'Choisissez une humeur…'}</p>
		</div>

		<div class="card side-card">
			<h4>Participation</h4>
			<div class="bar-track"><div class="bar-fill" style="width:{participationPct}%"></div></div>
			<p class="side-hint">{data.participation.voted} / {data.participation.total} ont déjà voté sur cette plage</p>
		</div>

		{#if data.streak > 0}
			<div class="card side-card streak-card">
				<span class="streak-flame">🔥</span>
				<div>
					<b>{data.streak}</b> plage{data.streak > 1 ? 's' : ''} d'affilée
					<span class="side-hint">Continuez comme ça !</span>
				</div>
			</div>
		{/if}
	</aside>
</div>

<style>
	.mood-layout {
		display: grid;
		grid-template-columns: minmax(0, 580px) minmax(220px, 260px);
		align-items: start;
		gap: 18px;
	}
	@media (max-width: 900px) {
		.mood-layout {
			grid-template-columns: 1fr;
		}
	}
	.mood-block {
		padding: 28px 30px;
		margin-bottom: 0;
		/* Filet de sécurité : quoi qu'il arrive, rien (halo de flou compris) ne peut déborder du
		   cadre arrondi de la card. */
		overflow: hidden;
	}

	.mood-side {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.side-card {
		padding: 18px 20px;
		text-align: center;
	}
	.side-card h4 {
		font-family: var(--font-display);
		font-size: 13.5px;
		font-weight: 600;
		margin-bottom: 12px;
		text-align: left;
	}
	.side-hint {
		display: block;
		font-size: 12px;
		color: var(--text-mute);
		margin-top: 6px;
	}
	.reaction-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
	}
	.reaction-emoji {
		display: block;
		font-size: 42px;
		line-height: 1;
	}
	.reaction-text {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-soft);
	}
	.bar-track {
		height: 8px;
		border-radius: 30px;
		background: var(--surface-sunk);
		overflow: hidden;
	}
	.bar-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 30px;
		transition: width 0.3s;
	}
	.side-card .side-hint {
		text-align: left;
	}
	.streak-card {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 12px;
		text-align: left;
	}
	.streak-flame {
		font-size: 28px;
	}
	.streak-card b {
		font-size: 15px;
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
