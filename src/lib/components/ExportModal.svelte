<script lang="ts">
	// Export Excel : bouton + modale (préréglages de période + choix des feuilles).
	// Partagé entre la page admin et la page imputation. L'endpoint /export est global
	// (scopé au workspace), pas de rôle requis.
	let { label = "Télécharger l'Excel", buttonClass = 'btn btn-primary' }: {
		label?: string;
		buttonClass?: string;
	} = $props();

	// Date locale en YYYY-MM-DD (PAS toISOString : convertit en UTC et décale d'un jour
	// aux fuseaux à l'est de Greenwich — ex. minuit à Paris = la veille en UTC).
	const iso = (d: Date) =>
		`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	const SHEETS = [
		{ key: 'synthese', label: 'Synthèse (page de garde)' },
		{ key: 'us', label: 'Synthèse US' },
		{ key: 'projsprint', label: 'Par projet & sprint' },
		{ key: 'activite', label: 'Par activité' },
		{ key: 'imputation', label: 'Imputation détaillée' },
		{ key: 'personne', label: 'Par personne' },
		{ key: 'absences', label: 'Hors-projet & absences' }
	];
	let show = $state(false);
	let exFrom = $state('');
	let exTo = $state('');
	let exPreset = $state('month');
	let exSheets = $state(new Set(SHEETS.map((s) => s.key)));

	function applyPreset(p: string) {
		exPreset = p;
		const now = new Date();
		if (p === 'week') {
			const m = new Date(now);
			m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
			exFrom = iso(m);
			exTo = iso(now);
		} else if (p === 'month') {
			exFrom = iso(new Date(now.getFullYear(), now.getMonth(), 1));
			exTo = iso(now);
		} else if (p === 'lastmonth') {
			exFrom = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
			exTo = iso(new Date(now.getFullYear(), now.getMonth(), 0));
		}
	}
	function openExport() {
		if (!exFrom || !exTo) applyPreset('month');
		show = true;
	}
	function toggleSheet(key: string) {
		if (exSheets.has(key)) exSheets.delete(key);
		else exSheets.add(key);
		exSheets = new Set(exSheets);
	}
	function downloadExport() {
		const params = new URLSearchParams({ from: exFrom, to: exTo });
		if (exSheets.size < SHEETS.length) params.set('sheets', [...exSheets].join(','));
		window.location.href = `/export?${params.toString()}`;
		show = false;
	}
</script>

<button class={buttonClass} onclick={openExport}>
	<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="3" width="12" height="8" rx="1.5"/><path d="M12 17v-6M9 14l3 3 3-3"/><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/></svg>
	{label}
</button>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (show = false)} />

{#if show}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={() => (show = false)}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h3>Exporter en Excel</h3>
			<p class="hint">Le <b>consommé</b> est borné sur la période ; le chiffrage reste l'état courant.</p>

			<div class="seg">
				<button type="button" class:on={exPreset === 'week'} onclick={() => applyPreset('week')}>Semaine en cours</button>
				<button type="button" class:on={exPreset === 'month'} onclick={() => applyPreset('month')}>Mois en cours</button>
				<button type="button" class:on={exPreset === 'lastmonth'} onclick={() => applyPreset('lastmonth')}>Mois dernier</button>
				<button type="button" class:on={exPreset === 'custom'} onclick={() => (exPreset = 'custom')}>Personnalisé</button>
			</div>

			<div class="ex-dates">
				<label class="ex-field">Du<input type="date" bind:value={exFrom} max={exTo} onchange={() => (exPreset = 'custom')} /></label>
				<label class="ex-field">Au<input type="date" bind:value={exTo} min={exFrom} onchange={() => (exPreset = 'custom')} /></label>
			</div>

			<div class="sheets">
				<div class="sheets-h">
					Feuilles à inclure
					<button type="button" class="link-btn" onclick={() => (exSheets = new Set(exSheets.size === SHEETS.length ? [] : SHEETS.map((s) => s.key)))}>
						{exSheets.size === SHEETS.length ? 'Tout décocher' : 'Tout cocher'}
					</button>
				</div>
				{#each SHEETS as s (s.key)}
					<label class="sheet-row"><input type="checkbox" checked={exSheets.has(s.key)} onchange={() => toggleSheet(s.key)} /> {s.label}</label>
				{/each}
			</div>

			<div class="modal-actions">
				<button class="btn btn-ghost" onclick={() => (show = false)}>Annuler</button>
				<button class="btn btn-primary" disabled={exSheets.size === 0 || !exFrom || !exTo} onclick={downloadExport}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="3" width="12" height="8" rx="1.5"/><path d="M12 17v-6M9 14l3 3 3-3"/><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/></svg>
					Télécharger
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.ex-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.ex-field input {
		padding: 7px 9px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13px;
	}
	.ex-field input:focus {
		outline: none;
		border-color: var(--accent);
	}
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
		max-width: 440px;
	}
	.modal h3 {
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
		margin-bottom: 4px;
	}
	.seg {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin: 16px 0 14px;
	}
	.seg button {
		padding: 9px 10px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-soft);
		font-size: 13px;
		font-weight: 500;
		transition: border-color 0.15s, background 0.15s, color 0.15s;
	}
	.seg button:hover {
		border-color: var(--border-strong);
	}
	.seg button.on {
		border-color: var(--accent);
		background: var(--accent-tint);
		color: var(--accent-ink);
		font-weight: 600;
	}
	.ex-dates {
		display: flex;
		gap: 12px;
		margin-bottom: 16px;
	}
	.ex-dates .ex-field {
		flex: 1;
	}
	.sheets {
		border-top: 1px solid var(--border);
		padding-top: 14px;
	}
	.sheets-h {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-mute);
		margin-bottom: 10px;
	}
	.link-btn {
		font-size: 12px;
		font-weight: 600;
		color: var(--accent);
		text-transform: none;
		letter-spacing: 0;
	}
	.sheet-row {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 5px 0;
		font-size: 13.5px;
		color: var(--text-soft);
		cursor: pointer;
	}
	.sheet-row input {
		width: 15px;
		height: 15px;
		accent-color: var(--accent);
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 20px;
	}
</style>
