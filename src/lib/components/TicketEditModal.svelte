<script lang="ts">
	import { enhance, deserialize } from '$app/forms';
	import { formatDateTime } from '$lib/utils/date';
	import { TICKET_FIELD_LABELS } from '$lib/changeLogLabels';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { toast } from 'svelte-sonner';
	import SspPicker from './SspPicker.svelte';

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
		ssps,
		ticketGroups,
		members,
		testPhase,
		isAdmin,
		isOwner,
		onClose,
		onSaved,
		onDeleted
	}: {
		ticketId: string | null;
		states: { id: string; label: string; emoji: string | null; color: string | null }[];
		projects: { id: string; name: string }[];
		sprints: { id: string; name: string }[];
		versions: { id: string; name: string }[];
		ssps: { id: string; code: string; label: string }[];
		ticketGroups: { id: string; label: string }[];
		/** Pour "Assigné à" — mêmes membres que le filtre `!m.factice` de Tickets & chiffrage. */
		members: { id: string; displayName: string; factice: boolean }[];
		testPhase: boolean;
		isAdmin: boolean;
		/** Créateur de l'espace (super admin) ou ADMIN — seuls profils autorisés à éditer la clé / supprimer un ticket. */
		isOwner: boolean;
		onClose: () => void;
		/** Appelé après chaque sauvegarde — permet à l'appelant de patcher son propre affichage
		 * (ex. la ligne de Mon imputation) sans recharger toute la page. */
		onSaved?: (ticket: { id: string; title: string; sprintId: string | null; versionId: string | null }) => void;
		/** Appelé après une suppression réussie — permet à l'appelant de retirer le ticket de son affichage. */
		onDeleted?: (ticketId: string) => void;
	} = $props();

	type Ticket = {
		id: string;
		key: string;
		title: string;
		/** L'appelant pilote-t-il le périmètre de CE ticket ? Vient de l'API, cf. TicketRow.canLead. */
		canLead: boolean;
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
		sspId: string | null;
		estimationPrev: number | null;
		enveloppeTotale: number | null;
		hasActivityEstimation: boolean;
		ecartVsBudget: number | null;
		groupIds: string[];
		imputationCount: number;
		priority: number;
		assigneeId: string | null;
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

	// Le droit se lit sur le ticket ouvert, pas sur un drapeau de page : la modale est ouverte depuis
	// Mon imputation et les dashboards, qui n'ont aucun moyen de savoir quel périmètre sera affiché.
	const canEditEstimation = $derived(ticket?.canLead ?? false);
	const estTitle = $derived(canEditEstimation ? '' : 'Chiffrage réservé au CP de ce périmètre (ou au DP).');
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
	// Sans estimation : 100 % si du temps est consommé et qu'il ne reste rien à faire (RAE nul),
	// plutôt que 0 % qui laissait croire à un ticket non démarré — même règle que calc.ts:avancement.
	const avancement = $derived(
		totalEst > 0
			? Math.min(1, Math.max(0, (totalEst - totalRae) / totalEst))
			: totalRae <= 0 && (ticket?.consumed ?? 0) > 0
				? 1
				: 0
	);
	const pct = (x: number) => Math.round(x * 100);

	const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
	function debouncedSave(key: string, fn: () => void, delay = 600) {
		clearTimeout(pendingSaves.get(key));
		pendingSaves.set(key, setTimeout(() => { pendingSaves.delete(key); fn(); }, delay));
	}

	// Même slider maison que Tickets & chiffrage (tickets/+page.svelte) — voir les commentaires
	// là-bas pour le détail (piste inversée 0/Urgent à droite, pointer capture, etc.). Adapté ici
	// pour opérer sur `ticket` directement (pas de tableau de lignes dans cette modale).
	function setPriority(value: number) {
		if (!ticket) return;
		const v = Math.max(0, Math.min(4, Math.round(value)));
		if (v === ticket.priority) return;
		ticket.priority = v;
		const snapshot = { id: ticket.id, title: ticket.title, sprintId: ticket.sprintId, versionId: ticket.versionId };
		debouncedSave(`priority-${ticket.id}`, () => save('priority', v, snapshot));
	}
	function priorityValueAt(e: PointerEvent, el: HTMLElement) {
		const rect = el.getBoundingClientRect();
		const ratio = (e.clientX - rect.left) / rect.width;
		return 4 - Math.min(1, Math.max(0, ratio)) * 4;
	}
	function priorityPos(v: number): number {
		return (4 - v) * 25;
	}
	function onPriorityPointerDown(e: PointerEvent) {
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		setPriority(priorityValueAt(e, el));
	}
	function onPriorityPointerMove(e: PointerEvent) {
		if (e.buttons !== 1) return;
		setPriority(priorityValueAt(e, e.currentTarget as HTMLElement));
	}
	function onPriorityKey(e: KeyboardEvent) {
		if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
			e.preventDefault();
			setPriority(ticket!.priority - 1);
		} else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
			e.preventDefault();
			setPriority(ticket!.priority + 1);
		}
	}

	// `snapshotArg` : pour un appel différé (debouncedSave, 600ms), `ticket` peut être redevenu null
	// entre-temps si la modale a été fermée (effet ticketId ci-dessus) — sans un id capturé au moment
	// du changement, la sauvegarde serait silencieusement perdue (le early-return ci-dessous) et
	// onSaved ne serait jamais notifié, laissant la vue appelante (dashboard, Mon imputation) affichant
	// l'ancienne valeur malgré un clic déjà validé par l'utilisateur.
	async function save(field: string, value: string | number | null, snapshotArg?: { id: string; title: string; sprintId: string | null; versionId: string | null }) {
		const snapshot = snapshotArg ?? (ticket ? { id: ticket.id, title: ticket.title, sprintId: ticket.sprintId, versionId: ticket.versionId } : null);
		if (!snapshot) return;
		const body = new FormData();
		body.set('ticketId', snapshot.id);
		body.set('field', field);
		body.set('value', value == null ? '' : String(value));
		const res = await fetch('/tickets?/update', { method: 'POST', body });
		const result = deserialize(await res.text());
		if (result.type === 'failure') {
			toast.error((result.data?.error as string) ?? 'Erreur lors de l’enregistrement.');
		} else {
			flash(snapshot);
		}
	}
	// Saisie d'une estimation : pré-remplit le RAE correspondant s'il est encore vide (sinon un
	// ticket estimé mais sans RAE afficherait 100 % d'avancement) — même règle que la page tickets.
	// `value`/`snapshot` capturés par l'appelant (onchange, avant le debounce) : à l'exécution différée
	// `ticket` peut déjà être redevenu null si la modale a été fermée entre-temps, cf. save() ci-dessus.
	async function saveEst(which: 'real' | 'test', value: number, snapshot: { id: string; title: string; sprintId: string | null; versionId: string | null }) {
		const live = ticket?.id === snapshot.id ? ticket : null;
		if (which === 'real') {
			await save('estimationReal', value, snapshot);
			if (live && !live.raeReal) {
				live.raeReal = value;
				await save('raeReal', value, snapshot);
			}
		} else {
			await save('estimationTest', value, snapshot);
			if (live && !live.raeTest) {
				live.raeTest = value;
				await save('raeTest', value, snapshot);
			}
		}
	}
	async function saveFlag(key: string, value: string) {
		if (!ticket) return;
		const snapshot = { id: ticket.id, title: ticket.title, sprintId: ticket.sprintId, versionId: ticket.versionId };
		const body = new FormData();
		body.set('ticketId', ticket.id);
		body.set('key', key);
		body.set('value', value ?? '');
		await fetch('/tickets?/flag', { method: 'POST', body });
		flash(snapshot);
	}
	async function toggleGroup(groupId: string) {
		if (!ticket) return;
		const snapshot = { id: ticket.id, title: ticket.title, sprintId: ticket.sprintId, versionId: ticket.versionId };
		const member = !ticket.groupIds.includes(groupId);
		ticket.groupIds = member ? [...ticket.groupIds, groupId] : ticket.groupIds.filter((g) => g !== groupId);
		const body = new FormData();
		body.set('ticketId', ticket.id);
		body.set('groupId', groupId);
		body.set('member', String(member));
		await fetch('/tickets?/groupToggle', { method: 'POST', body });
		flash(snapshot);
	}
	function flash(snapshot?: { id: string; title: string; sprintId: string | null; versionId: string | null }) {
		toast.success('Enregistré ✓');
		const t = snapshot ?? ticket;
		if (t) onSaved?.(t);
	}

	// Bloque si des imputations sont liées (pas de popup dans ce cas — juste le message), sinon
	// demande confirmation avant d'envoyer la requête de suppression (cf. deleteTicket côté serveur,
	// revérifié là-bas quoi qu'il arrive).
	async function confirmDelete({ cancel }: { cancel: () => void }) {
		if (!ticket) return cancel();
		if (ticket.imputationCount > 0) {
			toast.error('Des imputations sont liées à ce ticket : suppression impossible.');
			return cancel();
		}
		const ok = await confirmDialog({
			title: 'Supprimer le ticket',
			message: `Supprimer définitivement ${ticket.key} — « ${ticket.title} » ? Cette action est irréversible.`,
			confirmLabel: 'Supprimer'
		});
		if (!ok) return cancel();
		const id = ticket.id;
		return async ({ result }: { result: { type: string; data?: Record<string, unknown> } }) => {
			if (result.type === 'failure') {
				toast.error((result.data?.error as string) ?? 'Erreur lors de la suppression.');
			} else {
				onDeleted?.(id);
				onClose();
			}
		};
	}
</script>

<svelte:window onkeydown={(e) => ticketId && e.key === 'Escape' && onClose()} />

{#if ticketId}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="tk-backdrop" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
		<div class="tk-modal">
			{#if !ticket}
				<p class="hint">{loading ? 'Chargement…' : 'Ticket introuvable.'}</p>
			{:else}
				<div class="tk-modal-head">
					{#if isOwner}
						<input class="tk-key-input tabnum" bind:value={ticket.key} onchange={() => save('key', ticket!.key)} aria-label="Clé du ticket" />
					{:else}
						<span class="tk-key tabnum">{ticket.key}</span>
					{/if}
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
					<label class="dfield"><span>Assigné à</span>
						<select class="cell-select" bind:value={ticket.assigneeId} onchange={() => save('assigneeId', ticket!.assigneeId)}>
							<option value={null}>—</option>{#each members.filter((m) => !m.factice) as m (m.id)}<option value={m.id}>{m.displayName}</option>{/each}
						</select>
					</label>
					<div class="dfield"><span>Priorité</span>
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<div
							class="priority-slider"
							role="slider"
							tabindex="0"
							aria-label="Priorité, de 4 (Backlog, le moins urgent) à 0 (Urgent, le plus urgent)"
							aria-valuemin="0"
							aria-valuemax="4"
							aria-valuenow={ticket.priority}
							onpointerdown={onPriorityPointerDown}
							onpointermove={onPriorityPointerMove}
							onkeydown={onPriorityKey}
						>
							<div class="priority-track">
								<div class="priority-scale"></div>
								<div class="priority-mask" style="width:{100 - priorityPos(ticket.priority)}%"></div>
								{#each [0, 1, 2, 3, 4] as n (n)}
									<span class="priority-tick" style="left:{priorityPos(n)}%"></span>
								{/each}
							</div>
							<div class="priority-thumb tabnum" style="left:{priorityPos(ticket.priority)}%; --pcolor:var(--priority-{ticket.priority})">{ticket.priority}</div>
						</div>
						<div class="priority-ends">
							<span>← Backlog</span>
							<span>Urgent →</span>
						</div>
					</div>
					<label class="dfield"><span>Estimé</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={ticket.estimationReal} disabled={!canEditEstimation || ticket.hasActivityEstimation} title={estRealTitle} onchange={() => { const v = ticket!.estimationReal; const snapshot = { id: ticket!.id, title: ticket!.title, sprintId: ticket!.sprintId, versionId: ticket!.versionId }; debouncedSave(`est-${ticket!.id}-real`, () => saveEst('real', v, snapshot)); }} /></label>
					<label class="dfield"><span>RAE Réal</span><input class="cell-input" type="number" step="0.25" min="0" value={ticket.raeReal} disabled title="Compilation des RAE par activité (voir le tableau)" /></label>
					{#if testPhase}
						<label class="dfield"><span>Est. Test</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={ticket.estimationTest} disabled={!canEditEstimation} title={estTitle} onchange={() => { const v = ticket!.estimationTest; const snapshot = { id: ticket!.id, title: ticket!.title, sprintId: ticket!.sprintId, versionId: ticket!.versionId }; debouncedSave(`est-${ticket!.id}-test`, () => saveEst('test', v, snapshot)); }} /></label>
						<label class="dfield"><span>Prépa</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={ticket.prepa} disabled={!canEditEstimation} title={estTitle} onchange={() => { const v = ticket!.prepa; const snapshot = { id: ticket!.id, title: ticket!.title, sprintId: ticket!.sprintId, versionId: ticket!.versionId }; debouncedSave(`f-${ticket!.id}-prepa`, () => save('prepa', v, snapshot)); }} /></label>
						<label class="dfield"><span>RAE Test</span><input class="cell-input" type="number" step="0.25" min="0" value={ticket.raeTest} disabled title="Compilation des RAE par activité (voir le tableau)" /></label>
						{#each FLAG_FIELDS as fl (fl.key)}
							<label class="dfield"><span>{fl.label}</span>
								<select class="cell-select" bind:value={ticket.flags[fl.key]} onchange={() => saveFlag(fl.key, ticket!.flags[fl.key])}>
									<option value="">—</option>{#each FLAG_VALUES as v (v)}<option value={v}>{v}</option>{/each}
								</select>
							</label>
						{/each}
					{/if}
					<div class="dfield"><span>Code SSP</span><SspPicker {ssps} bind:value={() => ticket!.sspId ?? '', (v) => (ticket!.sspId = v || null)} onpick={(v) => save('sspId', v || null)} /></div>
					{#if isAdmin}
						<label class="dfield"><span>Estimation prévisionnel</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={ticket.estimationPrev} disabled={!canEditEstimation} title={estTitle} onchange={() => { const v = ticket!.estimationPrev; const snapshot = { id: ticket!.id, title: ticket!.title, sprintId: ticket!.sprintId, versionId: ticket!.versionId }; debouncedSave(`f-${ticket!.id}-estimationPrev`, () => save('estimationPrev', v, snapshot)); }} /></label>
						<label class="dfield"><span>Enveloppe totale</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={ticket.enveloppeTotale} disabled={!canEditEstimation} title={estTitle} onchange={() => { const v = ticket!.enveloppeTotale; const snapshot = { id: ticket!.id, title: ticket!.title, sprintId: ticket!.sprintId, versionId: ticket!.versionId }; debouncedSave(`f-${ticket!.id}-enveloppeTotale`, () => save('enveloppeTotale', v, snapshot)); }} /></label>
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
					<span>Écart vs estimé <b class="tabnum" class:gap-pos={ecartVsEstime > 0} class:gap-neg={ecartVsEstime < 0}>{ecartVsEstime > 0 ? '+' : ''}{ecartVsEstime || 0}</b></span>
					{#if ticket.ecartVsBudget !== null}
						<span>Écart vs budget <b class="tabnum" class:gap-pos={ticket.ecartVsBudget > 0} class:gap-neg={ticket.ecartVsBudget < 0}>{ticket.ecartVsBudget > 0 ? '+' : ''}{ticket.ecartVsBudget || 0}</b></span>
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
				{#if isOwner}
					<div class="tk-danger">
						<form method="POST" action="/tickets?/delete" use:enhance={confirmDelete}>
							<input type="hidden" name="ticketId" value={ticket.id} />
							<button class="tk-delete-link" type="submit">🗑 Supprimer ce ticket</button>
						</form>
					</div>
				{/if}
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
	.hint {
		color: var(--text-mute);
		font-size: 13px;
	}
	.tk-modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.tk-danger {
		margin-top: 14px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
		display: flex;
		justify-content: flex-end;
	}
	.tk-delete-link {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-mute);
		border-radius: 7px;
		padding: 5px 10px;
	}
	.tk-delete-link:hover {
		color: var(--warn);
		background: var(--warn-tint);
	}
	.tk-key {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-mute);
	}
	.tk-key-input {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-mute);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 3px 6px;
		width: 110px;
	}
	.tk-key-input:hover,
	.tk-key-input:focus {
		border-color: var(--border-strong);
		background: var(--surface-2);
		color: var(--text);
		outline: none;
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
	.gap-neg {
		color: var(--success) !important;
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
	/* Slider de priorité — copié tel quel de tickets/+page.svelte (voir les commentaires là-bas). */
	.priority-slider {
		position: relative;
		width: 100%;
		height: 24px;
		margin-top: 10px;
		cursor: grab;
		outline: none;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
	}
	.priority-ends {
		display: flex;
		justify-content: space-between;
		margin-top: 2px;
		font-size: 9.5px;
		font-weight: 600;
		color: var(--text-mute);
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}
	.priority-slider:active {
		cursor: grabbing;
	}
	.priority-slider:active .priority-thumb {
		transform: translateY(-50%) scale(1.15);
		transition: none;
	}
	.priority-track {
		position: absolute;
		inset: 50% 0 auto 0;
		height: 7px;
		transform: translateY(-50%);
		border-radius: 20px;
		background: var(--surface-sunk);
		border: 1px solid var(--border);
		overflow: hidden;
	}
	.priority-scale {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			var(--priority-4) 0%,
			var(--priority-3) 25%,
			var(--priority-2) 50%,
			var(--priority-1) 75%,
			var(--priority-0) 100%
		);
	}
	.priority-mask {
		position: absolute;
		inset: 0 0 0 auto;
		background: var(--surface-sunk);
		transition: width 0.15s ease;
	}
	.priority-tick {
		position: absolute;
		top: 50%;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.85);
		border: 1px solid rgba(0, 0, 0, 0.2);
		transform: translate(-50%, -50%);
	}
	.priority-thumb {
		position: absolute;
		top: 50%;
		width: 20px;
		height: 20px;
		margin-left: -10px;
		border-radius: 50%;
		background: var(--surface);
		border: 2px solid var(--pcolor);
		color: var(--pcolor);
		font-size: 10.5px;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		transform: translateY(-50%);
		box-shadow: var(--shadow-sm);
		transition: left 0.15s ease;
		pointer-events: none;
	}
	.priority-slider:focus-visible .priority-thumb {
		box-shadow:
			0 0 0 3px color-mix(in srgb, var(--pcolor) 35%, transparent),
			var(--shadow-sm);
	}
</style>
