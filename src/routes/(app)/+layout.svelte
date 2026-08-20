<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page, navigating } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { beep } from '$lib/sound';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import Snow from '$lib/components/Snow.svelte';
	import Hearts from '$lib/components/Hearts.svelte';
	import Garland from '$lib/components/Garland.svelte';
	import SeasonalBanner from '$lib/components/SeasonalBanner.svelte';
	import MotivationBanner from '$lib/components/MotivationBanner.svelte';
	import Fireworks from '$lib/components/Fireworks.svelte';
	import HalloweenCorner from '$lib/components/HalloweenCorner.svelte';
	import { seasonalState, initSeasonal, activeSeasonalEffects } from '$lib/seasonal.svelte';
	let { children, data } = $props();
	let commandPalette: CommandPalette | undefined = $state();

	onMount(initSeasonal);

	// Les compteurs de la navbar (votes mood, congés à valider, personne de support) viennent du
	// load de +layout.server.ts, qui ne rejoue pas sur une navigation client : un onglet laissé
	// ouvert afficherait l'état du matin. On les rafraîchit au retour sur l'onglet, avec un délai
	// minimum entre deux rafraîchissements — sinon une série d'alt-tab rejoue le load à chaque
	// aller-retour, alors que rien n'a eu le temps de changer côté serveur.
	const REFRESH_COOLDOWN_MS = 120_000;
	onMount(() => {
		let lastRefresh = Date.now();
		const refresh = () => {
			if (document.visibilityState !== 'visible') return;
			if (Date.now() - lastRefresh < REFRESH_COOLDOWN_MS) return;
			lastRefresh = Date.now();
			invalidateAll();
		};
		document.addEventListener('visibilitychange', refresh);
		return () => document.removeEventListener('visibilitychange', refresh);
	});
	const seasonalIds = $derived(new Set(activeSeasonalEffects().map((e) => e.id)));
	const seasonalVisible = $derived(browser && (seasonalState.enabled || seasonalState.forced));

	let wsMenuOpen = $state(false);
	let sidebarOpen = $state(false);

	// Ferme le tiroir mobile dès qu'on navigue (sans effet sur desktop, où .sidebar reste statique).
	$effect(() => {
		page.url.pathname;
		sidebarOpen = false;
	});

	const initials = (name: string) =>
		name
			.split(/\s+/)
			.map((w) => w[0])
			.join('')
			.slice(0, 2)
			.toUpperCase();

	// exact=true : ne matche pas les sous-routes (utile quand un préfixe est aussi porté par
	// d'autres liens de nav, ex. /dashboard vs /dashboard/version et /dashboard/sprint).
	function isActive(path: string, exact = false) {
		if (exact) return page.url.pathname === path;
		return page.url.pathname === path || page.url.pathname.startsWith(path + '/');
	}

	// Barre de progression globale : uniquement pour un changement de PAGE (route différente), pas
	// pour un rechargement de filtre en place (même route, ex. tickets/imputation) — ces cas-là ont
	// déjà leur propre indicateur local, la doublonner serait redondant.
	const isPageChange = $derived(!!navigating.to && navigating.to.route.id !== page.route.id);

	const isOwner = $derived(!!data.user && data.user.id === data.workspace?.createdByUserId);
	const roleLabel = $derived(data.role === 'ADMIN' ? 'Admin' : data.role === 'MANAGER' ? 'Manager' : 'Membre');

	// Easter egg : 10 clics rapides sur le logo -> il prend vie un instant, avec un son par clic
	// (gamme montante) et un jingle différent au 10e.
	let logoClicks = 0;
	let logoClickTimer: ReturnType<typeof setTimeout> | undefined;
	let logoAlive = $state(false);

	// Gamme montante pour les clics 1 à 9 (Ré4 -> Mi5).
	const CLICK_NOTES = [293.66, 329.63, 369.99, 392, 440, 493.88, 554.37, 587.33, 659.25];

	function clickLogo() {
		logoClicks++;
		clearTimeout(logoClickTimer);
		logoClickTimer = setTimeout(() => (logoClicks = 0), 1200);
		if (logoClicks >= 10) {
			logoClicks = 0;
			logoAlive = false;
			requestAnimationFrame(() => (logoAlive = true));
			// Jingle distinct (timbre + rythme différents des simples clics) pour marquer le 10e.
			[880, 1108.73, 1318.51].forEach((freq, i) =>
				beep(freq, { offset: i * 0.1, duration: i === 2 ? 0.3 : 0.1, type: 'triangle', volume: 0.14 })
			);
			console.log(
				'%cImputo',
				'font-size:26px;font-weight:800;color:#e0483e;',
				"\nBravo, vous avez trouvé un easter egg. Essayez aussi le code Konami ↑↑↓↓←→←→BA."
			);
		} else {
			beep(CLICK_NOTES[logoClicks - 1], { duration: 0.07, volume: 0.09 });
		}
	}
</script>

<div class="pageload-bar" class:on={isPageChange} aria-hidden="true"></div>
<div class="app">
	<div class="mobile-topbar">
		<button class="icon-btn" aria-label="Ouvrir le menu" onclick={() => (sidebarOpen = true)}>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
		</button>
		<span class="brand-name">Imputo</span>
	</div>
	{#if sidebarOpen}
		<button class="sidebar-backdrop" aria-label="Fermer le menu" onclick={() => (sidebarOpen = false)}></button>
	{/if}
	<aside class="sidebar" class:open={sidebarOpen}>
		<button class="sidebar-close" aria-label="Fermer le menu" onclick={() => (sidebarOpen = false)}>✕</button>
		{#if seasonalVisible && seasonalIds.has('christmas')}<Garland />{/if}
		<div class="brand">
			<div
				class="mark"
				class:alive={logoAlive}
				class:upside-down={seasonalVisible && seasonalIds.has('april-fools')}
				class:bastille={seasonalVisible && seasonalIds.has('bastille-day')}
				class:halloween={seasonalVisible && seasonalIds.has('halloween')}
				role="button"
				tabindex="0"
				title={seasonalVisible && seasonalIds.has('april-fools') ? "Tout va bien, c'est le 1er avril 🙃" : undefined}
				onclick={clickLogo}
				onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && clickLogo()}
				onanimationend={() => (logoAlive = false)}
			>
				{#if seasonalVisible && seasonalIds.has('christmas')}<span class="santa-hat" aria-hidden="true">🎅</span>{/if}
				{#if seasonalVisible && seasonalIds.has('halloween')}<span class="pumpkin-hat" aria-hidden="true">🎃</span>{/if}
				{#if seasonalVisible && seasonalIds.has('april-fools')}<span class="fish-sticker" aria-hidden="true">🐟</span>{/if}
				<svg viewBox="108 84 296 296" fill="#fff" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
					<rect x="132" y="284" width="64" height="96" rx="30" />
					<rect x="224" y="230" width="64" height="150" rx="30" />
					<rect x="316" y="170" width="64" height="210" rx="30" />
					{#if seasonalVisible && seasonalIds.has('valentine')}
						<path transform="translate(348 116) scale(3.2) translate(-12 -12.17)" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
					{:else}
						<circle cx="348" cy="116" r="32" />
					{/if}
				</svg>
			</div>
			<div class="name">Imputo<small
					><a
						href="https://github.com/FabienBounoir/imputo"
						target="_blank"
						rel="noopener noreferrer"
						title="Version déployée — voir sur GitHub">{__APP_VERSION__}</a
					></small
				></div>
		</div>

		<div style="position:relative;">
			<button class="ws-switch" onclick={() => (wsMenuOpen = !wsMenuOpen)}>
				<div class="ws-dot">{initials(data.workspace?.workspaceName ?? '—')}</div>
				<div class="ws-meta">
					<b>{data.workspace?.workspaceName ?? 'Aucun espace'}</b>
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

		<div class="nav-label">Mon espace</div>
		<a class="nav-item" class:active={isActive('/imputation')} href="/imputation">
			<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>
			Mon imputation
		</a>
		<a class="nav-item" class:active={isActive('/tickets')} href="/tickets">
			<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16M4 12h16M4 19h10"/></svg>
			Tickets &amp; chiffrage
		</a>
		<a class="nav-item" class:active={isActive('/absences')} href="/absences">
			<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M3 10h18M8 2v4M16 2v4"/><path d="m8.5 15 2 2 4-4"/></svg>
			Absences
			{#if (data.role === 'ADMIN' || data.role === 'MANAGER') && data.pendingAbsencesCount > 0}
				<span class="badge" title="Congés en attente de validation">{data.pendingAbsencesCount}</span>
			{/if}
		</a>
		{#if data.workspace?.supportEnabled}
			<a
				class="nav-item"
				class:active={isActive('/support')}
				class:blink={data.supportDuty?.userId === data.user?.id}
				href="/support"
			>
				<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>
				Support
				{#if data.supportDuty}<span class="badge">{data.supportDuty.displayName.split(' ')[0]}</span>{/if}
			</a>
		{/if}
		{#if data.workspace?.moodEnabled}
			<a
				class="nav-item"
				class:active={isActive('/mood')}
				class:blink={data.moodStatus?.urgent}
				href="/mood"
			>
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
					<path d="M15.4754 9.51572C15.6898 10.3159 15.4311 11.0805 14.8977 11.2234C14.3642 11.3664 13.7579 10.8336 13.5435 10.0334C13.3291 9.23316 13.5877 8.4686 14.1212 8.32565C14.6547 8.18271 15.2609 8.71552 15.4754 9.51572Z" fill="currentColor"/>
					<path d="M9.67994 11.0687C9.89436 11.8689 9.63571 12.6335 9.10225 12.7764C8.56878 12.9194 7.9625 12.3865 7.74809 11.5863C7.53368 10.7861 7.79232 10.0216 8.32579 9.87863C8.85925 9.73569 9.46553 10.2685 9.67994 11.0687Z" fill="currentColor"/>
					<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.75C6.89137 2.75 2.75 6.89137 2.75 12C2.75 17.1086 6.89137 21.25 12 21.25C17.1086 21.25 21.25 17.1086 21.25 12C21.25 6.89137 17.1086 2.75 12 2.75ZM1.25 12C1.25 6.06294 6.06294 1.25 12 1.25C17.9371 1.25 22.75 6.06294 22.75 12C22.75 17.9371 17.9371 22.75 12 22.75C6.06294 22.75 1.25 17.9371 1.25 12ZM17.1789 13.3409C17.467 13.6385 17.4593 14.1133 17.1617 14.4014C16.9917 14.566 16.8128 14.7246 16.6256 14.8766L16.8441 15.3216C17.3971 16.4482 16.9214 17.8094 15.787 18.3464C14.6752 18.8728 13.3468 18.4085 12.8047 17.3043L12.5315 16.7477C11.2117 16.998 9.90919 16.9561 8.73026 16.6606C8.32847 16.5599 8.0844 16.1526 8.1851 15.7508C8.2858 15.349 8.69315 15.1049 9.09494 15.2056C10.2252 15.4889 11.5232 15.4924 12.841 15.1393C14.1588 14.7862 15.2811 14.1342 16.1183 13.3237C16.4159 13.0356 16.8908 13.0433 17.1789 13.3409ZM14.0048 16.345L14.1513 16.6433C14.3319 17.0114 14.7747 17.1661 15.1452 16.9907C15.5233 16.8117 15.6818 16.358 15.4975 15.9825L15.3707 15.7241C14.9417 15.9631 14.4851 16.1716 14.0048 16.345Z" fill="currentColor"/>
				</svg>
				Team mood
				{#if data.moodStatus?.voted}<span class="mood-check" title="Vous avez voté">✓</span>{/if}
			</a>
		{/if}

		<div class="nav-label">Pilotage</div>
		<a class="nav-item" class:active={isActive('/dashboard', true)} href="/dashboard">
			<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/></svg>
			Synthèse
		</a>
		<div class="nav-sub-group">
			<a class="nav-item" class:active={isActive('/dashboard/version')} href="/dashboard/version">
				<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="11" width="4" height="8"/><rect x="10" y="6" width="4" height="13"/><rect x="17" y="3" width="4" height="16"/></svg>
				Par version
			</a>
			<a class="nav-item" class:active={isActive('/dashboard/sprint')} href="/dashboard/sprint">
				<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></svg>
				Par sprint
			</a>
		</div>
		{#if data.role === 'ADMIN' || data.role === 'MANAGER'}
			<a class="nav-item" class:active={isActive('/admin/objectifs')} href="/admin/objectifs">
				<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
				Objectifs de la semaine
			</a>
		{/if}
		{#if (data.role === 'ADMIN' || data.canViewMoodResults) && data.workspace?.moodEnabled}
			<a class="nav-item" class:active={isActive('/admin/mood')} href="/admin/mood">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
					<path d="M15.4754 9.51572C15.6898 10.3159 15.4311 11.0805 14.8977 11.2234C14.3642 11.3664 13.7579 10.8336 13.5435 10.0334C13.3291 9.23316 13.5877 8.4686 14.1212 8.32565C14.6547 8.18271 15.2609 8.71552 15.4754 9.51572Z" fill="currentColor"/>
					<path d="M9.67994 11.0687C9.89436 11.8689 9.63571 12.6335 9.10225 12.7764C8.56878 12.9194 7.9625 12.3865 7.74809 11.5863C7.53368 10.7861 7.79232 10.0216 8.32579 9.87863C8.85925 9.73569 9.46553 10.2685 9.67994 11.0687Z" fill="currentColor"/>
					<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.75C6.89137 2.75 2.75 6.89137 2.75 12C2.75 17.1086 6.89137 21.25 12 21.25C17.1086 21.25 21.25 17.1086 21.25 12C21.25 6.89137 17.1086 2.75 12 2.75ZM1.25 12C1.25 6.06294 6.06294 1.25 12 1.25C17.9371 1.25 22.75 6.06294 22.75 12C22.75 17.9371 17.9371 22.75 12 22.75C6.06294 22.75 1.25 17.9371 1.25 12ZM17.1789 13.3409C17.467 13.6385 17.4593 14.1133 17.1617 14.4014C16.9917 14.566 16.8128 14.7246 16.6256 14.8766L16.8441 15.3216C17.3971 16.4482 16.9214 17.8094 15.787 18.3464C14.6752 18.8728 13.3468 18.4085 12.8047 17.3043L12.5315 16.7477C11.2117 16.998 9.90919 16.9561 8.73026 16.6606C8.32847 16.5599 8.0844 16.1526 8.1851 15.7508C8.2858 15.349 8.69315 15.1049 9.09494 15.2056C10.2252 15.4889 11.5232 15.4924 12.841 15.1393C14.1588 14.7862 15.2811 14.1342 16.1183 13.3237C16.4159 13.0356 16.8908 13.0433 17.1789 13.3409ZM14.0048 16.345L14.1513 16.6433C14.3319 17.0114 14.7747 17.1661 15.1452 16.9907C15.5233 16.8117 15.6818 16.358 15.4975 15.9825L15.3707 15.7241C14.9417 15.9631 14.4851 16.1716 14.0048 16.345Z" fill="currentColor"/>
				</svg>
				Résultats Team mood
				{#if data.moodTotalVotes > 0}<span class="badge">{data.moodTotalVotes}</span>{/if}
			</a>
		{/if}

		{#if data.role === 'ADMIN'}
			<div class="nav-label">Administration</div>
			<a class="nav-item" class:active={isActive('/admin', true)} href="/admin">
				<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
<path fill-rule="evenodd" clip-rule="evenodd" d="M12 8.25C9.92894 8.25 8.25 9.92893 8.25 12C8.25 14.0711 9.92894 15.75 12 15.75C14.0711 15.75 15.75 14.0711 15.75 12C15.75 9.92893 14.0711 8.25 12 8.25ZM9.75 12C9.75 10.7574 10.7574 9.75 12 9.75C13.2426 9.75 14.25 10.7574 14.25 12C14.25 13.2426 13.2426 14.25 12 14.25C10.7574 14.25 9.75 13.2426 9.75 12Z" fill="currentColor"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M11.9747 1.25C11.5303 1.24999 11.1592 1.24999 10.8546 1.27077C10.5375 1.29241 10.238 1.33905 9.94761 1.45933C9.27379 1.73844 8.73843 2.27379 8.45932 2.94762C8.31402 3.29842 8.27467 3.66812 8.25964 4.06996C8.24756 4.39299 8.08454 4.66251 7.84395 4.80141C7.60337 4.94031 7.28845 4.94673 7.00266 4.79568C6.64714 4.60777 6.30729 4.45699 5.93083 4.40743C5.20773 4.31223 4.47642 4.50819 3.89779 4.95219C3.64843 5.14353 3.45827 5.3796 3.28099 5.6434C3.11068 5.89681 2.92517 6.21815 2.70294 6.60307L2.67769 6.64681C2.45545 7.03172 2.26993 7.35304 2.13562 7.62723C1.99581 7.91267 1.88644 8.19539 1.84541 8.50701C1.75021 9.23012 1.94617 9.96142 2.39016 10.5401C2.62128 10.8412 2.92173 11.0602 3.26217 11.2741C3.53595 11.4461 3.68788 11.7221 3.68786 12C3.68785 12.2778 3.53592 12.5538 3.26217 12.7258C2.92169 12.9397 2.62121 13.1587 2.39007 13.4599C1.94607 14.0385 1.75012 14.7698 1.84531 15.4929C1.88634 15.8045 1.99571 16.0873 2.13552 16.3727C2.26983 16.6469 2.45535 16.9682 2.67758 17.3531L2.70284 17.3969C2.92507 17.7818 3.11058 18.1031 3.28089 18.3565C3.45817 18.6203 3.64833 18.8564 3.89769 19.0477C4.47632 19.4917 5.20763 19.6877 5.93073 19.5925C6.30717 19.5429 6.647 19.3922 7.0025 19.2043C7.28833 19.0532 7.60329 19.0596 7.8439 19.1986C8.08452 19.3375 8.24756 19.607 8.25964 19.9301C8.27467 20.3319 8.31403 20.7016 8.45932 21.0524C8.73843 21.7262 9.27379 22.2616 9.94761 22.5407C10.238 22.661 10.5375 22.7076 10.8546 22.7292C11.1592 22.75 11.5303 22.75 11.9747 22.75H12.0252C12.4697 22.75 12.8407 22.75 13.1454 22.7292C13.4625 22.7076 13.762 22.661 14.0524 22.5407C14.7262 22.2616 15.2616 21.7262 15.5407 21.0524C15.686 20.7016 15.7253 20.3319 15.7403 19.93C15.7524 19.607 15.9154 19.3375 16.156 19.1985C16.3966 19.0596 16.7116 19.0532 16.9974 19.2042C17.3529 19.3921 17.6927 19.5429 18.0692 19.5924C18.7923 19.6876 19.5236 19.4917 20.1022 19.0477C20.3516 18.8563 20.5417 18.6203 20.719 18.3565C20.8893 18.1031 21.0748 17.7818 21.297 17.3969L21.3223 17.3531C21.5445 16.9682 21.7301 16.6468 21.8644 16.3726C22.0042 16.0872 22.1135 15.8045 22.1546 15.4929C22.2498 14.7697 22.0538 14.0384 21.6098 13.4598C21.3787 13.1586 21.0782 12.9397 20.7378 12.7258C20.464 12.5538 20.3121 12.2778 20.3121 11.9999C20.3121 11.7221 20.464 11.4462 20.7377 11.2742C21.0783 11.0603 21.3788 10.8414 21.6099 10.5401C22.0539 9.96149 22.2499 9.23019 22.1547 8.50708C22.1136 8.19546 22.0043 7.91274 21.8645 7.6273C21.7302 7.35313 21.5447 7.03183 21.3224 6.64695L21.2972 6.60318C21.0749 6.21825 20.8894 5.89688 20.7191 5.64347C20.5418 5.37967 20.3517 5.1436 20.1023 4.95225C19.5237 4.50826 18.7924 4.3123 18.0692 4.4075C17.6928 4.45706 17.353 4.60782 16.9975 4.79572C16.7117 4.94679 16.3967 4.94036 16.1561 4.80144C15.9155 4.66253 15.7524 4.39297 15.7403 4.06991C15.7253 3.66808 15.686 3.2984 15.5407 2.94762C15.2616 2.27379 14.7262 1.73844 14.0524 1.45933C13.762 1.33905 13.4625 1.29241 13.1454 1.27077C12.8407 1.24999 12.4697 1.24999 12.0252 1.25H11.9747ZM10.5216 2.84515C10.5988 2.81319 10.716 2.78372 10.9567 2.76729C11.2042 2.75041 11.5238 2.75 12 2.75C12.4762 2.75 12.7958 2.75041 13.0432 2.76729C13.284 2.78372 13.4012 2.81319 13.4783 2.84515C13.7846 2.97202 14.028 3.21536 14.1548 3.52165C14.1949 3.61826 14.228 3.76887 14.2414 4.12597C14.271 4.91835 14.68 5.68129 15.4061 6.10048C16.1321 6.51968 16.9974 6.4924 17.6984 6.12188C18.0143 5.9549 18.1614 5.90832 18.265 5.89467C18.5937 5.8514 18.9261 5.94047 19.1891 6.14228C19.2554 6.19312 19.3395 6.27989 19.4741 6.48016C19.6125 6.68603 19.7726 6.9626 20.0107 7.375C20.2488 7.78741 20.4083 8.06438 20.5174 8.28713C20.6235 8.50382 20.6566 8.62007 20.6675 8.70287C20.7108 9.03155 20.6217 9.36397 20.4199 9.62698C20.3562 9.70995 20.2424 9.81399 19.9397 10.0041C19.2684 10.426 18.8122 11.1616 18.8121 11.9999C18.8121 12.8383 19.2683 13.574 19.9397 13.9959C20.2423 14.186 20.3561 14.29 20.4198 14.373C20.6216 14.636 20.7107 14.9684 20.6674 15.2971C20.6565 15.3799 20.6234 15.4961 20.5173 15.7128C20.4082 15.9355 20.2487 16.2125 20.0106 16.6249C19.7725 17.0373 19.6124 17.3139 19.474 17.5198C19.3394 17.72 19.2553 17.8068 19.189 17.8576C18.926 18.0595 18.5936 18.1485 18.2649 18.1053C18.1613 18.0916 18.0142 18.045 17.6983 17.8781C16.9973 17.5075 16.132 17.4803 15.4059 17.8995C14.68 18.3187 14.271 19.0816 14.2414 19.874C14.228 20.2311 14.1949 20.3817 14.1548 20.4784C14.028 20.7846 13.7846 21.028 13.4783 21.1549C13.4012 21.1868 13.284 21.2163 13.0432 21.2327C12.7958 21.2496 12.4762 21.25 12 21.25C11.5238 21.25 11.2042 21.2496 10.9567 21.2327C10.716 21.2163 10.5988 21.1868 10.5216 21.1549C10.2154 21.028 9.97201 20.7846 9.84514 20.4784C9.80512 20.3817 9.77195 20.2311 9.75859 19.874C9.72896 19.0817 9.31997 18.3187 8.5939 17.8995C7.86784 17.4803 7.00262 17.5076 6.30158 17.8781C5.98565 18.0451 5.83863 18.0917 5.73495 18.1053C5.40626 18.1486 5.07385 18.0595 4.81084 17.8577C4.74458 17.8069 4.66045 17.7201 4.52586 17.5198C4.38751 17.314 4.22736 17.0374 3.98926 16.625C3.75115 16.2126 3.59171 15.9356 3.4826 15.7129C3.37646 15.4962 3.34338 15.3799 3.33248 15.2971C3.28921 14.9684 3.37828 14.636 3.5801 14.373C3.64376 14.2901 3.75761 14.186 4.0602 13.9959C4.73158 13.5741 5.18782 12.8384 5.18786 12.0001C5.18791 11.1616 4.73165 10.4259 4.06021 10.004C3.75769 9.81389 3.64385 9.70987 3.58019 9.62691C3.37838 9.3639 3.28931 9.03149 3.33258 8.7028C3.34348 8.62001 3.37656 8.50375 3.4827 8.28707C3.59181 8.06431 3.75125 7.78734 3.98935 7.37493C4.22746 6.96253 4.3876 6.68596 4.52596 6.48009C4.66055 6.27983 4.74468 6.19305 4.81093 6.14222C5.07395 5.9404 5.40636 5.85133 5.73504 5.8946C5.83873 5.90825 5.98576 5.95483 6.30173 6.12184C7.00273 6.49235 7.86791 6.51962 8.59394 6.10045C9.31998 5.68128 9.72896 4.91837 9.75859 4.12602C9.77195 3.76889 9.80512 3.61827 9.84514 3.52165C9.97201 3.21536 10.2154 2.97202 10.5216 2.84515Z" fill="currentColor"/>
</svg>
				Paramètres &amp; membres
			</a>
			<a class="nav-item" class:active={isActive('/admin/cloture')} href="/admin/cloture">
				<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>
				Clôture mensuelle
			</a>
			<a class="nav-item" class:active={isActive('/admin/history')} href="/admin/history">
				<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>
				Historique
			</a>
		{/if}

		<div class="side-foot">
			<div class="user-card">
				<a class="user-main" href="/settings" title="Réglages">
					<div class="avatar">{initials(data.user?.displayName ?? '?')}</div>
					<div class="um">
					<b>{data.user?.displayName}</b>
					<span>{isOwner ? 'Créateur' : roleLabel}{#if isOwner}<span class="owner-crown" title="Créateur de l'espace">👑</span>{/if}</span>
				</div>
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
		{#if seasonalVisible && seasonalIds.has('christmas')}
			<SeasonalBanner id="christmas" message="🎄 Joyeuses fêtes de la part de l'équipe Imputo !" />
		{/if}
		{#if seasonalVisible && seasonalIds.has('april-fools')}
			<SeasonalBanner id="april-fools" message="🐟 Poisson d'avril ! Tout va bien, c'est juste le 1er avril." />
		{/if}
		<MotivationBanner quotes={data.motivationQuotes} />
		{@render children()}
	</main>
</div>

<ConfirmDialog />
<CommandPalette bind:this={commandPalette} {data} />
{#if seasonalVisible && seasonalIds.has('christmas')}<Snow />{/if}
{#if seasonalVisible && seasonalIds.has('valentine')}<Hearts />{/if}
{#if seasonalVisible && (seasonalIds.has('new-year') || seasonalIds.has('bastille-day'))}<Fireworks />{/if}
{#if seasonalVisible && seasonalIds.has('halloween')}<HalloweenCorner />{/if}
