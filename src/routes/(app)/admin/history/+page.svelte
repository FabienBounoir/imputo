<script lang="ts">
	import { formatDateTime } from '$lib/utils/date';
	import { TICKET_FIELD_LABELS, ABSENCE_FIELD_LABELS, WORKSPACE_FIELD_LABELS } from '$lib/changeLogLabels';

	let { data } = $props();

	type Entity = 'ALL' | 'TICKET' | 'ABSENCE' | 'WORKSPACE';
	type Cursor = { createdAt: string; id: string };
	type Entry = (typeof data.entries)[number];

	let entries = $state(data.entries);
	let nextCursor = $state<Cursor | null>(data.nextCursor);
	let loading = $state(false);
	let query = $state('');
	let entityFilter = $state<Entity>('ALL');
	let sentinel: HTMLElement | undefined = $state();

	function fieldLabel(entityType: 'TICKET' | 'ABSENCE' | 'WORKSPACE', field: string | null) {
		if (!field) return '';
		if (entityType === 'TICKET') return TICKET_FIELD_LABELS[field] ?? field;
		if (entityType === 'WORKSPACE') return WORKSPACE_FIELD_LABELS[field] ?? field;
		return ABSENCE_FIELD_LABELS[field] ?? field;
	}

	function entityLabel(entityType: 'TICKET' | 'ABSENCE' | 'WORKSPACE') {
		if (entityType === 'TICKET') return 'Ticket';
		if (entityType === 'WORKSPACE') return 'Configuration';
		return 'Absence';
	}

	async function fetchPage(reset: boolean) {
		if (loading || (!reset && !nextCursor)) return;
		loading = true;
		const params = new URLSearchParams();
		if (entityFilter !== 'ALL') params.set('entityType', entityFilter);
		if (query.trim()) params.set('q', query.trim());
		if (!reset && nextCursor) {
			params.set('cursorCreatedAt', nextCursor.createdAt);
			params.set('cursorId', nextCursor.id);
		}
		try {
			const res = await fetch(`/api/admin/history?${params}`);
			if (!res.ok) return;
			const page: { entries: Entry[]; nextCursor: Cursor | null } = await res.json();
			entries = reset ? page.entries : [...entries, ...page.entries];
			nextCursor = page.nextCursor;
		} finally {
			loading = false;
		}
	}

	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => fetchPage(true), 300);
	}
	function setEntityFilter(f: Entity) {
		if (f === entityFilter) return;
		entityFilter = f;
		fetchPage(true);
	}

	// Scroll infini paginé côté serveur : on charge la page suivante quand la sentinelle en bas de
	// liste devient visible, plutôt que tout charger d'un coup (fenêtre de 30 jours qui peut être dense).
	$effect(() => {
		if (!sentinel) return;
		const obs = new IntersectionObserver((es) => {
			if (es[0].isIntersecting) fetchPage(false);
		});
		obs.observe(sentinel);
		return () => obs.disconnect();
	});
</script>

<div class="topbar">
	<h1>Historique<small>Modifications tracées : estimations tickets, absences, configuration — 30 derniers jours</small></h1>
</div>

<div class="content">
	<div class="hfilters">
		<input class="hsearch" placeholder="Rechercher (ticket, personne, valeur…)" bind:value={query} oninput={onSearchInput} />
		<div class="htabs">
			<button type="button" class:active={entityFilter === 'ALL'} onclick={() => setEntityFilter('ALL')}>Tous</button>
			<button type="button" class:active={entityFilter === 'TICKET'} onclick={() => setEntityFilter('TICKET')}>Tickets</button>
			<button type="button" class:active={entityFilter === 'ABSENCE'} onclick={() => setEntityFilter('ABSENCE')}>Absences</button>
			<button type="button" class:active={entityFilter === 'WORKSPACE'} onclick={() => setEntityFilter('WORKSPACE')}>Configuration</button>
		</div>
	</div>

	<section class="card block">
		{#if entries.length === 0}
			<p class="hint" style="margin:0;">
				{#if loading}Chargement…{:else if query.trim() || entityFilter !== 'ALL'}Aucun résultat pour ces filtres.{:else}Aucune modification tracée sur les 30 derniers jours.{/if}
			</p>
		{:else}
			<div class="hlist">
				{#each entries as e (e.id)}
					<div class="hrow">
						<span class="hentity">
							{#if e.entityType === 'TICKET' && e.ticketKey}
								<a href="/tickets?q={e.ticketKey}">{e.ticketKey}</a>
							{:else}
								{entityLabel(e.entityType)}
							{/if}
						</span>
						{#if e.action === 'DELETE'}
							<span class="hchange">Suppression — {e.oldValue}</span>
						{:else if e.oldValue === null && e.newValue === null}
							<span class="hfield">{fieldLabel(e.entityType, e.field)}</span>
							<span class="hchange">Modifié</span>
						{:else}
							<span class="hfield">{fieldLabel(e.entityType, e.field)}</span>
							<span class="hchange">{e.oldValue ?? '—'} → {e.newValue ?? '—'}</span>
						{/if}
						<span class="hmeta hint">{e.changedByName ?? 'Quelqu’un'} · {formatDateTime(new Date(e.createdAt))}</span>
					</div>
				{/each}
			</div>
			{#if nextCursor}
				<div bind:this={sentinel} class="hsentinel hint">{loading ? 'Chargement…' : ''}</div>
			{:else if !loading}
				<p class="hsentinel hint">Fin des 30 derniers jours.</p>
			{/if}
		{/if}
	</section>
</div>

<style>
	.content {
		max-width: 900px;
	}
	.block {
		padding: 22px;
	}
	.hint {
		color: var(--text-mute);
		font-size: 13px;
	}
	.hfilters {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 14px;
	}
	.hsearch {
		flex: 1 1 260px;
		min-width: 0;
		padding: 9px 12px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font-size: 13px;
	}
	.hsearch:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
	}
	.htabs {
		display: flex;
		gap: 2px;
		background: var(--surface-sunk);
		border-radius: var(--r-md);
		padding: 3px;
	}
	.htabs button {
		padding: 7px 12px;
		border-radius: calc(var(--r-md) - 3px);
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-mute);
		white-space: nowrap;
	}
	.htabs button.active {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	.hlist {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.hrow {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 10px;
		padding: 10px 4px;
		border-bottom: 1px solid var(--border);
		font-size: 13px;
	}
	.hrow:last-child {
		border-bottom: none;
	}
	.hentity {
		font-weight: 700;
		min-width: 70px;
	}
	.hentity a {
		color: var(--accent-ink);
		text-decoration: none;
	}
	.hentity a:hover {
		text-decoration: underline;
	}
	.hfield {
		font-weight: 600;
		color: var(--text-soft);
	}
	.hchange {
		color: var(--text);
	}
	.hmeta {
		margin-left: auto;
		white-space: nowrap;
	}
	.hsentinel {
		text-align: center;
		padding: 14px 0 2px;
	}
</style>
