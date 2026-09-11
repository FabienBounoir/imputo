<script lang="ts">
	import { formatDateTime } from '$lib/utils/date';
	import { fieldLabel, formatChangeValue } from '$lib/changeLogLabels';

	// Historique d'un ticket — partagé par la modal de Tickets & chiffrage et TicketEditModal. Chargé à
	// l'ouverture plutôt qu'avec la liste des tickets (rarement consulté, inutile d'alourdir le chargement).
	let { ticketId }: { ticketId: string } = $props();

	type Entry = {
		field: string | null;
		activityLabel: string | null;
		oldValue: string | null;
		newValue: string | null;
		changedByName: string | null;
		createdAt: string;
	};

	let entries = $state<Entry[]>([]);
	let loading = $state(true);

	$effect(() => {
		const id = ticketId;
		let stale = false; // ticket changé avant la réponse : on ignore celle de l'ancien
		loading = true;
		fetch(`/api/tickets/${id}/history`)
			.then((r) => (r.ok ? r.json() : { entries: [] }))
			.then((d) => {
				if (!stale) entries = d.entries;
			})
			.finally(() => {
				if (!stale) loading = false;
			});
		return () => {
			stale = true;
		};
	});
</script>

<div class="tk-history">
	<h4>Historique</h4>
	{#if loading}
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
</div>

<style>
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
	.hint {
		color: var(--text-mute);
		font-size: 13px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 160px;
		overflow-y: auto;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 8px;
		font-size: 12.5px;
	}
	.hf {
		font-weight: 600;
		color: var(--text-soft);
	}
	.hv {
		color: var(--text);
	}
	.hm {
		margin-left: auto;
		white-space: nowrap;
	}
</style>
