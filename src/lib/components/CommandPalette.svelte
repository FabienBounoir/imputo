<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { setTheme } from '$lib/theme';
	import { todayInParis, monthBounds } from '$lib/utils/date';
	import { requestTourReplay } from '$lib/tour/tourState.svelte';

	type LayoutData = {
		role: 'ADMIN' | 'MANAGER' | 'USER' | null;
		workspace: { workspaceId: string; moodEnabled: boolean; supportEnabled: boolean } | null;
		memberships: { workspaceId: string; workspaceName: string }[];
	};
	let { data }: { data: LayoutData } = $props();

	type Item = { id: string; label: string; hint?: string; icon: string; group: string; run: () => void; keepOpen?: boolean };
	type SlashCmd = { verb: string; label: string; icon: string; adminOnly?: boolean };

	// Commandes "/verbe" disponibles — ajouter ici pour qu'elles apparaissent dans la palette
	// dès que l'utilisateur tape "/" (voir slashCommandMatches).
	const slashCommandDefs: SlashCmd[] = [
		{ verb: 'imput', label: "/imput <nom> — imputation d'un membre", icon: '🧑', adminOnly: true },
		{ verb: 'msg', label: '/msg <nom> — envoyer une notification', icon: '📣', adminOnly: true }
	];
	type RefItem = { id: string; name: string };
	type MemberItem = { id: string; displayName: string };

	let open = $state(false);
	let query = $state('');
	let selected = $state(0);

	// Roulette : liste de noms persistée en local (par navigateur, pas par workspace — usage
	// ponctuel type "qui présente le daily"), tirage avec crypto.getRandomValues (vrai aléatoire).
	let rouletteOpen = $state(false);
	let rouletteNames = $state<string[]>([]);
	let rouletteNewName = $state('');
	let rouletteWinner = $state<string | null>(null);
	let rouletteSpinning = $state(false);
	let rouletteDisplayName = $state('');

	// Un seul AudioContext réutilisé (créé au premier tirage, dans le geste utilisateur — requis
	// par les navigateurs). Bips synthétisés à l'oscillateur, pas de fichier audio à charger.
	let audioCtx: AudioContext | null = null;
	function playTick(freq: number) {
		audioCtx ??= new AudioContext();
		const osc = audioCtx.createOscillator();
		const gain = audioCtx.createGain();
		osc.type = 'square';
		osc.frequency.value = freq;
		gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.08);
		osc.connect(gain).connect(audioCtx.destination);
		osc.start();
		osc.stop(audioCtx.currentTime + 0.08);
	}

	function openRoulette() {
		try {
			const stored: string[] = JSON.parse(localStorage.getItem('roulette-names') ?? '[]');
			// Purge les doublons casse-différente accumulés avant le correctif de dédoublonnage
			// (ex: "Alice" + "alice" enregistrés séparément), sinon la personne dupliquée garde un
			// poids double au tirage même après la correction de addRouletteName.
			const seen = new Set<string>();
			rouletteNames = stored.filter((n) => {
				const k = n.toLowerCase();
				if (seen.has(k)) return false;
				seen.add(k);
				return true;
			});
			if (rouletteNames.length !== stored.length) saveRouletteNames();
		} catch {
			rouletteNames = [];
		}
		rouletteWinner = null;
		rouletteOpen = true;
	}
	function closeRoulette() {
		rouletteOpen = false;
	}
	function saveRouletteNames() {
		localStorage.setItem('roulette-names', JSON.stringify(rouletteNames));
	}
	function addRouletteName() {
		const name = rouletteNewName.trim();
		// Comparaison insensible à la casse : "Alice" et "alice" ne doivent pas compter comme deux
		// personnes distinctes, sinon la personne dupliquée a deux fois plus de chances d'être tirée.
		if (!name || rouletteNames.some((n) => n.toLowerCase() === name.toLowerCase())) return;
		rouletteNames = [...rouletteNames, name];
		rouletteNewName = '';
		rouletteWinner = null;
		saveRouletteNames();
	}
	function removeRouletteName(name: string) {
		rouletteNames = rouletteNames.filter((n) => n !== name);
		rouletteWinner = null;
		saveRouletteNames();
	}
	// Défilement type machine à sous : les noms passent vite puis ralentissent (delay croissant
	// en ease-out) jusqu'à s'arrêter pile sur le nom tiré au sort au départ (finalIdx).
	function spinRoulette() {
		if (rouletteNames.length < 2 || rouletteSpinning) return;
		rouletteSpinning = true;
		rouletteWinner = null;
		const finalIdx = crypto.getRandomValues(new Uint32Array(1))[0] % rouletteNames.length;
		const totalTicks = rouletteNames.length * 3 + finalIdx + 1;
		let tick = 0;
		const step = () => {
			rouletteDisplayName = rouletteNames[tick % rouletteNames.length];
			playTick(tick < totalTicks - 1 ? 700 : 1100);
			tick++;
			if (tick < totalTicks) {
				const progress = tick / totalTicks;
				setTimeout(step, 40 + progress * progress * 260);
			} else {
				rouletteWinner = rouletteNames[finalIdx];
				rouletteSpinning = false;
			}
		};
		step();
	}

	// Modal "/msg <nom>" : ouverte avec le membre déjà choisi, envoie via /api/command/notify.
	let notifyOpen = $state(false);
	let notifyUserId = $state('');
	let notifyUserName = $state('');
	let notifyTitle = $state('');
	let notifyBody = $state('');
	let notifySending = $state(false);
	let notifyError = $state<string | null>(null);
	let notifySent = $state(false);
	let notifyBodyEl: HTMLTextAreaElement | undefined = $state();

	function openNotify(member: MemberItem) {
		notifyUserId = member.id;
		notifyUserName = member.displayName;
		notifyTitle = '';
		notifyBody = '';
		notifyError = null;
		notifySent = false;
		notifyOpen = true;
	}
	function closeNotify() {
		notifyOpen = false;
	}
	async function sendNotify() {
		if (!notifyTitle.trim() || !notifyBody.trim() || notifySending) return;
		notifySending = true;
		notifyError = null;
		try {
			const res = await fetch('/api/command/notify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ userId: notifyUserId, title: notifyTitle.trim(), body: notifyBody.trim() })
			});
			if (!res.ok) {
				notifyError = (await res.json().catch(() => null))?.message ?? "Échec de l'envoi.";
				return;
			}
			notifySent = true;
		} finally {
			notifySending = false;
		}
	}

	let refData = $state<{ projects: RefItem[]; sprints: RefItem[]; versions: RefItem[]; members: MemberItem[] } | null>(null);
	let ticketResults = $state<{ id: string; key: string; title: string }[]>([]);
	let ticketTimer: ReturnType<typeof setTimeout> | undefined;

	function postForm(action: string, fields: Record<string, string> = {}) {
		const form = document.createElement('form');
		form.method = 'POST';
		form.action = action;
		for (const [k, v] of Object.entries(fields)) {
			const input = document.createElement('input');
			input.type = 'hidden';
			input.name = k;
			input.value = v;
			form.appendChild(input);
		}
		document.body.appendChild(form);
		form.submit();
	}

	const staticCommands = $derived.by((): Item[] => {
		const cmds: Item[] = [];
		const nav = (label: string, href: string, icon: string) =>
			cmds.push({ id: `nav-${href}`, label, icon, group: 'Pages', run: () => goto(href) });

		nav('Mon imputation', '/imputation', '🗓️');
		nav('Tickets & chiffrage', '/tickets', '🎫');
		nav('Absences', '/absences', '🌴');
		if (data.workspace?.supportEnabled) nav('Support', '/support', '🛟');
		if (data.workspace?.moodEnabled) nav('Team mood', '/mood', '🙂');
		nav('Synthèse', '/dashboard', '📊');
		nav('Synthèse par version', '/dashboard/version', '📦');
		nav('Synthèse par sprint', '/dashboard/sprint', '🏃');
		if (data.role === 'ADMIN' || data.role === 'MANAGER') nav('Objectifs de la semaine', '/admin/objectifs', '🎯');
		if (data.role === 'ADMIN' && data.workspace?.moodEnabled) nav('Résultats Team mood', '/admin/mood', '🙂');
		if (data.role === 'ADMIN') {
			nav('Paramètres & membres', '/admin', '⚙️');
			nav('Clôture mensuelle', '/admin/cloture', '📁');
			nav('Suivi annuel', '/admin/suivi-annuel', '📈');
			nav('Historique', '/admin/history', '🕘');
		}
		nav('Réglages', '/settings', '👤');

		cmds.push({ id: 'theme-light', label: 'Thème clair', icon: '☀️', group: 'Actions', run: () => setTheme('light') });
		cmds.push({ id: 'theme-dark', label: 'Thème sombre', icon: '🌙', group: 'Actions', run: () => setTheme('dark') });
		cmds.push({ id: 'theme-system', label: 'Thème système', icon: '💻', group: 'Actions', run: () => setTheme('system') });
		cmds.push({ id: 'new-ticket', label: 'Nouveau ticket', icon: '➕', group: 'Actions', run: () => goto('/tickets?new=1') });
		cmds.push({ id: 'new-absence', label: 'Déclarer une absence', icon: '🌴', group: 'Actions', run: () => goto('/absences?declare=1') });
		cmds.push({ id: 'replay-tour', label: 'Revoir le tutoriel', icon: '🧭', group: 'Actions', run: requestTourReplay });
		cmds.push({ id: 'roulette', label: 'Roulette (tirer une personne au sort)', icon: '🎲', group: 'Actions', run: openRoulette });
		cmds.push({
			id: 'export-month',
			label: 'Exporter Excel (mois en cours)',
			icon: '📤',
			group: 'Actions',
			run: () => {
				const today = todayInParis();
				window.location.href = `/export?from=${monthBounds(today).start}&to=${today}`;
			}
		});

		for (const m of data.memberships) {
			if (m.workspaceId === data.workspace?.workspaceId) continue;
			cmds.push({
				id: `ws-${m.workspaceId}`,
				label: `Passer à « ${m.workspaceName} »`,
				icon: '🏢',
				group: 'Espaces',
				run: () => postForm('/workspace/switch', { workspaceId: m.workspaceId })
			});
		}

		cmds.push({ id: 'logout', label: 'Se déconnecter', icon: '🚪', group: 'Actions', run: () => postForm('/logout') });
		return cmds;
	});

	// Raccourci "/imput <nom>" (ADMIN) : va direct sur l'imputation d'un autre membre
	// (réutilise /imputation?u=<id>, déjà géré côté serveur).
	const slash = $derived(query.match(/^\/(\w*)\s*(.*)$/));
	const slashVerb = $derived(slash?.[1].toLowerCase() ?? '');
	const isImputSlash = $derived(data.role === 'ADMIN' && slash !== null && 'imput'.startsWith(slashVerb) && slashVerb.length > 0);
	// Raccourci "/msg <nom>" (ADMIN) : ouvre la modal d'envoi de notification pour ce membre.
	const isMsgSlash = $derived(data.role === 'ADMIN' && slash !== null && 'msg'.startsWith(slashVerb) && slashVerb.length > 0);

	const filteredStatic = $derived.by((): Item[] => {
		if (slash) return [];
		const q = query.trim().toLowerCase();
		if (!q) return staticCommands;
		return staticCommands.filter((c) => c.label.toLowerCase().includes(q));
	});

	const refMatches = $derived.by((): Item[] => {
		if (slash || !refData) return [];
		const q = query.trim().toLowerCase();
		if (!q) return [];
		const items: Item[] = [];
		for (const p of refData.projects) if (p.name.toLowerCase().includes(q)) items.push(refItem(p, '📁', 'Projets', `/tickets?project=${p.id}`));
		for (const s of refData.sprints) if (s.name.toLowerCase().includes(q)) items.push(refItem(s, '🏃', 'Sprints', `/tickets?sprint=${s.id}`));
		for (const v of refData.versions) if (v.name.toLowerCase().includes(q)) items.push(refItem(v, '📦', 'Versions', `/tickets?version=${v.id}`));
		return items.slice(0, 6);
	});

	function refItem(r: RefItem, icon: string, group: string, href: string): Item {
		return { id: `${group}-${r.id}`, label: r.name, icon, group, run: () => goto(href) };
	}

	// Tant qu'aucune commande n'est encore résolue (slashVerb vide ou ne matchant aucun verbe
	// connu), on propose la liste des commandes "/..." disponibles au lieu d'un résultat vide.
	const slashCommandMatches = $derived.by((): Item[] => {
		if (!slash || isImputSlash || isMsgSlash) return [];
		return slashCommandDefs
			.filter((c) => (!c.adminOnly || data.role === 'ADMIN') && c.verb.startsWith(slashVerb))
			.map((c) => ({
				id: `slashcmd-${c.verb}`,
				label: c.label,
				icon: c.icon,
				group: 'Commandes',
				keepOpen: true,
				run: () => (query = `/${c.verb} `)
			}));
	});

	const memberMatches = $derived.by((): Item[] => {
		if (!isImputSlash || !refData) return [];
		const q = (slash?.[2] ?? '').trim().toLowerCase();
		const pool = q ? refData.members.filter((m) => m.displayName.toLowerCase().includes(q)) : refData.members;
		return pool.slice(0, 8).map((m) => ({
			id: `member-${m.id}`,
			label: m.displayName,
			icon: '🧑',
			group: 'Imputation de…',
			hint: 'Entrée pour ouvrir',
			run: () => goto(`/imputation?u=${m.id}`)
		}));
	});

	const msgMemberMatches = $derived.by((): Item[] => {
		if (!isMsgSlash || !refData) return [];
		const q = (slash?.[2] ?? '').trim().toLowerCase();
		const pool = q ? refData.members.filter((m) => m.displayName.toLowerCase().includes(q)) : refData.members;
		return pool.slice(0, 8).map((m) => ({
			id: `msg-member-${m.id}`,
			label: m.displayName,
			icon: '📣',
			group: 'Notifier…',
			hint: 'Entrée pour écrire',
			run: () => openNotify(m)
		}));
	});

	const ticketItems = $derived.by(
		(): Item[] =>
			ticketResults.map((t) => ({
				id: `ticket-${t.id}`,
				label: `${t.key} — ${t.title}`,
				icon: '🎫',
				group: 'Tickets',
				run: () => goto(`/tickets?ticket=${encodeURIComponent(t.key)}`)
			}))
	);

	const visibleItems = $derived(
		isImputSlash
			? memberMatches
			: isMsgSlash
				? msgMemberMatches
				: slash
					? slashCommandMatches
					: [...filteredStatic, ...refMatches, ...ticketItems]
	);

	$effect(() => {
		selected = 0;
	});

	$effect(() => {
		const q = query.trim();
		clearTimeout(ticketTimer);
		if (slash || q.length < 2) {
			ticketResults = [];
			return;
		}
		ticketTimer = setTimeout(async () => {
			const res = await fetch(`/api/command/tickets?q=${encodeURIComponent(q)}`);
			if (res.ok) ticketResults = (await res.json()).tickets;
		}, 200);
	});

	async function ensureRefData() {
		if (refData) return;
		const res = await fetch('/api/command/data');
		if (res.ok) refData = await res.json();
	}

	function openPalette() {
		open = true;
		query = '';
		selected = 0;
		ensureRefData();
	}

	// Action plutôt que requestAnimationFrame : se déclenche au montage réel de l'input
	// (garanti dès que le bloc {#if open} insère l'élément), pas sur une estimation de timing.
	function autofocus(node: HTMLInputElement) {
		node.focus();
	}
	function closePalette() {
		open = false;
	}

	export function show() {
		openPalette();
	}
	function run(item: Item | undefined) {
		if (!item) return;
		item.run();
		if (!item.keepOpen) closePalette();
	}

	/** Le raccourci Shift+N ne doit jamais voler la frappe d'un champ texte en cours d'édition
	 *  (recherche, formulaire…) — une majuscule N y est une frappe normale. */
	function isTypingTarget(el: EventTarget | null) {
		if (!(el instanceof HTMLElement)) return false;
		return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
	}

	function onGlobalKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			open ? closePalette() : openPalette();
		} else if (e.key === 'Escape' && open) {
			closePalette();
		} else if (e.key === 'Escape' && rouletteOpen) {
			closeRoulette();
		} else if (e.key === 'Escape' && notifyOpen) {
			closeNotify();
		} else if (
			// Nouveau ticket depuis n'importe quelle page. Note : Shift+N, pas Ctrl/Cmd+N — les
			// navigateurs réservent ce dernier pour "nouvelle fenêtre" et ne le laissent jamais
			// atteindre la page. e.key.toLowerCase() : certains claviers/navigateurs rapportent "n"
			// avec shiftKey=true plutôt que "N". Sur /tickets, on laisse la page gérer elle-même le
			// raccourci (elle ouvre le popover directement, sans navigation, et connaît son propre
			// état de modale en cours).
			e.key.toLowerCase() === 'n' &&
			e.shiftKey &&
			!e.metaKey &&
			!e.ctrlKey &&
			!e.altKey &&
			!open &&
			page.url.pathname !== '/tickets' &&
			!isTypingTarget(e.target)
		) {
			e.preventDefault();
			goto('/tickets?new=1');
		} else if (
			// Ajout rapide d'imputation depuis n'importe quelle page — même mécanique que Shift+N
			// ci-dessus. Sur /imputation, on laisse la page gérer elle-même le raccourci (cf.
			// QuickAddPalette.svelte), qui connaît son propre état de palette en cours.
			e.key.toLowerCase() === 'a' &&
			e.shiftKey &&
			!e.metaKey &&
			!e.ctrlKey &&
			!e.altKey &&
			!open &&
			page.url.pathname !== '/imputation' &&
			!isTypingTarget(e.target)
		) {
			e.preventDefault();
			goto('/imputation?quickadd=1');
		}
	}

	function onInputKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selected = Math.min(selected + 1, visibleItems.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selected = Math.max(selected - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			run(visibleItems[selected]);
		}
	}
</script>

<svelte:window onkeydown={onGlobalKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="cp-backdrop" onclick={closePalette}>
		<div class="cp-panel" onclick={(e) => e.stopPropagation()}>
			<div class="cp-input-row">
				<span class="cp-icon">🔍</span>
				<input
					use:autofocus
					bind:value={query}
					onkeydown={onInputKeydown}
					placeholder="Rechercher une page, un ticket, un projet… ou /imput un nom"
					aria-label="Palette de commandes"
				/>
				<kbd>Esc</kbd>
			</div>

			<div class="cp-list">
				{#if isImputSlash}
					<div class="cp-group">Imputation de…</div>
					{#each memberMatches as item, i (item.id)}
						<button type="button" class="cp-item" class:on={i === selected} onclick={() => run(item)} onmouseenter={() => (selected = i)}>
							<span class="cp-item-icon">{item.icon}</span>
							<span class="cp-item-label">{item.label}</span>
						</button>
					{:else}
						<div class="cp-empty">Aucun membre trouvé.</div>
					{/each}
				{:else if isMsgSlash}
					<div class="cp-group">Notifier…</div>
					{#each msgMemberMatches as item, i (item.id)}
						<button type="button" class="cp-item" class:on={i === selected} onclick={() => run(item)} onmouseenter={() => (selected = i)}>
							<span class="cp-item-icon">{item.icon}</span>
							<span class="cp-item-label">{item.label}</span>
						</button>
					{:else}
						<div class="cp-empty">Aucun membre trouvé.</div>
					{/each}
				{:else if slash}
					<div class="cp-group">Commandes</div>
					{#each slashCommandMatches as item, i (item.id)}
						<button type="button" class="cp-item" class:on={i === selected} onclick={() => run(item)} onmouseenter={() => (selected = i)}>
							<span class="cp-item-icon">{item.icon}</span>
							<span class="cp-item-label">{item.label}</span>
						</button>
					{:else}
						<div class="cp-empty">Aucune commande ne correspond.</div>
					{/each}
				{:else}
					{#each [{ key: 'Pages', items: filteredStatic.filter((i) => i.group === 'Pages') }, { key: 'Projets', items: refMatches.filter((i) => i.group === 'Projets') }, { key: 'Sprints', items: refMatches.filter((i) => i.group === 'Sprints') }, { key: 'Versions', items: refMatches.filter((i) => i.group === 'Versions') }, { key: 'Tickets', items: ticketItems }, { key: 'Actions', items: filteredStatic.filter((i) => i.group === 'Actions') }, { key: 'Espaces', items: filteredStatic.filter((i) => i.group === 'Espaces') }] as g (g.key)}
						{#if g.items.length}
							<div class="cp-group">{g.key}</div>
							{#each g.items as item (item.id)}
								{@const i = visibleItems.indexOf(item)}
								<button type="button" class="cp-item" class:on={i === selected} onclick={() => run(item)} onmouseenter={() => (selected = i)}>
									<span class="cp-item-icon">{item.icon}</span>
									<span class="cp-item-label">{item.label}</span>
								</button>
							{/each}
						{/if}
					{/each}
					{#if visibleItems.length === 0}
						<div class="cp-empty">Aucun résultat.</div>
					{/if}
				{/if}
			</div>
		</div>
	</div>
{/if}

{#if rouletteOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="cp-backdrop" onclick={closeRoulette}>
		<div class="cp-panel roulette-panel" onclick={(e) => e.stopPropagation()}>
			<div class="cp-input-row">
				<span class="cp-icon">🎲</span>
				<input
					use:autofocus
					bind:value={rouletteNewName}
					onkeydown={(e) => e.key === 'Enter' && addRouletteName()}
					placeholder="Ajouter un nom…"
					aria-label="Ajouter un nom à la roulette"
				/>
				<kbd>Esc</kbd>
			</div>

			<div class="roulette-body">
				{#if rouletteNames.length === 0}
					<div class="cp-empty">Ajoute au moins deux noms pour tirer au sort.</div>
				{:else}
					<div class="roulette-names">
						{#each rouletteNames as name (name)}
							<span
								class="roulette-chip"
								class:winner={name === rouletteWinner}
								class:lit={rouletteSpinning && name === rouletteDisplayName}
							>
								{name}
								<button
									type="button"
									aria-label={`Retirer ${name}`}
									disabled={rouletteSpinning}
									onclick={() => removeRouletteName(name)}>×</button
								>
							</span>
						{/each}
					</div>
				{/if}

				{#if rouletteSpinning}
					<div class="roulette-reel">{rouletteDisplayName}</div>
				{/if}

				<button type="button" class="roulette-spin" disabled={rouletteNames.length < 2 || rouletteSpinning} onclick={spinRoulette}>
					{rouletteSpinning ? 'Tirage…' : 'Tirer au sort'}
				</button>

				{#if rouletteWinner && !rouletteSpinning}
					<div class="roulette-result">🎉 {rouletteWinner}</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

{#if notifyOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="cp-backdrop" onclick={closeNotify}>
		<div class="cp-panel notify-panel" onclick={(e) => e.stopPropagation()}>
			<div class="cp-input-row">
				<span class="cp-icon">📣</span>
				<span class="notify-to">à {notifyUserName}</span>
				<kbd>Esc</kbd>
			</div>

			{#if notifySent}
				<div class="roulette-body">
					<div class="roulette-result">✅ Notification envoyée à {notifyUserName}.</div>
					<button type="button" class="roulette-spin" onclick={closeNotify}>Fermer</button>
				</div>
			{:else}
				<div class="roulette-body">
					<input
						use:autofocus
						bind:value={notifyTitle}
						onkeydown={(e) => {
							if (e.key !== 'Enter') return;
							e.preventDefault();
							notifyBodyEl?.focus();
						}}
						maxlength="60"
						placeholder="Titre (ex: Rappel)"
						aria-label="Titre de la notification"
						class="notify-input"
					/>
					<textarea
						bind:this={notifyBodyEl}
						bind:value={notifyBody}
						onkeydown={(e) => {
							if (e.key !== 'Enter' || e.shiftKey) return;
							e.preventDefault();
							sendNotify();
						}}
						maxlength="200"
						rows="3"
						placeholder="Message… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)"
						aria-label="Message de la notification"
						class="notify-input"
					></textarea>
					{#if notifyError}
						<div class="notify-error">{notifyError}</div>
					{/if}
					<button
						type="button"
						class="roulette-spin"
						disabled={!notifyTitle.trim() || !notifyBody.trim() || notifySending}
						onclick={sendNotify}
					>
						{notifySending ? 'Envoi…' : 'Envoyer'}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.cp-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 12vh 20px 20px;
		z-index: 90;
	}
	.cp-panel {
		width: 100%;
		max-width: 560px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
		overflow: hidden;
		display: flex;
		flex-direction: column;
		max-height: 70vh;
	}
	.cp-input-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--border);
	}
	.cp-icon {
		font-size: 15px;
		opacity: 0.7;
	}
	.cp-input-row input {
		flex: 1;
		background: none;
		border: none;
		outline: none;
		font-size: 15px;
		color: var(--text);
	}
	.cp-input-row kbd {
		font-size: 11px;
		color: var(--text-mute);
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 2px 6px;
	}
	.cp-list {
		overflow-y: auto;
		padding: 6px;
	}
	.cp-group {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-mute);
		padding: 8px 10px 4px;
	}
	.cp-item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 9px 10px;
		border-radius: var(--r-sm);
		font-size: 13.5px;
		color: var(--text-soft);
		text-align: left;
	}
	.cp-item.on {
		background: var(--accent-tint-2);
		color: var(--text);
	}
	.cp-item-icon {
		font-size: 15px;
		flex-shrink: 0;
	}
	.cp-item-label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cp-empty {
		padding: 20px 10px;
		text-align: center;
		font-size: 13px;
		color: var(--text-mute);
	}

	.roulette-panel {
		max-height: unset;
	}
	.roulette-body {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.roulette-names {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.roulette-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 6px 6px 12px;
		border-radius: 999px;
		background: var(--accent-tint-2);
		font-size: 13px;
		color: var(--text);
	}
	.roulette-chip.winner,
	.roulette-chip.lit {
		background: var(--accent);
		color: var(--accent-contrast, #fff);
		font-weight: 600;
	}
	.roulette-reel {
		align-self: flex-start;
		font-size: 22px;
		font-weight: 700;
		padding: 10px 18px;
		border-radius: var(--r-sm);
		background: var(--accent-tint-2);
		min-width: 120px;
	}
	.roulette-chip button {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		font-size: 13px;
		line-height: 1;
		color: inherit;
		opacity: 0.7;
	}
	.roulette-chip button:hover {
		opacity: 1;
	}
	.roulette-spin {
		align-self: flex-start;
		padding: 9px 18px;
		border-radius: var(--r-sm);
		background: var(--accent);
		color: var(--accent-contrast, #fff);
		font-size: 13.5px;
		font-weight: 600;
	}
	.roulette-spin:disabled {
		opacity: 0.5;
	}
	.roulette-result {
		font-size: 20px;
		font-weight: 700;
		text-align: center;
		padding: 12px;
	}

	.notify-to {
		flex: 1;
		font-size: 14px;
		color: var(--text-mute);
	}
	.notify-input {
		width: 100%;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--text);
		font-size: 13.5px;
		font-family: inherit;
		resize: none;
	}
	.notify-error {
		font-size: 12.5px;
		color: var(--danger, #d33);
	}
</style>
