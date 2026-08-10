<script lang="ts">
	import { enhance } from '$app/forms';

	// Capacités de lecture accordables à un membre indépendamment de son rôle (cf. schema.ts
	// membership.canView*) : chacune ouvre une visibilité précise, jamais de droit d'écriture.
	let {
		member,
		onclose
	}: {
		member: { id: string; displayName: string; canViewImputations: boolean; canViewMoodResults: boolean };
		onclose: () => void;
	} = $props();

	const FLAGS = [
		{
			field: 'canViewImputations' as const,
			label: "Imputations de l'équipe",
			detail:
				"Ajoute un sélecteur « Voir l'imputation de » dans Mon imputation, pour consulter la feuille de temps de n'importe quel membre de l'espace. Toujours en lecture seule : impossible de modifier une case, d'ajouter/supprimer une ligne, ou d'exporter en Excel (réservé aux admins)."
		},
		{
			field: 'canViewMoodResults' as const,
			label: 'Résultats Team mood',
			detail:
				'Donne accès à la page des résultats Team mood : tendance, répartition des votes et commentaires anonymes, semaine par semaine. Ne permet pas de réinitialiser une période (réservé aux admins).'
		}
	];
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onclose}>
	<div class="modal" onclick={(e) => e.stopPropagation()}>
		<h3>Accès en lecture — {member.displayName}</h3>
		<p class="hint">
			Ces capacités s'ajoutent au rôle sans le changer : elles ouvrent uniquement de la <b>visibilité</b>, jamais de
			droit d'écriture.
		</p>

		<div class="flags">
			{#each FLAGS as f (f.field)}
				{@const checked = f.field === 'canViewImputations' ? member.canViewImputations : member.canViewMoodResults}
				<form method="POST" action="?/memberCapability" use:enhance class="flag-row">
					<input type="hidden" name="userId" value={member.id} />
					<input type="hidden" name="field" value={f.field} />
					<input type="hidden" name="value" value={String(!checked)} />
					<label class="flag-toggle">
						<input type="checkbox" {checked} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
						<span class="flag-text">
							<b>{f.label}</b>
							<span class="flag-detail">{f.detail}</span>
						</span>
					</label>
				</form>
			{/each}
		</div>

		<div class="modal-actions">
			<button class="btn btn-ghost" onclick={onclose}>Fermer</button>
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		z-index: 50;
	}
	.modal {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
		padding: 24px;
		width: 100%;
		max-width: 460px;
	}
	.modal h3 {
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
		margin-bottom: 4px;
	}
	.hint {
		color: var(--text-mute);
		font-size: 13px;
	}
	.flags {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 18px 0 4px;
	}
	.flag-row {
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		padding: 12px 14px;
	}
	.flag-toggle {
		display: flex;
		align-items: flex-start;
		gap: 11px;
		cursor: pointer;
	}
	.flag-toggle input[type='checkbox'] {
		margin-top: 3px;
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
		flex-shrink: 0;
	}
	.flag-text {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.flag-text b {
		font-size: 13.5px;
	}
	.flag-detail {
		font-size: 12px;
		color: var(--text-mute);
		line-height: 1.45;
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 20px;
	}
</style>
