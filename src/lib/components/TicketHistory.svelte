<script lang="ts">
	import { formatDateTime } from '$lib/utils/date';
	import { fieldLabel, formatChangeValue } from '$lib/changeLogLabels';

	// Vue « historique » d'un ticket, affichée à la place de la fiche dans la modal (Tickets & chiffrage,
	// TicketEditModal) via le bouton Historique du pied de modal. Montée seulement à l'ouverture de la
	// vue : la plupart des ouvertures de modal ne la consultent pas, inutile de la requêter à chaque fois.
	let { ticketId, onback }: { ticketId: string; onback: () => void } = $props();

	type Entry = {
		field: string | null;
		activityLabel: string | null;
		oldValue: string | null;
		newValue: string | null;
		changedByName: string | null;
		createdAt: string;
	};

	let entries = $state<Entry[] | null>(null);
	let backBtn: HTMLButtonElement | undefined = $state();

	$effect(() => {
		const id = ticketId;
		let stale = false; // ticket changé avant la réponse : on l'ignore
		entries = null;
		fetch(`/api/tickets/${id}/history`)
			.then((r) => (r.ok ? r.json() : { entries: [] }))
			.catch(() => ({ entries: [] }))
			.then((d) => {
				if (!stale) entries = d.entries;
			});
		return () => {
			stale = true;
		};
	});

	// Le bouton Historique qui a ouvert la vue vient d'être masqué : le focus passe ici, ce qui ramène
	// aussi le haut de la vue à l'écran si la modal était défilée jusqu'au pied.
	$effect(() => backBtn?.focus());
</script>

<section class="tk-history" aria-label="Historique du ticket">
	<div class="tk-history-head">
		<button type="button" class="tk-history-back" bind:this={backBtn} onclick={onback}>← Retour à la fiche</button>
		<h4>
			Historique
			{#if entries}<span class="hint">· {entries.length} modification{entries.length > 1 ? 's' : ''}</span>{/if}
		</h4>
	</div>
	{#if entries === null}
		<p class="hint">Chargement…</p>
	{:else if entries.length === 0}
		<p class="hint">Aucune modification tracée pour l'instant.</p>
	{:else}
		<ul>
			{#each entries as h, i (i)}
				<li>
					<span class="hf">{fieldLabel('TICKET', h.field)}{#if h.activityLabel} · {h.activityLabel}{/if}</span>
					<span class="hv">{formatChangeValue('TICKET', h.field, h.oldValue)} → {formatChangeValue('TICKET', h.field, h.newValue)}</span>
					<span class="hm hint">{h.changedByName ?? 'Quelqu’un'} · {formatDateTime(new Date(h.createdAt))}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.tk-history {
		margin-top: 14px;
	}
	.tk-history-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		padding-bottom: 10px;
		border-bottom: 1px solid var(--border);
	}
	.tk-history-head h4 {
		margin: 0;
		font-size: 14px;
		font-weight: 700;
	}
	.tk-history-back {
		margin-left: -10px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-mute);
		border-radius: 7px;
		padding: 5px 10px;
	}
	.tk-history-back:hover {
		color: var(--text);
		background: var(--surface-sunk);
	}
	.hint {
		color: var(--text-mute);
		font-size: 13px;
		font-weight: 400;
	}
	p.hint {
		margin: 12px 0 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 10px;
		padding: 9px 0;
		border-bottom: 1px solid var(--border);
		font-size: 13px;
	}
	li:last-child {
		border-bottom: none;
	}
	.hf {
		font-weight: 600;
		color: var(--text-soft);
	}
	.hv {
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.hm {
		margin-left: auto;
		white-space: nowrap;
		font-size: 12px;
	}
</style>
