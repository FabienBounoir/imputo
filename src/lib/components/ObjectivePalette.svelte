<script lang="ts">
	import { tick } from 'svelte';
	import { visualViewportFit } from '$lib/visualViewport';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import KeyIcon, { type KeyName } from '$lib/components/KeyIcon.svelte';

	// Palette d'attribution des objectifs de la semaine — jumelle de QuickAddPalette (Mon imputation),
	// même habillage et même grammaire clavier, composant distinct. Ce que les deux ne partagent pas :
	// ici pas de catégories ni de filtre version, la tâche libre se crée sur place au lieu d'un
	// aller-retour vers /tickets, il y a une étape note en plus, une personne à cibler, et la palette
	// RESTE OUVERTE après chaque ajout (on attribue trois objectifs d'affilée à la même personne,
	// alors qu'on n'ajoute jamais deux lignes d'imputation d'une traite).
	// Le choix de dupliquer plutôt que de généraliser suit celui déjà fait par QuickAddPalette vis-à-vis
	// de TargetPicker, pour la même raison : greffer tout ça complexifierait un composant qui n'en a
	// pas besoin. À mutualiser le jour où une 3e palette apparaît.
	type Ticket = { id: string; key: string; title: string };
	type Activity = { id: string; label: string };
	type Member = { id: string; displayName: string };
	type Objective = {
		id: string;
		userId: string;
		kind: 'TICKET' | 'CUSTOM';
		ticketId: string | null;
		activityId: string | null;
		activityLabel: string | null;
		ticketKey: string | null;
		ticketTitle: string | null;
		label: string | null;
		doneAt: Date | null;
	};

	let {
		tickets,
		activities,
		members,
		objectives,
		carryover,
		weekNumber,
		prevWeekNumber,
		onadd,
		onremove
	}: {
		tickets: Ticket[];
		activities: Activity[];
		/** Uniquement les personnes attribuables : les congés sont filtrés par l'appelant. */
		members: Member[];
		/** Tous les objectifs de la semaine — la palette filtre sur la personne courante. */
		objectives: Objective[];
		/** Objectifs non faits la semaine précédente, toute l'équipe — proposés en tête pour être reportés. */
		carryover: Objective[];
		weekNumber: number;
		prevWeekNumber: number;
		onadd: (input: { userId: string; kind: 'TICKET' | 'CUSTOM'; ticketId: string; label: string; activityId: string }) => void;
		onremove: (objectiveId: string) => void;
	} = $props();

	// La recherche part au serveur : `tickets` n'est qu'une liste d'amorce (les 20 plus récents,
	// cf. listRecentTicketSummaries) affichée tant qu'on n'a rien tapé. Dès 2 caractères, on
	// interroge /api/command/tickets — le même endpoint que la palette de commandes, qui filtre et
	// borne côté SQL. Sans ça, tout le backlog devrait transiter dans la page à chaque affichage.
	const MIN_QUERY = 2;
	const SEARCH_DEBOUNCE_MS = 200;

	type Stage = 'target' | 'activity' | 'note';
	type Item =
		| { kind: 'carry'; objective: Objective }
		| { kind: 'ticket'; ticket: Ticket }
		| { kind: 'custom'; query: string };

	let open = $state(false);
	let userId = $state('');
	let stage = $state<Stage>('target');
	let query = $state('');
	let note = $state('');
	let activeIndex = $state(0);
	let chosen = $state<{ kind: 'TICKET' | 'CUSTOM'; ticketId: string; label: string } | null>(null);
	let chosenActivity = $state<{ id: string; label: string } | null>(null);
	let lastAdded = $state('');
	let searchInput: HTMLInputElement | null = $state(null);
	let listEl: HTMLDivElement | null = $state(null);

	const person = $derived(members.find((m) => m.id === userId) ?? null);
	const mine = $derived(objectives.filter((o) => o.userId === userId));
	// Reportés pas encore visibles dans `objectives` (POST + rechargement en cours) : sans ça la ligne
	// reste en tête de liste et un double Entrée l'ajoute deux fois. Vidé à chaque rechargement.
	let carried = $state<string[]>([]);
	$effect(() => {
		objectives;
		carried = [];
	});
	// Non faits en S-1 pour cette personne, moins ce qui est déjà repris cette semaine (même ticket, ou
	// même libellé de tâche) : reporté, il disparaît de la liste ; retiré de la semaine, il revient.
	const toCarry = $derived(
		carryover.filter(
			(o) =>
				o.userId === userId &&
				!carried.includes(o.id) &&
				!mine.some((m) => (o.kind === 'TICKET' ? m.ticketId === o.ticketId : m.kind === 'CUSTOM' && m.label === o.label))
		)
	);
	// Maj enfoncée : le pied de palette annonce Maj+Tab (personne précédente) au lieu de Tab.
	let shiftHeld = $state(false);
	// Nommée dans le pied de palette : « Tab Passer à Chloé » se comprend, « Tab personne suivante » non.
	const tabTarget = $derived.by(() => {
		if (members.length < 2) return null;
		const i = members.findIndex((m) => m.id === userId);
		return members[(i + (shiftHeld ? -1 : 1) + members.length) % members.length];
	});
	// La borne de la liste d'amorce est dite dans son en-tête : sinon on croit voir tout le backlog.
	const recentLabel = $derived(tickets.length > 1 ? `${tickets.length} derniers tickets` : 'Dernier ticket');

	let remoteTickets = $state<Ticket[]>([]);
	let searching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	// Jeton de course : deux frappes rapprochées lancent deux requêtes, et rien ne garantit qu'elles
	// reviennent dans l'ordre. Seule la dernière lancée a le droit d'écrire le résultat.
	let searchToken = 0;

	$effect(() => {
		const q = query.trim();
		clearTimeout(searchTimer);
		if (stage !== 'target' || q.length < MIN_QUERY) {
			remoteTickets = [];
			searching = false;
			return;
		}
		searching = true;
		const token = ++searchToken;
		searchTimer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/command/tickets?q=${encodeURIComponent(q)}`);
				const found = res.ok ? ((await res.json()).tickets as Ticket[]) : [];
				if (token === searchToken) remoteTickets = found;
			} catch {
				if (token === searchToken) remoteTickets = [];
			} finally {
				if (token === searchToken) searching = false;
			}
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(searchTimer);
	});

	const targetItems = $derived.by((): Item[] => {
		const q = query.trim();
		// Vide -> amorce ; 1 caractère -> rien (le serveur ne répond qu'à partir de 2), mais la tâche
		// libre reste proposée ; 2+ -> résultats du serveur.
		const base = q.length >= MIN_QUERY ? remoteTickets : q ? [] : tickets;
		// Reports seulement sur champ vide, avant l'amorce : dès qu'on tape, on cherche autre chose.
		const out: Item[] = [
			...(q ? [] : toCarry.map((o) => ({ kind: 'carry', objective: o }) as Item)),
			...base.map((t) => ({ kind: 'ticket', ticket: t }) as Item)
		];
		// Contrairement à Mon imputation, une recherche sans résultat ne renvoie pas vers /tickets :
		// un objectif sans ticket est un cas normal, la tâche libre se crée ici même.
		if (q) out.push({ kind: 'custom', query: q });
		return out;
	});

	const activityItems = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const filtered = activities.filter((a) => !q || a.label.toLowerCase().includes(q));
		// "Aucune activité" toujours en tête et pré-surlignée, jamais une activité au hasard —
		// même règle que QuickAddPalette.
		if (q) return filtered.map((a) => ({ id: a.id, label: a.label }));
		return [{ id: '', label: 'Aucune activité' }, ...filtered.map((a) => ({ id: a.id, label: a.label }))];
	});

	const count = $derived(stage === 'target' ? targetItems.length : stage === 'activity' ? activityItems.length : 0);

	async function scrollActiveIntoView() {
		await tick();
		listEl?.querySelector('.op-item.active')?.scrollIntoView({ block: 'nearest' });
	}

	/** Ouverture depuis une carte (personne pré-cadrée) ou via Shift+A (première personne libre). */
	export function show(forUserId?: string) {
		if (open) return;
		userId = forUserId && members.some((m) => m.id === forUserId) ? forUserId : (members[0]?.id ?? '');
		if (!userId) return;
		open = true;
		resetToSearch();
	}
	function resetToSearch() {
		stage = 'target';
		chosen = null;
		chosenActivity = null;
		query = '';
		note = '';
		activeIndex = 0;
		queueMicrotask(() => searchInput?.focus());
	}
	function close() {
		open = false;
		lastAdded = '';
	}

	function pick(i: number) {
		if (stage === 'target') {
			const it = targetItems[i];
			if (!it) return;
			if (it.kind === 'carry') {
				// Reporté tel quel en une touche (ticket ou tâche, note, activité) : pas d'étapes activité/note,
				// qui ne feraient que redemander ce qui est déjà connu. Pour changer, chercher le ticket.
				const o = it.objective;
				onadd({ userId, kind: o.kind, ticketId: o.ticketId ?? '', label: o.label ?? '', activityId: o.activityId ?? '' });
				carried = [...carried, o.id];
				lastAdded = o.label || o.ticketTitle || '';
				resetToSearch();
				return;
			}
			chosen =
				it.kind === 'ticket'
					? { kind: 'TICKET', ticketId: it.ticket.id, label: `${it.ticket.key} — ${it.ticket.title}` }
					: { kind: 'CUSTOM', ticketId: '', label: it.query };
			stage = 'activity';
			query = '';
			activeIndex = 0;
			queueMicrotask(() => searchInput?.focus());
			return;
		}
		if (stage === 'activity') {
			const it = activityItems[i];
			if (!it) return;
			chosenActivity = it.id ? { id: it.id, label: it.label } : null;
			// La note est une précision sur un ticket ("ce qu'on attend vraiment cette semaine") ;
			// pour une tâche libre le libellé tapé la porte déjà, l'étape n'aurait rien à saisir.
			if (chosen?.kind === 'CUSTOM') return commit();
			stage = 'note';
			query = '';
			activeIndex = 0;
			queueMicrotask(() => searchInput?.focus());
		}
	}

	function commit() {
		if (!chosen || !userId) return;
		onadd({
			userId,
			kind: chosen.kind,
			ticketId: chosen.ticketId,
			// Pour CUSTOM le libellé est la tâche elle-même ; pour TICKET c'est la note facultative.
			label: chosen.kind === 'CUSTOM' ? chosen.label : note.trim(),
			activityId: chosenActivity?.id ?? ''
		});
		lastAdded = chosen.label;
		resetToSearch();
	}

	function back() {
		if (stage === 'note') {
			stage = 'activity';
			chosenActivity = null;
		} else if (stage === 'activity') {
			stage = 'target';
			chosen = null;
		} else {
			close();
			return;
		}
		query = '';
		activeIndex = 0;
		queueMicrotask(() => searchInput?.focus());
	}

	/** Personne suivante de la liste, sans refermer — la tournée du vendredi en une seule ouverture. */
	function shiftPerson(delta: number) {
		if (members.length < 2) return;
		const i = members.findIndex((m) => m.id === userId);
		userId = members[(i + delta + members.length) % members.length].id;
		lastAdded = '';
		resetToSearch();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (count) activeIndex = (activeIndex + 1) % count;
			scrollActiveIntoView();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (count) activeIndex = (activeIndex - 1 + count) % count;
			scrollActiveIntoView();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			// Recherche en vol : la liste affichée est un squelette, et `targetItems` contient encore
			// les résultats de la frappe précédente (ou l'entrée « créer la tâche »). Valider ici
			// choisirait quelque chose que l'utilisateur ne voit pas.
			if (stage === 'target' && searching) return;
			if (stage === 'note') commit();
			else pick(activeIndex);
		} else if (e.key === 'Backspace' && !(stage === 'note' ? note : query) && stage !== 'target') {
			// À l'étape note le champ est lié à `note`, pas à `query` (vidé en y entrant) : tester `query`
			// ramenait en arrière à chaque Retour, en effaçant l'activité au lieu d'un caractère.
			e.preventDefault();
			back();
		} else if (e.key === 'Tab') {
			// Tab/Shift+Tab = personne suivante/précédente : le champ est le seul élément focusable
			// utile de la palette, la tabulation n'y a rien d'autre à faire.
			e.preventDefault();
			shiftPerson(e.shiftKey ? -1 : 1);
		}
	}

	function isTypingElsewhere(e: KeyboardEvent) {
		const t = e.target as HTMLElement | null;
		return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
	}
	function onWindowKeydown(e: KeyboardEvent) {
		shiftHeld = e.shiftKey;
		if (open && e.key === 'Escape') {
			e.preventDefault();
			back();
			return;
		}
		// Même raccourci et mêmes garde-fous que Mon imputation (Shift+A), sur une page où il est libre.
		if (!open && e.key.toLowerCase() === 'a' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingElsewhere(e)) {
			e.preventDefault();
			show();
		}
	}

	const placeholder = $derived(
		stage === 'target'
			? 'Rechercher un ticket, ou taper une tâche…'
			: stage === 'activity'
				? 'Activité — Entrée pour valider sans'
				: 'Note (facultatif) — Entrée pour ajouter'
	);
</script>

{#snippet key(names: KeyName[])}
	<kbd class="op-kbd">
		{#each names as n (n)}<KeyIcon name={n} />{/each}
	</kbd>
{/snippet}

{#snippet searchSkeleton()}
	<!-- Squelette plutôt qu'un simple "Recherche…" : la liste se remplit au même endroit et à la même
	     forme que les résultats à venir, donc rien ne saute quand ils arrivent. Largeurs volontairement
	     inégales pour que ça se lise comme des lignes de contenu, pas comme un tableau vide. -->
	{#each [64, 58, 70, 54] as w, i (i)}
		<div class="op-skel">
			<span class="op-skel-bar" style="width:{w}px;flex-shrink:0;"></span>
			<span class="op-skel-bar" style="width:{100 - i * 12}%;"></span>
		</div>
	{/each}
{/snippet}

<!-- keyup/blur : Maj relâchée, ou fenêtre quittée Maj enfoncée (keyup jamais reçu) → retour à « Tab ». -->
<svelte:window onkeydown={onWindowKeydown} onkeyup={(e) => (shiftHeld = e.shiftKey)} onblur={() => (shiftHeld = false)} />

{#if open && person}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="op-veil" onclick={close} use:visualViewportFit>
		<div class="op-palette" onclick={(e) => e.stopPropagation()}>
			<div class="op-head">
				<UserAvatar userId={person.id} name={person.displayName} size={22} />
				<span class="op-who">Objectifs de {person.displayName}</span>
				{#if members.length > 1}
					<button type="button" class="op-shift" onclick={() => shiftPerson(-1)} aria-label="Personne précédente">‹</button>
					<button type="button" class="op-shift" onclick={() => shiftPerson(1)} aria-label="Personne suivante">›</button>
				{/if}
				<span class="op-wk">S{weekNumber}</span>
			</div>

			{#if lastAdded}
				<div class="op-added">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 12l5 5L20 6" /></svg>
					Ajouté — {mine.length} objectif{mine.length > 1 ? 's' : ''} pour {person.displayName}
				</div>
			{/if}

			{#if mine.length > 0}
				<div class="op-existing">
					{#each mine as o (o.id)}
						<div class="op-line" class:done={!!o.doneAt}>
							<!-- Note à la place du titre, comme partout ailleurs (cf. objectivesSvg.objectiveLine). -->
							<span class="op-line-label">
								{#if o.kind === 'TICKET'}<b>{o.ticketKey}</b> {o.label || o.ticketTitle}{:else}{o.label}{/if}
							</span>
							<button type="button" class="op-rm" onclick={() => onremove(o.id)} aria-label="Retirer cet objectif">✕</button>
						</div>
					{/each}
				</div>
			{/if}

			<div class="op-input-row">
				{#if chosen}
					<span class="op-chip">
						<span class="op-chip-label">{chosen.label}</span>
						<button type="button" class="op-chip-x" onclick={back} aria-label="Changer de cible">✕</button>
					</span>
				{/if}
				{#if chosenActivity}
					<span class="op-chip op-chip-sm">
						<span class="op-chip-label">{chosenActivity.label}</span>
						<button type="button" class="op-chip-x" onclick={back} aria-label="Changer d'activité">✕</button>
					</span>
				{/if}
				{#if stage === 'note'}
					<input
						bind:this={searchInput}
						bind:value={note}
						onkeydown={onKeydown}
						type="text"
						maxlength="500"
						autocomplete="off"
						class="op-input"
						placeholder={placeholder}
						aria-label="Note de l'objectif"
					/>
				{:else}
					<input
						bind:this={searchInput}
						bind:value={query}
						oninput={() => (activeIndex = 0)}
						onkeydown={onKeydown}
						type="text"
						inputmode="search"
						autocomplete="off"
						autocapitalize="off"
						autocorrect="off"
						spellcheck="false"
						class="op-input"
						placeholder={placeholder}
						aria-label={stage === 'target' ? 'Rechercher un ticket ou une tâche' : 'Rechercher une activité'}
					/>
				{/if}
			</div>

			{#if stage !== 'note'}
				<div class="op-list" bind:this={listEl}>
					{#if stage === 'target' && searching}
						<!-- Le squelette REMPLACE la liste au lieu de s'y ajouter : sinon les résultats de la
						     frappe précédente restaient affichés au-dessus, et les barres en dessous se
						     lisaient comme des lignes supplémentaires plutôt que comme une recherche en cours. -->
						{@render searchSkeleton()}
					{:else if stage === 'target'}
						{#each targetItems as it, i (it.kind === 'ticket' ? 't:' + it.ticket.id : it.kind === 'carry' ? 'o:' + it.objective.id : 'c')}
							{#if i === 0 || targetItems[i - 1].kind !== it.kind}
								<div class="op-section">
									{it.kind === 'carry' ? `Non faits en S${prevWeekNumber}` : it.kind === 'ticket' ? (query.trim() ? 'Tickets trouvés' : recentLabel) : 'Tâche sans ticket'}
								</div>
							{/if}
							<button type="button" class="op-item" class:active={activeIndex === i} class:create={it.kind === 'custom'} onclick={() => pick(i)}>
								{#if it.kind === 'carry'}
									<!-- Note à la place du titre, comme la liste des objectifs au-dessus. -->
									{#if it.objective.ticketKey}<span class="op-key">{it.objective.ticketKey}</span>{/if}<span class="op-title">{it.objective.label || it.objective.ticketTitle}</span>
									<!-- Reprise telle quelle au report : on la montre pour qu'elle ne surprenne pas. -->
									{#if it.objective.activityLabel}<span class="op-tag">{it.objective.activityLabel}</span>{/if}
								{:else if it.kind === 'ticket'}
									<span class="op-key">{it.ticket.key}</span><span class="op-title">{it.ticket.title}</span>
								{:else}
									<span class="op-title">+ Créer la tâche « {it.query} »</span>
								{/if}
							</button>
						{/each}
						{#if targetItems.length === 0}
							<div class="op-empty">{query.trim() ? 'Aucun ticket ne correspond.' : 'Aucun ticket dans cet espace.'}</div>
						{/if}
					{:else}
						{#each activityItems as it, i (it.id || 'none')}
							<button type="button" class="op-item op-activity" class:active={activeIndex === i} onclick={() => pick(i)}>
								{it.label}
							</button>
						{/each}
						{#if activityItems.length === 0}<div class="op-empty">Aucune activité ne correspond.</div>{/if}
					{/if}
				</div>
			{/if}

			<!-- Libellés propres à chaque étape : on dit ce que fait la touche ICI (qui est la personne
			     suivante, où ramène Échap), pas une grammaire clavier générique. Tab reste actif aux étapes
			     suivantes mais n'y est pas proposé : il abandonnerait le ticket déjà choisi. -->
			<div class="op-footer">
				{#if stage === 'target'}
					<span class="op-hint">{@render key(['up', 'down'])} Parcourir</span>
					<span class="op-hint">{@render key(['enter'])} {targetItems[activeIndex]?.kind === 'carry' ? 'Reporter' : 'Choisir'}</span>
					{#if tabTarget}<span class="op-hint op-hint-person">{@render key(shiftHeld ? ['shift', 'tabBack'] : ['tab'])} <span class="op-hint-name">Passer à {tabTarget.displayName}</span></span>{/if}
					<span class="op-hint"><kbd class="op-kbd">Échap</kbd> Fermer</span>
				{:else if stage === 'activity'}
					<span class="op-hint">{@render key(['up', 'down'])} Parcourir</span>
					<span class="op-hint">{@render key(['enter'])} {chosen?.kind === 'CUSTOM' ? "Ajouter l'objectif" : 'Valider'}</span>
					<span class="op-hint"><kbd class="op-kbd">Échap</kbd> {chosen?.kind === 'CUSTOM' ? 'Changer de tâche' : 'Changer de ticket'}</span>
				{:else}
					<span class="op-hint">{@render key(['enter'])} Ajouter l'objectif</span>
					<span class="op-hint"><kbd class="op-kbd">Échap</kbd> Changer d'activité</span>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* Reprend l'habillage de QuickAddPalette : même voile, même position verticale — les deux palettes
	   doivent se ressembler d'un écran à l'autre. Plus large (560px vs 460px) : le pied de raccourcis,
	   qui nomme la personne suivante, doit tenir sur une ligne. */
	.op-veil {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 0 16px;
		padding-top: min(14vh, 100px);
		z-index: 60;
	}
	.op-palette {
		width: 100%;
		max-width: 560px;
		max-height: calc(100vh - min(14vh, 100px) - 3vh);
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
		overflow: hidden;
	}
	.op-head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 11px 14px;
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
		flex-shrink: 0;
	}
	.op-who {
		font-family: var(--font-display);
		font-size: 13.5px;
		font-weight: 600;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.op-shift {
		width: 22px;
		height: 22px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface);
		color: var(--text-soft);
		font-size: 13px;
		line-height: 1;
		cursor: pointer;
		flex-shrink: 0;
	}
	.op-shift:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.op-wk {
		font-size: 11px;
		font-weight: 700;
		color: var(--text-mute);
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}
	.op-added {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 9px 14px;
		font-size: 12px;
		color: var(--accent-ink);
		background: var(--accent-tint-2);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	.op-existing {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 10px 14px;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
		max-height: 160px;
		overflow-y: auto;
	}
	.op-line {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--text-soft);
	}
	.op-line.done .op-line-label {
		color: var(--text-mute);
		text-decoration: line-through;
	}
	.op-line-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.op-line-label b {
		color: var(--text);
	}
	.op-line.done .op-line-label b {
		color: inherit;
	}
	.op-rm {
		border: none;
		background: none;
		color: var(--text-mute);
		font-size: 11px;
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 5px;
		flex-shrink: 0;
	}
	.op-rm:hover {
		background: var(--surface-sunk);
		color: #c0392b;
	}
	.op-input-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--border);
		flex-wrap: wrap;
		flex-shrink: 0;
	}
	/* Même correctif que .qa-chip-row : flex-basis 100% + min-width 0, sinon un titre de ticket long
	   refuse de rétrécir et pousse la croix hors du cadre au lieu de laisser l'ellipsis agir. */
	.op-chip {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		flex: 0 0 100%;
		min-width: 0;
		box-sizing: border-box;
		padding: 6px 6px 6px 12px;
		border-radius: 999px;
		background: var(--accent-tint, var(--surface-2));
		color: var(--accent-ink, var(--accent));
		font-size: 12.5px;
		font-weight: 600;
	}
	.op-chip-sm {
		background: var(--surface-sunk);
		color: var(--text-soft);
	}
	.op-chip-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.op-chip-x {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		border: none;
		border-radius: 999px;
		background: color-mix(in srgb, currentColor 18%, transparent);
		color: inherit;
		font-size: 12px;
		line-height: 1;
		cursor: pointer;
	}
	.op-chip-x:hover {
		background: color-mix(in srgb, currentColor 32%, transparent);
	}
	.op-input {
		flex: 1;
		min-width: 80px;
		border: none;
		background: none;
		outline: none;
		font: inherit;
		font-size: 14px;
		color: var(--text);
	}
	.op-input::placeholder {
		color: var(--text-mute);
	}
	.op-list {
		padding: 6px;
		overflow-y: auto;
		flex: 1;
		min-height: 0;
	}
	.op-section {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-mute);
		padding: 8px 8px 3px;
	}
	.op-item {
		display: flex;
		align-items: baseline;
		gap: 8px;
		width: 100%;
		padding: 10px;
		border-radius: 8px;
		font-size: 13.5px;
		color: var(--text);
		text-align: left;
		background: none;
		border: none;
		cursor: pointer;
	}
	.op-item.active {
		background: var(--accent-tint, var(--surface-2));
	}
	.op-item.create {
		color: var(--accent-ink);
		font-weight: 600;
	}
	/* Liste verticale pleine largeur, comme .activity-option de QuickAddPalette. */
	.op-activity {
		font-weight: 600;
	}
	.op-activity.active {
		color: var(--accent-ink);
	}
	.op-key {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}
	.op-title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Même pastille que .tag-activity (admin/objectifs, imputation), calée à droite : c'est le titre
	   qui rétrécit en ellipsis, jamais l'activité. */
	.op-tag {
		margin-left: auto;
		flex-shrink: 0;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-soft);
		background: var(--surface-sunk);
		padding: 2px 8px;
		border-radius: 20px;
		white-space: nowrap;
	}
	.op-empty {
		padding: 14px 10px;
		font-size: 13px;
		color: var(--text-mute);
	}
	.op-footer {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 9px 14px;
		border-top: 1px solid var(--border);
		background: var(--surface-2);
		font-size: 11.5px;
		color: var(--text-mute);
		flex-shrink: 0;
	}
	/* Toujours sur une ligne : seul le nom de la personne (indice Tab) rétrécit, en ellipsis, s'il est long. */
	.op-hint {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.op-hint-person {
		flex-shrink: 1;
		min-width: 0;
	}
	.op-hint-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.op-hint:last-child {
		margin-left: auto;
	}
	/* Même pastille que .qa-kbd (QuickAddPalette), avec des icônes SVG à la place des glyphes. */
	.op-kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		gap: 1px;
		min-width: 20px;
		height: 18px;
		padding: 0 5px;
		border-radius: 5px;
		border: 1px solid var(--border-strong);
		background: var(--surface);
		color: var(--text-soft);
		font: inherit;
		font-size: 10.5px;
		font-weight: 600;
	}
	/* ---------- Mobile : feuille du bas plutôt que fenêtre centrée ----------
	   Trois problèmes traités ensemble :
	   1. le clavier virtuel cachait le bas de la modale — le voile suit maintenant le viewport
	      VISIBLE (cf. visualViewportFit), donc la feuille reste toujours entièrement au-dessus ;
	   2. une fenêtre centrée à 14vh du haut gâchait la place et laissait la liste loin du pouce —
	      ancrée en bas, elle démarre là où la main se trouve ;
	   3. les cibles tactiles étaient calibrées à la souris (cf. pointer: coarse plus bas). */
	@media (max-width: 640px) {
		.op-veil {
			align-items: flex-end;
			padding: 0;
			/* Repli 100dvh quand visualViewport manque : on retrouve le comportement d'avant. */
			top: var(--vv-top, 0);
			bottom: auto;
			height: var(--vv-height, 100dvh);
		}
		.op-palette {
			max-width: none;
			max-height: 100%;
			border-radius: var(--r-lg, 16px) var(--r-lg, 16px) 0 0;
			/* Barre gestuelle iOS : sans ça le dernier élément est sous le trait. */
			padding-bottom: env(safe-area-inset-bottom, 0px);
		}
	}
	@media (pointer: coarse) {
		/* Repères clavier (↑↓, Tab, Échap) inutiles au doigt. */
		.op-footer {
			display: none;
		}
		/* 16px : en dessous, iOS zoome sur le champ au focus et décale toute la mise en page. */
		.op-input {
			font-size: 16px;
		}
		.op-item {
			min-height: 44px;
			padding-top: 12px;
			padding-bottom: 12px;
		}
		/* Boutons ronds : on agrandit la cible, pas la boîte — un padding vertical les déformerait. */
		.op-shift,
		.op-rm,
		.op-chip-x {
			width: 40px;
			height: 40px;
		}
		.op-line {
			gap: 4px;
		}
		/* Le rappel de l'existant cède la place avant la liste de résultats : en hauteur fixe (160px)
		   il occupait la moitié d'une feuille de téléphone et coupait une ligne en deux. En part de
		   la feuille, il suit sa taille — clavier ouvert compris. */
		.op-existing {
			max-height: 25%;
		}
	}

	/* Squelette de recherche — reprend l'apparence de .skeleton-bar de tickets/+page.svelte (même
	   dégradé mélangé à --text pour rester visible dans les deux thèmes, même animation). Dupliqué
	   plutôt que partagé : le repo garde ses styles locaux aux composants, et il n'y a pas de
	   feuille commune pour ça. */
	.op-skel {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px;
	}
	.op-skel-bar {
		height: 13px;
		border-radius: 5px;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--text) 12%, var(--surface-2)) 25%,
			color-mix(in srgb, var(--text) 26%, var(--surface-2)) 50%,
			color-mix(in srgb, var(--text) 12%, var(--surface-2)) 75%
		);
		background-size: 200% 100%;
		animation: op-skel-shimmer 1.4s ease-in-out infinite;
	}
	@keyframes op-skel-shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.op-skel-bar {
			animation: none;
		}
	}
</style>
