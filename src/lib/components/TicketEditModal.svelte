<script lang="ts">
	import { formatDateTime } from '$lib/utils/date';
	import { TICKET_FIELD_LABELS } from '$lib/changeLogLabels';

	// Même modal d'édition que Tickets & chiffrage (tickets/+page.svelte), rendue utilisable depuis
	// n'importe quelle page (ex. Mon imputation) : elle se charge elle-même par id plutôt que de
	// dépendre d'une ligne déjà en mémoire, et sauvegarde via les actions de /tickets (adressables
	// par leur chemin absolu, cf. /api/tickets/[id]/activity-rae déjà partagé pareil entre les deux pages).
	let {
		ticketId,
		states,
		projects,
		sprints,
		versions,
		ticketGroups,
		testPhase,
		canEditEstimation,
		isAdmin,
		onClose,
		onSaved
	}: {
		ticketId: string | null;
		states: { id: string; label: string; emoji: string | null; color: string | null }[];
		projects: { id: string; name: string }[];
		sprints: { id: string; name: string }[];
		versions: { id: string; name: string }[];
		ticketGroups: { id: string; label: string }[];
		testPhase: boolean;
		canEditEstimation: boolean;
		isAdmin: boolean;
		onClose: () => void;
		/** Appelé après chaque sauvegarde — permet à l'appelant de patcher son propre affichage
		 * (ex. la ligne de Mon imputation) sans recharger toute la page. */
		onSaved?: (ticket: { id: string; title: string; sprintId: string | null; versionId: string | null }) => void;
	} = $props();

	type Ticket = {
		id: string;
		key: string;
		title: string;
		stateId: string | null;
		projectId: string | null;
		sprintId: string | null;
		versionId: string | null;
		prepa: number;
		comment: string | null;
		flags: Record<string, string>;
		estimationReal: number;
		raeReal: number;
		estimationTest: number;
		raeTest: number;
		consumed: number;
		sspCode: string | null;
		estimationPrev: number | null;
		enveloppeTotale: number | null;
		hasActivityEstimation: boolean;
		ecartVsBudget: number | null;
		groupIds: string[];
	};
	type HistoryEntry = {
		field: string | null;
		action: 'UPDATE' | 'DELETE';
		oldValue: string | null;
		newValue: string | null;
		changedByName: string | null;
		createdAt: string;
	};

	const FLAG_VALUES = ['Oui', 'Non', 'N/A', 'À MAJ', 'MAJ', 'OK'];
	const FLAG_FIELDS = [
		{ key: 'cypress', label: 'Cypress' },
		{ key: 'docTech', label: 'Doc technique' },
		{ key: 'prepaQualif', label: 'Prépa qualif' }
	] as const;

	let ticket = $state<Ticket | null>(null);
	let loading = $state(false);
	let historyEntries = $state<HistoryEntry[]>([]);
	let historyLoading = $state(false);
	let savedFlash = $state(false);
	let flashTimer: ReturnType<typeof setTimeout>;

	$effect(() => {
		const id = ticketId;
		if (!id) {
			ticket = null;
			historyEntries = [];
			return;
		}
		loading = true;
		fetch(`/api/tickets/${id}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((t) => (ticket = t))
			.finally(() => (loading = false));
		historyLoading = true;
		fetch(`/api/tickets/${id}/history`)
			.then((r) => (r.ok ? r.json() : { entries: [] }))
			.then((d) => (historyEntries = d.entries))
			.finally(() => (historyLoading = false));
	});

	const estTitle = $derived(canEditEstimation ? '' : 'Estimation réservée aux profils Manager et Admin.');
	const estRealTitle = $derived(
		ticket?.hasActivityEstimation
			? 'Estimé = compilation des Estimés par activité ci-dessous (non éditable ici)'
			: estTitle
	);

	const n = (v: number | string | null) => (v == null || v === '' ? 0 : Number(v) || 0);
	const round = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
	const totalEst = $derived(ticket ? round(n(ticket.estimationReal) + (testPhase ? n(ticket.estimationTest) : 0)) : 0);
	const totalRae = $derived(ticket ? round(n(ticket.raeReal) + (testPhase ? n(ticket.raeTest) : 0)) : 0);
	const ecartVsEstime = $derived(ticket ? round(n(ticket.raeReal) + ticket.consumed - n(ticket.estimationReal)) : 0);
	const avancement = $derived(totalEst > 0 ? Math.min(1, Math.max(0, (totalEst - totalRae) / totalEst)) : 0);
	const pct = (x: number) => Math.round(x * 100);

	const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
	function debouncedSave(key: string, fn: () => void, delay = 600) {
		clearTimeout(pendingSaves.get(key));
		pendingSaves.set(key, setTimeout(() => { pendingSaves.delete(key); fn(); }, delay));
	}

	async function save(field: string, value: string | number | null) {
		if (!ticket) return;
		const body = new FormData();
		body.set('ticketId', ticket.id);
		body.set('field', field);
		body.set('value', value == null ? '' : String(value));
		await fetch('/tickets?/update', { method: 'POST', body });
		flash();
	}
	// Saisie d'une estimation : pré-remplit le RAE correspondant s'il est encore vide (sinon un
	// ticket estimé mais sans RAE afficherait 100 % d'avancement) — même règle que la page tickets.
	async function saveEst(which: 'real' | 'test') {
		if (!ticket) return;
		if (which === 'real') {
			await save('estimationReal', ticket.estimationReal);
			if (!ticket.raeReal) {
				ticket.raeReal = ticket.estimationReal;
				await save('raeReal', ticket.raeReal);
			}
		} else {
			await save('estimationTest', ticket.estimationTest);
			if (!ticket.raeTest) {
				ticket.raeTest = ticket.estimationTest;
				await save('raeTest', ticket.raeTest);
			}
		}
	}
	async function saveFlag(key: string, value: string) {
		if (!ticket) return;
		const body = new FormData();
		body.set('ticketId', ticket.id);
		body.set('key', key);
		body.set('value', value ?? '');
		await fetch('/tickets?/flag', { method: 'POST', body });
		flash();
	}
	async function toggleGroup(groupId: string) {
		if (!ticket) return;
		const member = !ticket.groupIds.includes(groupId);
		ticket.groupIds = member ? [...ticket.groupIds, groupId] : ticket.groupIds.filter((g) => g !== groupId);
		const body = new FormData();
		body.set('ticketId', ticket.id);
		body.set('groupId', groupId);
		body.set('member', String(member));
		await fetch('/tickets?/groupToggle', { method: 'POST', body });
		flash();
	}
	function flash() {
		savedFlash = true;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (savedFlash = false), 1400);
		if (ticket) onSaved?.({ id: ticket.id, title: ticket.title, sprintId: ticket.sprintId, versionId: ticket.versionId });
	}
</script>

<svelte:window onkeydown={(e) => ticketId && e.key === 'Escape' && onClose()} />

{#if ticketId}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="tk-backdrop" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
		<div class="tk-modal">
			{#if savedFlash}<span class="tk-saved">Enregistré ✓</span>{/if}
			{#if !ticket}
				<p class="hint">{loading ? 'Chargement…' : 'Ticket introuvable.'}</p>
			{:else}
				<div class="tk-modal-head">
					<span class="tk-key tabnum">{ticket.key}</span>
					<button class="tk-x" onclick={onClose} aria-label="Fermer">✕</button>
				</div>
				<input class="tk-title" bind:value={ticket.title} onchange={() => save('title', ticket!.title)} aria-label="Titre" />
				<div class="tk-grid">
					<label class="dfield"><span>État</span>
						<select class="cell-select" bind:value={ticket.stateId} onchange={() => save('stateId', ticket!.stateId)}>
							<option value={null}>—</option>{#each states as s (s.id)}<option value={s.id}>{s.emoji} {s.label}</option>{/each}
						</select>
					</label>
					<label class="dfield"><span>Projet</span>
						<select class="cell-select" bind:value={ticket.projectId} onchange={() => save('projectId', ticket!.projectId)}>
							<option value={null}>—</option>{#each projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
						</select>
					</label>
					<label class="dfield"><span>Sprint</span>
						<select class="cell-select" bind:value={ticket.sprintId} onchange={() => save('sprintId', ticket!.sprintId)}>
							<option value={null}>—</option>{#each sprints as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
						</select>
					</label>
					<label class="dfield"><span>Version</span>
						<select class="cell-select" bind:value={ticket.versionId} onchange={() => save('versionId', ticket!.versionId)}>
							<option value={null}>—</option>{#each versions as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
						</select>
					</label>
					<label class="dfield"><span>Estimé</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={ticket.estimationReal} disabled={!canEditEstimation || ticket.hasActivityEstimation} title={estRealTitle} onchange={() => debouncedSave(`est-${ticket!.id}-real`, () => saveEst('real'))} /></label>
					<label class="dfield"><span>RAE Réal</span><input class="cell-input" type="number" step="0.25" min="0" value={ticket.raeReal} disabled title="Compilation des RAE par activité (voir le tableau)" /></label>
					{#if testPhase}
						<label class="dfield"><span>Est. Test</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={ticket.estimationTest} disabled={!canEditEstimation} title={estTitle} onchange={() => debouncedSave(`est-${ticket!.id}-test`, () => saveEst('test'))} /></label>
						<label class="dfield"><span>Prépa</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={ticket.prepa} disabled={!canEditEstimation} title={estTitle} onchange={() => debouncedSave(`f-${ticket!.id}-prepa`, () => save('prepa', ticket!.prepa))} /></label>
						<label class="dfield"><span>RAE Test</span><input class="cell-input" type="number" step="0.25" min="0" value={ticket.raeTest} disabled title="Compilation des RAE par activité (voir le tableau)" /></label>
						{#each FLAG_FIELDS as fl (fl.key)}
							<label class="dfield"><span>{fl.label}</span>
								<select class="cell-select" bind:value={ticket.flags[fl.key]} onchange={() => saveFlag(fl.key, ticket!.flags[fl.key])}>
									<option value="">—</option>{#each FLAG_VALUES as v (v)}<option value={v}>{v}</option>{/each}
								</select>
							</label>
						{/each}
					{/if}
					<label class="dfield"><span>Code SSP</span><input class="cell-input" placeholder="—" bind:value={ticket.sspCode} onchange={() => save('sspCode', ticket!.sspCode)} /></label>
					{#if isAdmin}
						<label class="dfield"><span>Estimation prévisionnel</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={ticket.estimationPrev} onchange={() => debouncedSave(`f-${ticket!.id}-estimationPrev`, () => save('estimationPrev', ticket!.estimationPrev))} /></label>
						<label class="dfield"><span>Enveloppe totale</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={ticket.enveloppeTotale} onchange={() => debouncedSave(`f-${ticket!.id}-enveloppeTotale`, () => save('enveloppeTotale', ticket!.enveloppeTotale))} /></label>
					{/if}
					<label class="dfield wide"><span>Commentaire</span><input class="cell-input" placeholder="Note libre…" bind:value={ticket.comment} onchange={() => save('comment', ticket!.comment)} /></label>
					{#if ticketGroups.length > 0}
						<div class="dfield wide">
							<span>Groupes</span>
							<div class="group-chips">
								{#each ticketGroups as g (g.id)}
									<button
										type="button"
										class="group-chip"
										class:on={ticket.groupIds.includes(g.id)}
										onclick={() => toggleGroup(g.id)}
									>{g.label}</button>
								{/each}
							</div>
						</div>
					{/if}
				</div>
				<div class="tk-foot">
					<span>Consommé <b class="tabnum">{ticket.consumed || '—'}</b></span>
					<span>Écart vs estimé <b class="tabnum" class:gap-pos={ecartVsEstime > 0}>{ecartVsEstime > 0 ? '+' : ''}{ecartVsEstime || 0}</b></span>
					{#if ticket.ecartVsBudget !== null}
						<span>Écart vs budget <b class="tabnum" class:gap-pos={ticket.ecartVsBudget > 0}>{ticket.ecartVsBudget > 0 ? '+' : ''}{ticket.ecartVsBudget || 0}</b></span>
					{/if}
					<span>Avancement <b class="tabnum">{pct(avancement)}%</b></span>
				</div>
				<div class="tk-history">
					<h4>Historique</h4>
					{#if historyLoading}
						<p class="hint">Chargement…</p>
					{:else if historyEntries.length === 0}
						<p class="hint">Aucune modification tracée pour l'instant.</p>
					{:else}
						<ul>
							{#each historyEntries as h, i (i)}
								<li>
									<span class="hf">{TICKET_FIELD_LABELS[h.field ?? ''] ?? h.field}</span>
									<span class="hv">{h.oldValue ?? '—'} → {h.newValue ?? '—'}</span>
									<span class="hm hint">{h.changedByName ?? 'Quelqu’un'} · {formatDateTime(new Date(h.createdAt))}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.tk-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		z-index: 50;
	}
	.tk-modal {
		position: relative;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
		padding: 22px 24px;
		width: 100%;
		max-width: 600px;
		max-height: 86vh;
		overflow-y: auto;
	}
	.tk-saved {
		position: absolute;
		top: 18px;
		right: 52px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--accent);
		background: var(--accent-tint-2);
		padding: 4px 10px;
		border-radius: 30px;
	}
	.hint {
		color: var(--text-mute);
		font-size: 13px;
	}
	.tk-modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.tk-key {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-mute);
	}
	.tk-x {
		font-size: 15px;
		color: var(--text-mute);
		width: 28px;
		height: 28px;
		border-radius: 8px;
	}
	.tk-x:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.tk-title {
		width: 100%;
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
		color: var(--text);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 8px;
		padding: 6px 8px;
		margin: 2px 0 16px;
	}
	.tk-title:hover,
	.tk-title:focus {
		border-color: var(--border-strong);
		background: var(--surface-2);
		outline: none;
	}
	.tk-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}
	.tk-grid .dfield.wide {
		grid-column: 1 / -1;
	}
	.dfield {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.dfield > span {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-mute);
	}
	.dfield .cell-input,
	.dfield .cell-select {
		border-color: var(--border);
		background: var(--surface);
	}
	.cell-input,
	.cell-select {
		width: 100%;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 7px;
		padding: 6px 7px;
		font: inherit;
		font-size: 13.5px;
		color: var(--text);
		transition: border-color 0.15s, background 0.15s;
	}
	.cell-input:hover:not(:disabled),
	.cell-select:hover:not(:disabled) {
		border-color: var(--border-strong);
		background: var(--surface);
	}
	.cell-input:disabled,
	.cell-select:disabled {
		cursor: not-allowed;
	}
	.cell-input:focus,
	.cell-select:focus {
		border-color: var(--accent);
		background: var(--surface);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
		outline: none;
	}
	.group-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.group-chip {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-soft);
		border: 1px solid var(--border);
		border-radius: 20px;
		padding: 4px 12px;
		background: var(--surface);
		transition: border-color 0.15s, color 0.15s, background 0.15s;
	}
	.group-chip:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.group-chip.on {
		background: var(--accent-tint);
		border-color: var(--accent);
		color: var(--accent-ink);
	}
	.tk-foot {
		display: flex;
		gap: 22px;
		margin-top: 18px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
		font-size: 13px;
		color: var(--text-mute);
	}
	.tk-foot b {
		color: var(--text-soft);
		margin-left: 4px;
	}
	.gap-pos {
		color: var(--warn) !important;
		font-weight: 700;
	}
	.tk-history {
		margin-top: 14px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
	}
	.tk-history h4 {
		margin: 0 0 8px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-soft);
	}
	.tk-history ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 160px;
		overflow-y: auto;
	}
	.tk-history li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 8px;
		font-size: 12.5px;
	}
	.tk-history .hf {
		font-weight: 600;
		color: var(--text-soft);
	}
	.tk-history .hv {
		color: var(--text);
	}
	.tk-history .hm {
		margin-left: auto;
		white-space: nowrap;
	}
	@media (max-width: 560px) {
		.tk-grid {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
