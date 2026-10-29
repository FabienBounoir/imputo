<script lang="ts">
	let { data } = $props();

	type Token = (typeof data.tokens)[number];

	let tokens = $state(data.tokens);
	let selectedUserId = $state('');
	let tokenName = $state('');
	let newToken = $state<string | null>(null);
	let creating = $state(false);
	let error = $state('');

	async function createToken() {
		if (!selectedUserId || !tokenName.trim()) return;
		creating = true;
		error = '';
		try {
			const res = await fetch('/api/admin/mcp-tokens', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: selectedUserId, name: tokenName.trim() })
			});
			if (!res.ok) { error = 'Erreur lors de la création'; return; }
			const data = await res.json();
			newToken = data.token;
			tokenName = '';
			selectedUserId = '';
			const list = await fetch('/api/admin/mcp-tokens');
			if (list.ok) tokens = await list.json();
		} finally {
			creating = false;
		}
	}

	async function revokeToken(id: string) {
		const res = await fetch(`/api/admin/mcp-tokens/${id}`, { method: 'DELETE' });
		if (res.ok) tokens = tokens.map(t => t.id === id ? { ...t, revokedAt: new Date().toISOString() } : t);
	}

	function formatDate(d: string | Date | null) {
		if (!d) return '—';
		return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
	}

	const active = $derived(tokens.filter(t => !t.revokedAt));
	const revoked = $derived(tokens.filter(t => t.revokedAt));
</script>

<div class="page">
	<h1>Tokens MCP</h1>
	<p class="subtitle">Chaque token donne accès au serveur MCP avec les droits du membre associé.</p>

	<section class="card">
		<h2>Créer un token</h2>
		<div class="form-row">
			<select bind:value={selectedUserId}>
				<option value="">— Membre —</option>
				{#each data.members as m}
					<option value={m.id}>{m.displayName} ({m.email})</option>
				{/each}
			</select>
			<input type="text" placeholder="Nom du token (ex: MacBook Fabien)" bind:value={tokenName} maxlength={100} />
			<button onclick={createToken} disabled={creating || !selectedUserId || !tokenName.trim()}>
				{creating ? 'Création…' : 'Générer'}
			</button>
		</div>
		{#if error}<p class="error">{error}</p>{/if}
	</section>

	{#if newToken}
	<section class="card token-reveal">
		<h2>Token généré — copiez-le maintenant</h2>
		<p class="warning">Il ne sera plus affiché après avoir quitté cette page.</p>
		<code class="token-value">{newToken}</code>
		<button onclick={() => navigator.clipboard.writeText(newToken!)}>Copier</button>
		<button class="secondary" onclick={() => newToken = null}>Fermer</button>
	</section>
	{/if}

	<section class="card">
		<h2>Tokens actifs ({active.length})</h2>
		{#if active.length === 0}
			<p class="empty">Aucun token actif.</p>
		{:else}
		<table>
			<thead><tr><th>Nom</th><th>Membre</th><th>Créé le</th><th></th></tr></thead>
			<tbody>
				{#each active as t (t.id)}
				<tr>
					<td>{t.name}</td>
					<td>{t.userName} <span class="muted">({t.userEmail})</span></td>
					<td>{formatDate(t.createdAt)}</td>
					<td><button class="danger" onclick={() => revokeToken(t.id)}>Révoquer</button></td>
				</tr>
				{/each}
			</tbody>
		</table>
		{/if}
	</section>

	{#if revoked.length > 0}
	<section class="card">
		<h2>Tokens révoqués ({revoked.length})</h2>
		<table>
			<thead><tr><th>Nom</th><th>Membre</th><th>Créé le</th><th>Révoqué le</th></tr></thead>
			<tbody>
				{#each revoked as t (t.id)}
				<tr class="revoked">
					<td>{t.name}</td>
					<td>{t.userName}</td>
					<td>{formatDate(t.createdAt)}</td>
					<td>{formatDate(t.revokedAt)}</td>
				</tr>
				{/each}
			</tbody>
		</table>
	</section>
	{/if}
</div>

<style>
	.page { max-width: 860px; margin: 0 auto; padding: 2rem 1rem; display: flex; flex-direction: column; gap: 1.5rem; }
	h1 { font-size: 1.5rem; font-weight: 700; margin: 0; }
	.subtitle { color: var(--text-muted); margin: 0; }
	h2 { font-size: 1rem; font-weight: 600; margin: 0 0 1rem; }
	.card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; }
	.form-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
	.form-row select, .form-row input { flex: 1; min-width: 180px; padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: 0.875rem; }
	button { padding: 0.5rem 1rem; border-radius: 6px; border: none; background: var(--accent); color: white; cursor: pointer; font-size: 0.875rem; font-weight: 500; }
	button:disabled { opacity: 0.5; cursor: not-allowed; }
	button.secondary { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
	button.danger { background: transparent; color: var(--error, #dc2626); border: 1px solid currentColor; font-size: 0.8rem; padding: 0.25rem 0.6rem; }
	.error { color: var(--error, #dc2626); font-size: 0.875rem; margin: 0.5rem 0 0; }
	.token-reveal { border-color: var(--accent); }
	.warning { color: var(--warning, #d97706); font-size: 0.875rem; margin: 0 0 0.75rem; }
	.token-value { display: block; padding: 0.75rem; background: var(--surface-2); border-radius: 6px; font-size: 0.8rem; word-break: break-all; margin-bottom: 0.75rem; }
	table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
	th { text-align: left; padding: 0.5rem 0.75rem; color: var(--text-muted); font-weight: 500; border-bottom: 1px solid var(--border); }
	td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border-subtle, var(--border)); }
	tr.revoked td { color: var(--text-muted); }
	.muted { color: var(--text-muted); font-size: 0.8rem; }
	.empty { color: var(--text-muted); font-size: 0.875rem; margin: 0; }
</style>
