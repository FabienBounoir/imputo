<script lang="ts">
	import { page } from '$app/state';
	let { children, data } = $props();

	let wsMenuOpen = $state(false);

	const initials = (name: string) =>
		name
			.split(/\s+/)
			.map((w) => w[0])
			.join('')
			.slice(0, 2)
			.toUpperCase();

	function isActive(path: string) {
		return page.url.pathname === path || page.url.pathname.startsWith(path + '/');
	}

</script>

<div class="app">
	<aside class="sidebar">
		<div class="brand">
			<div class="mark">
				<svg viewBox="108 84 296 296" fill="#fff" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
					<rect x="132" y="284" width="64" height="96" rx="30" />
					<rect x="224" y="230" width="64" height="150" rx="30" />
					<rect x="316" y="170" width="64" height="210" rx="30" />
					<circle cx="348" cy="116" r="32" />
				</svg>
			</div>
			<div class="name">Imputo<small>suivi & chiffrage</small></div>
		</div>

		<div style="position:relative;">
			<button class="ws-switch" onclick={() => (wsMenuOpen = !wsMenuOpen)}>
				<div class="ws-dot">{initials(data.workspace?.workspaceName ?? '—')}</div>
				<div class="ws-meta">
					<b>{data.workspace?.workspaceName ?? 'Aucun espace'}</b>
					<span>@{data.workspace?.allowedDomain ?? ''}</span>
				</div>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-mute)"><path d="m6 9 6 6 6-6"/></svg>
			</button>
			{#if wsMenuOpen}
				<div class="ws-menu">
					{#each data.memberships as m (m.workspaceId)}
						<form method="POST" action="/workspace/switch">
							<input type="hidden" name="workspaceId" value={m.workspaceId} />
							<button type="submit">
								<span class="ws-dot" style="width:20px;height:20px;font-size:10px;">{initials(m.workspaceName)}</span>
								{m.workspaceName}
								{#if m.workspaceId === data.workspace?.workspaceId}<span style="margin-left:auto;color:var(--accent)">✓</span>{/if}
							</button>
						</form>
					{/each}
					<div class="sep"></div>
					<a href="/workspace/new" style="text-decoration:none;"><button type="button">+ Nouvel espace</button></a>
				</div>
			{/if}
		</div>

		<div class="nav-label">Espace de travail</div>
		<a class="nav-item" class:active={isActive('/imputation')} href="/imputation">
			<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>
			Mon imputation
		</a>
		<a class="nav-item" class:active={isActive('/tickets')} href="/tickets">
			<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16M4 12h16M4 19h10"/></svg>
			Tickets &amp; chiffrage
		</a>
		<a class="nav-item" class:active={isActive('/dashboard')} href="/dashboard">
			<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/></svg>
			Synthèse
		</a>

		{#if data.role === 'ADMIN'}
			<div class="nav-label">Administration</div>
			<a class="nav-item" class:active={isActive('/admin')} href="/admin">
				<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1.5-1.5V1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 17 2.6a1.7 1.7 0 0 0 1.9-.3"/></svg>
				Paramètres &amp; membres
			</a>
		{/if}

		<div class="side-foot">
			<div class="user-card">
				<a class="user-main" href="/settings" title="Réglages">
					<div class="avatar">{initials(data.user?.displayName ?? '?')}</div>
					<div class="um"><b>{data.user?.displayName}</b><span>{data.role === 'ADMIN' ? 'Admin' : 'Membre'}</span></div>
				</a>
				<form method="POST" action="/logout">
					<button class="icon-btn" title="Se déconnecter" aria-label="Se déconnecter">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
					</button>
				</form>
			</div>
		</div>
	</aside>

	<main class="main">
		{@render children()}
	</main>
</div>
