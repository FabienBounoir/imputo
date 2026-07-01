<script lang="ts">
	let { data } = $props();
	const wsName = $derived(data.deactivatedWorkspace?.workspaceName ?? '');
</script>

<div class="auth-wrap">
	<div class="auth-card">
		<div class="mark warn">⊘</div>
		{#if data.deactivatedWorkspace}
			<h2>Accès suspendu</h2>
			<p class="sub">
				Votre compte a été <b>désactivé</b> sur l'espace
				{#if wsName}« <b>{wsName}</b> »{/if}. Vous ne pouvez plus y accéder.
				Contactez un administrateur de cet espace pour être réactivé.
			</p>
		{:else}
			<h2>Aucun espace accessible</h2>
			<p class="sub">
				Votre compte n'est rattaché à aucun espace actif pour le moment.
			</p>
		{/if}

		{#if data.memberships.length > 0}
			<div class="alt">
				<div class="alt-h">Basculer vers un autre espace</div>
				{#each data.memberships as m (m.workspaceId)}
					<form method="POST" action="/workspace/switch">
						<input type="hidden" name="workspaceId" value={m.workspaceId} />
						<button class="ws-btn" type="submit">
							<span class="dot" style="background:{m.accentColor}"></span>
							<span class="ws-name">{m.workspaceName}</span>
							<span class="ws-role">{m.role === 'ADMIN' ? 'Admin' : 'Membre'}</span>
						</button>
					</form>
				{/each}
			</div>
		{:else}
			<a class="btn btn-primary block" href="/register">Créer un espace</a>
		{/if}

		<form method="POST" action="/logout" class="logout-row">
			<button class="btn btn-ghost block" type="submit">Se déconnecter</button>
		</form>
	</div>
</div>

<style>
	.mark.warn {
		background: var(--warn-tint);
		color: var(--warn);
	}
	.alt {
		margin: 18px 0 6px;
		text-align: left;
	}
	.alt-h {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-mute);
		margin-bottom: 10px;
	}
	.alt form {
		margin-bottom: 8px;
	}
	.ws-btn {
		display: flex;
		align-items: center;
		gap: 11px;
		width: 100%;
		padding: 12px 14px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 14px;
		font-weight: 500;
		transition: border-color 0.15s, background 0.15s;
	}
	.ws-btn:hover {
		border-color: var(--accent);
		background: var(--surface);
	}
	.dot {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.ws-name {
		flex: 1;
		text-align: left;
	}
	.ws-role {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.block {
		display: block;
		width: 100%;
		text-align: center;
	}
	.logout-row {
		margin-top: 14px;
	}
</style>
