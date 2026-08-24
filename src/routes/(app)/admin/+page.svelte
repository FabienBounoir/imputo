<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { formatDateTime } from '$lib/utils/date';
	import ExportModal from '$lib/components/ExportModal.svelte';
	import AccentPicker from '$lib/components/AccentPicker.svelte';
	import MemberAccessModal from '$lib/components/MemberAccessModal.svelte';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import { confirmDialog } from '$lib/confirm.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	let { data, form } = $props();

	// À utiliser sur TOUT formulaire d'édition en place (champ rempli depuis `data`).
	// Par défaut, `enhance` appelle form.reset() après un succès, ce qui remet chaque champ à
	// l'attribut `value` du HTML initial — or Svelte n'écrit jamais cet attribut, seulement la
	// propriété .value (cf. set_value). Le champ réaffiche donc la valeur du premier chargement,
	// et pire : la soumission suivante la renvoie telle quelle au serveur, écrasant la vraie donnée.
	// Ça ne se voyait pas sur un formulaire à un seul champ (la donnée change, Svelte réécrit
	// derrière), mais dès qu'un form porte deux champs, éditer l'un ressuscite l'autre.
	// Les formulaires de création gardent le reset par défaut, eux en ont besoin.
	const enhanceEdit: SubmitFunction = () => async ({ update }) => update({ reset: false });

	// Les flèches d'un <input type="number"> émettent un `change` à chaque clic : soumettre
	// directement, c'est un POST + un invalidateAll (tout le load de la page admin) par incrément,
	// qui réécrit le champ sous le curseur — il fallait re-cliquer dedans entre deux incréments.
	// On laisse retomber la rafale avant d'enregistrer.
	const submitTimers = new WeakMap<HTMLFormElement, ReturnType<typeof setTimeout>>();
	function submitSoon(form: HTMLFormElement, delay = 600) {
		clearTimeout(submitTimers.get(form));
		submitTimers.set(form, setTimeout(() => form.requestSubmit(), delay));
	}

	let accessModalFor = $state<string | null>(null);
	const accessModalMember = $derived(data.members.find((m) => m.id === accessModalFor) ?? null);

	// Menu "···" d'actions membre (Accès/Lien/Transmettre/Désactiver/Factice regroupés — trop de
	// boutons en ligne sinon). `position: fixed` calculée au clic, comme TargetPicker : la ligne vit
	// dans une card à overflow:clip qui rognerait un panneau en position:absolute.
	let openMemberMenu = $state<string | null>(null);
	let memberMenuPos = $state({ top: 0, right: 0 });
	let memberMenuEl: HTMLDivElement | null = $state(null);
	async function toggleMemberMenu(id: string, trigger: HTMLElement) {
		if (openMemberMenu === id) {
			openMemberMenu = null;
			return;
		}
		const r = trigger.getBoundingClientRect();
		memberMenuPos = { top: r.bottom + 4, right: window.innerWidth - r.right };
		openMemberMenu = id;
		// Le nombre d'items varie selon la personne visée (Accès/Transmettre/Désactiver conditionnels)
		// — on mesure le menu une fois rendu plutôt que d'estimer sa hauteur, et on le bascule
		// au-dessus du bouton s'il déborderait en bas de l'écran (même idée que TargetPicker).
		await tick();
		if (memberMenuEl && memberMenuPos.top + memberMenuEl.offsetHeight > window.innerHeight) {
			memberMenuPos = { top: r.top - memberMenuEl.offsetHeight - 4, right: memberMenuPos.right };
		}
	}
	function onWindowClickCloseMemberMenu(e: MouseEvent) {
		if (openMemberMenu && !(e.target as HTMLElement).closest('.member-menu, .member-menu-trigger')) openMemberMenu = null;
	}

	// ---------- Membres : recherche + regroupement (désactivés en bas) ----------
	const ROLE_LABELS: Record<string, string> = { USER: 'Membre', MANAGER: 'Manager', ADMIN: 'Admin' };
	function memberStatusLabel(m: { pending: boolean; active: boolean }) {
		return m.pending ? 'en attente' : m.active ? 'actif' : 'désactivé';
	}
	let memberSearch = $state('');
	const filteredMembers = $derived.by(() => {
		const q = memberSearch.trim().toLowerCase();
		const list = q
			? data.members.filter(
					(m) =>
						m.displayName.toLowerCase().includes(q) ||
						m.email.toLowerCase().includes(q) ||
						ROLE_LABELS[m.role].toLowerCase().includes(q) ||
						memberStatusLabel(m).includes(q)
				)
			: data.members;
		// Tri stable : seuls les désactivés passent en bas, l'ordre serveur est conservé au sein de
		// chaque groupe (actifs/en attente d'un côté, désactivés de l'autre).
		return [...list].sort((a, b) => Number(!a.active && !a.pending) - Number(!b.active && !b.pending));
	});
	// Frontière des deux groupes, pour insérer un séparateur visuel — absent si l'un des deux est vide.
	const firstInactiveMemberIndex = $derived(filteredMembers.findIndex((m) => !m.active && !m.pending));

	// Glisser-déposer (groupes de tickets, activités) : 'end' = zone sous le dernier élément
	// (dépose = envoyer à la fin) ; null = pas de survol actif.
	const DROP_END = 'end';
	function reorderList<T extends { id: string }>(list: T[], draggedId: string, targetId: string | typeof DROP_END): T[] | null {
		const from = list.findIndex((x) => x.id === draggedId);
		if (from === -1) return null;
		const next = [...list];
		const [moved] = next.splice(from, 1);
		const insertAt = targetId === DROP_END ? next.length : next.findIndex((x) => x.id === targetId);
		if (insertAt === -1) return null;
		next.splice(insertAt, 0, moved);
		return next;
	}

	// Ordre des groupes de tickets : copie locale pour un retour visuel immédiat pendant le drag,
	// resynchronisée dès que `data.ticketGroups` change (création/renommage/archivage/reorder serveur).
	let groupOrder = $state(data.ticketGroups);
	$effect(() => {
		groupOrder = data.ticketGroups;
	});
	let draggingGroupId = $state<string | null>(null);
	let dragOverGroupId = $state<string | null>(null);
	function onGroupDrop(targetId: string | typeof DROP_END) {
		const id = draggingGroupId;
		draggingGroupId = null;
		dragOverGroupId = null;
		if (!id || id === targetId) return;
		const next = reorderList(groupOrder, id, targetId);
		if (!next) return;
		groupOrder = next;
		const body = new FormData();
		for (const g of next) body.append('id', g.id);
		fetch('?/groupReorder', { method: 'POST', body }).then(() => invalidateAll());
	}

	// Même mécanique pour l'ordre des activités (référentiels) — cf. onGroupDrop ci-dessus.
	let activityOrder = $state(data.activities);
	$effect(() => {
		activityOrder = data.activities;
	});
	let draggingActivityId = $state<string | null>(null);
	let dragOverActivityId = $state<string | null>(null);
	function onActivityDrop(targetId: string | typeof DROP_END) {
		const id = draggingActivityId;
		draggingActivityId = null;
		dragOverActivityId = null;
		if (!id || id === targetId) return;
		const next = reorderList(activityOrder, id, targetId);
		if (!next) return;
		activityOrder = next;
		const body = new FormData();
		for (const a of next) body.append('id', a.id);
		fetch('?/actReorder', { method: 'POST', body }).then(() => invalidateAll());
	}

	const PRESETS = ['#16A34A', '#4F46E5', '#9333EA', '#0EA5E9', '#E11D48', '#EA580C', '#0D9488', '#CA8A04'];
	let accent = $state(data.accentColor);
	let copied = $state(false);
	// initialisé depuis la valeur enregistrée : le défilement lui-même vit dans le layout racine
	// (toujours monté), donc il continue de tourner en changeant de page et après un rechargement.
	let rgbMode = $state(data.accentRgb);
	let discoMode = $state(data.accentDisco);

	const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
	const MOOD_PERIODS: { value: string; label: string }[] = [
		{ value: 'WEEK_1', label: '1 semaine' },
		{ value: 'WEEK_2', label: '2 semaines' },
		{ value: 'WEEK_3', label: '3 semaines' },
		{ value: 'MONTH', label: '1 mois (du 1er au dernier jour)' }
	];
	let moodPeriodKind = $state(data.mood.periodKind);
	let moodStartWeekday = $state(data.mood.startWeekday);

	const SUPPORT_CADENCES: { value: string; label: string }[] = [
		{ value: 'DAY', label: 'Chaque jour' },
		{ value: 'WEEK', label: 'Chaque semaine (lun.→ven.)' },
		{ value: 'MONTH', label: 'Chaque mois' }
	];
	let newRotationUserId = $state('');
	const rotationCandidates = $derived(
		data.members.filter((m) => m.active && !data.supportMembers.some((rm) => rm.userId === m.id))
	);

	async function copyMessage() {
		if (!form?.invite) return;
		await navigator.clipboard.writeText(`${form.invite.subject}\n\n${form.invite.body}`);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	const TABS = [
		{ key: 'general', label: 'Général' },
		{ key: 'membres', label: 'Membres' },
		{ key: 'referentiels', label: 'Référentiels' },
		{ key: 'workflow', label: 'Workflow' },
		{ key: 'support', label: 'Support' },
		{ key: 'jira', label: 'Jira' }
	] as const;
	type Tab = (typeof TABS)[number]['key'];
	// Onglet lu depuis ?tab= au premier chargement (pour pouvoir transmettre un lien direct vers un
	// onglet précis) ; replaceState (pas goto) pour ne jamais redéclencher le load au clic.
	const tabFromUrl = TABS.find((t) => t.key === page.url.searchParams.get('tab'))?.key;
	let tab = $state<Tab>(tabFromUrl ?? 'general');
	function setTab(next: Tab) {
		tab = next;
		const params = new URLSearchParams(next === 'referentiels' ? { tab: next, ref: refSection } : { tab: next });
		replaceState(`?${params}`, {});
	}

	// ---------- Référentiels : sous-menu latéral (une section à la fois — cf. discussion ergonomie
	// 2026-08-20, le grid 2-3 colonnes se désalignait dès qu'une liste dépassait ses voisines) ----------
	const REF_SECTIONS = [
		{ key: 'projects', label: 'Projets' },
		{ key: 'sprints', label: 'Sprints' },
		{ key: 'versions', label: 'Versions' },
		{ key: 'categories', label: 'Catégories' },
		{ key: 'ssp', label: 'Codes SSP' },
		{ key: 'activities', label: 'Activités' },
		{ key: 'groups', label: 'Groupes de tickets' }
	] as const;
	type RefSection = (typeof REF_SECTIONS)[number]['key'];
	const refSectionCount = $derived<Record<RefSection, number>>({
		projects: data.projects.length,
		sprints: data.sprints.length,
		versions: data.versions.length,
		categories: data.categories.length,
		ssp: data.ssps.length,
		activities: data.activities.length,
		groups: data.ticketGroups.length
	});
	const refFromUrl = REF_SECTIONS.find((s) => s.key === page.url.searchParams.get('ref'))?.key;
	let refSection = $state<RefSection>(refFromUrl ?? 'projects');
	// Recherche remise à zéro à chaque changement de section — un filtre "SSP" oublié qui masquerait
	// silencieusement toute la liste "Activités" au clic suivant serait un piège classique.
	let refSearch = $state('');
	// Un seul champ de recherche monté à la fois (une section à la fois) : cette même ref est passée
	// en bind:this à chacun des inputs, elle pointe donc toujours sur celui actuellement affiché.
	let refSearchInput = $state<HTMLInputElement | null>(null);
	// Formulaire d'ajout replié par défaut — recherche et création sont deux intentions différentes,
	// les empiler toutes les deux ouvertes en permanence les rendait difficiles à distinguer.
	let refAddOpen = $state(false);
	async function setRefSection(next: RefSection) {
		refSection = next;
		refSearch = '';
		refAddOpen = false;
		replaceState(`?${new URLSearchParams({ tab: 'referentiels', ref: next })}`, {});
		// Choisir une section, c'est pour y chercher quelque chose tout de suite — focus après le
		// changement de branche {#if}, une fois le nouvel input monté (tick attend ce rendu).
		await tick();
		refSearchInput?.focus();
	}
	const refMatch = (text: string) => text.toLowerCase().includes(refSearch.trim().toLowerCase());

	// ---------- Jira (onglet) ----------
	let jiraRegexPattern = $state(data.jira.regexPattern);
	let jiraRegexReplacement = $state(data.jira.regexReplacement);
	let jiraSampleKey = $state('CARTEJEUNE_BLM-123');
	const jiraSampleResult = $derived.by(() => {
		if (!jiraRegexPattern) return jiraSampleKey;
		try {
			return jiraSampleKey.replace(new RegExp(jiraRegexPattern), jiraRegexReplacement);
		} catch {
			return null; // regex invalide, cf. message sous le champ
		}
	});
	const jiraAutoDisabled = $derived(!data.jira.enabled && data.jira.consecutiveFailures >= 5);
	let jiraSyncing = $state(false);
	// Une fois JQL + PAT renseignés, la configuration se replie derrière un bouton "Éditer" — seule
	// l'activation (toggle + statut + sync manuel) reste visible en permanence.
	const jiraConfigured = $derived(!!data.jira.jql && data.jira.patConfigured);
	let jiraEditing = $state(false);
	let jiraPatEditing = $state(false);
</script>

<svelte:window onclick={onWindowClickCloseMemberMenu} />

<div class="topbar">
	<h1>Paramètres &amp; membres</h1>
</div>

<div class="content admin">
	<div class="tabs">
		{#each TABS as t (t.key)}
			<button type="button" class:on={tab === t.key} onclick={() => setTab(t.key)}>{t.label}</button>
		{/each}
	</div>

	{#if tab === 'membres'}
		<section class="card block">
			<h3>Inviter un membre</h3>
			<p class="hint">L'invitation génère un message à copier puis envoyer vous-même (pas d'email automatique).</p>
			{#if form?.error}<div class="flash error">{form.error}</div>{/if}

			<form method="POST" action="?/invite" use:enhance>
				<div class="invite-row">
					<div class="field"><label for="dn">Nom</label><input id="dn" name="displayName" placeholder="Prénom Nom" required /></div>
					<div class="field"><label for="em">Email</label><input id="em" name="email" type="email" placeholder="prenom.nom@exemple.com" required /></div>
					<div class="field"><label for="ro">Rôle</label><select id="ro" name="role"><option value="USER">Membre</option><option value="MANAGER">Manager</option><option value="ADMIN">Admin</option></select></div>
					<button class="btn btn-primary" type="submit">Générer l'invitation</button>
				</div>
			</form>

			{#if form?.invite}
				<div class="invite-msg">
					<div class="invite-head">
						<b>Message à copier &amp; envoyer</b>
						<button class="btn btn-ghost" onclick={copyMessage}>{copied ? '✓ Copié' : 'Copier'}</button>
					</div>
					<div class="invite-subject">{form.invite.subject}</div>
					<pre>{form.invite.body}</pre>
				</div>
			{/if}
		</section>

		<section class="card block">
			<div class="block-head">
				<h3>Membres ({data.members.length})</h3>
				<div class="ref-search member-search">
					<input
						class="ref-search-input"
						type="search"
						placeholder="Rechercher…"
						bind:value={memberSearch}
					/>
				</div>
			</div>
			{#if form?.memberOk}<div class="flash ok">Membre mis à jour ✓</div>{/if}
			{#if form?.ownerOk}<div class="flash ok">Propriété de l'espace transmise ✓</div>{/if}

			<p class="hint" style="margin-bottom:0;">
				👑 Le <b>créateur de l'espace</b> a les mêmes droits qu'un admin, mais ne peut être ni rétrogradé ni
				désactivé par personne d'autre. Il peut transmettre ce statut à un autre membre actif.
			</p>
			<div class="members-wrap">
			<div class="members-scroll">
			<table class="members">
				<tbody>
					{#each filteredMembers as m, i (m.id)}
						{@const isSelf = m.id === data.selfId}
						{#if i === firstInactiveMemberIndex && firstInactiveMemberIndex > 0}
							<tr class="member-sep"><td colspan="5">Désactivés</td></tr>
						{/if}
						<tr class:inactive={!m.active && !m.pending}>
							<td><div class="mc"><UserAvatar userId={m.id} name={m.displayName} /><div><b>{m.displayName}{#if isSelf} <span class="you">vous</span>{/if}{#if m.factice} <span class="you factice-tag" title="Placeholder pour un arrangement entre projets (clôture) — exclu d'Objectifs de la semaine">factice</span>{/if}</b><span>{m.email}</span></div></div></td>
							<td>
								{#if m.isOwner}
									<span class="pill owner" title="Créateur de l'espace">👑 Créateur</span>
								{:else if isSelf}
									<span class="pill">{m.role === 'ADMIN' ? 'Admin' : m.role === 'MANAGER' ? 'Manager' : 'Membre'}</span>
								{:else}
									<form method="POST" action="?/memberRole" use:enhance={enhanceEdit}>
										<input type="hidden" name="userId" value={m.id} />
										<select class="role-sel" name="role" value={m.role} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
											<option value="USER">Membre</option>
											<option value="MANAGER">Manager</option>
											<option value="ADMIN">Admin</option>
										</select>
									</form>
								{/if}
							</td>
							<td>{#if m.pending}<span class="pill pending">⏳ En attente</span>{:else if !m.active}<span class="pill off">🚫 Désactivé</span>{:else}<span class="pill active">✓ Actif</span>{/if}</td>
							<td>
								<form method="POST" action="?/memberCapacity" use:enhance={enhanceEdit} class="cap-form">
									<input type="hidden" name="userId" value={m.id} />
									<input type="hidden" name="capacity" value={m.capacity} />
									<input
										class="cap-input"
										type="number"
										min="0"
										max="100"
										step="25"
										value={Math.round(Number(m.capacity) * 100)}
										title="Capacité hebdomadaire (100 % = temps plein)"
										onchange={(e) => {
											const form = e.currentTarget.form!;
											(form.elements.namedItem('capacity') as HTMLInputElement).value = String(Number(e.currentTarget.value) / 100);
											submitSoon(form);
										}}
									/>
									<span class="cap-unit">%</span>
								</form>
							</td>
							<td class="m-actions">
								<button
									type="button"
									class="ref-btn member-menu-trigger"
									onclick={(e) => toggleMemberMenu(m.id, e.currentTarget)}
									aria-haspopup="menu"
									aria-expanded={openMemberMenu === m.id}
									aria-label="Actions pour {m.displayName}"
								>
									⋯
								</button>
								{#if openMemberMenu === m.id}
									<div class="member-menu" role="menu" bind:this={memberMenuEl} style="top:{memberMenuPos.top}px; right:{memberMenuPos.right}px;">
										{#if !m.pending && m.role !== 'ADMIN'}
											<button type="button" class="member-menu-item" onclick={() => { accessModalFor = m.id; openMemberMenu = null; }}>
												🔐 Accès
												{#if m.canViewImputations || m.canViewMoodResults}<span class="access-dot"></span>{/if}
											</button>
										{/if}
										<form method="POST" action="?/memberInvite" use:enhance={() => { openMemberMenu = null; }}>
											<input type="hidden" name="userId" value={m.id} />
											<button type="submit" class="member-menu-item">{m.pending ? '↻ Régénérer le lien' : '🔑 Lien de réinitialisation'}</button>
										</form>
										{#if data.isOwner && !m.isOwner && m.active && !m.pending}
											<form
												method="POST"
												action="?/transferOwnership"
												use:enhance={async ({ cancel }) => {
													openMemberMenu = null;
													const ok = await confirmDialog({
														message: `Transmettre la propriété de l'espace à ${m.displayName} ? Vous resterez admin, mais perdrez la protection de créateur.`,
														confirmLabel: 'Transmettre'
													});
													if (!ok) cancel();
												}}
											>
												<input type="hidden" name="userId" value={m.id} />
												<button type="submit" class="member-menu-item">👑 Transmettre la propriété</button>
											</form>
										{/if}
										{#if !isSelf && !m.isOwner}
											<form method="POST" action="?/memberActive" use:enhance={() => { openMemberMenu = null; }}>
												<input type="hidden" name="userId" value={m.id} />
												<input type="hidden" name="active" value={m.active ? 'false' : 'true'} />
												<button type="submit" class="member-menu-item">{m.active ? '🚫 Désactiver' : '✓ Réactiver'}</button>
											</form>
											<form method="POST" action="?/memberFactice" use:enhance={() => { openMemberMenu = null; }}>
												<input type="hidden" name="userId" value={m.id} />
												<input type="hidden" name="factice" value={m.factice ? 'false' : 'true'} />
												<button type="submit" class="member-menu-item" title="Placeholder pour un arrangement entre projets (clôture) — exclu d'Objectifs de la semaine">{m.factice ? '↩ Retirer factice' : '🎭 Marquer factice'}</button>
											</form>
											{#if m.pending}
												<form
													method="POST"
													action="?/memberCancelInvite"
													use:enhance={async ({ cancel }) => {
														openMemberMenu = null;
														const ok = await confirmDialog({
															message: `Annuler l'invitation de ${m.displayName} ? Le lien envoyé ne fonctionnera plus.`,
															confirmLabel: 'Annuler l’invitation'
														});
														if (!ok) cancel();
													}}
												>
													<input type="hidden" name="userId" value={m.id} />
													<button type="submit" class="member-menu-item danger">🗑 Annuler l'invitation</button>
												</form>
											{/if}
										{/if}
									</div>
								{/if}
							</td>
						</tr>
					{/each}
					{#if filteredMembers.length === 0}
						<tr><td colspan="5" class="hint">Aucun résultat pour cette recherche.</td></tr>
					{/if}
				</tbody>
			</table>
			</div>
			</div>
		</section>
	{/if}

	<!-- Recherche + bascule d'ajout partagées par les 7 sections : sur une seule ligne plutôt que deux
	     champs empilés qui se distinguaient mal, le formulaire de création replié par défaut. -->
	{#snippet refToolbar(searchPlaceholder: string)}
		<div class="ref-toolbar">
			<input class="ref-search-input" type="search" placeholder={searchPlaceholder} bind:value={refSearch} bind:this={refSearchInput} />
			<button type="button" class="btn btn-ghost ref-add-toggle" aria-expanded={refAddOpen} onclick={() => (refAddOpen = !refAddOpen)}>
				{#if refAddOpen}
					Fermer <span class="ref-add-caret open">▾</span>
				{:else}
					+ Ajouter <span class="ref-add-caret">▾</span>
				{/if}
			</button>
		</div>
	{/snippet}

	{#snippet refBlock(title: string, type: 'project' | 'sprint' | 'version', placeholder: string, items: { id: string; name: string; archived: boolean; usage: number }[])}
		{@const filtered = items.filter((it) => refMatch(it.name))}
		<h3>{title}</h3>
		{#if form?.refOk === type}<div class="flash ok toast-tr" role="status">Mis à jour ✓</div>{/if}
		{@render refToolbar(`Rechercher ${title.toLowerCase()}…`)}
		{#if refAddOpen}
			<form method="POST" action="?/refCreate" use:enhance class="ref-add">
				<input type="hidden" name="type" value={type} />
				<input class="ref-input" name="name" placeholder={placeholder} required />
				<button class="btn btn-ghost" type="submit">+ Ajouter</button>
			</form>
		{/if}
		<div class="ref-list">
			{#each filtered as it (it.id)}
				<div class="ref-item" class:archived={it.archived}>
					<form method="POST" action="?/refRename" use:enhance={enhanceEdit}>
						<input type="hidden" name="type" value={type} />
						<input type="hidden" name="id" value={it.id} />
						<input
							class="ref-name"
							name="name"
							value={it.name}
							disabled={it.archived}
							onchange={(e) => e.currentTarget.form?.requestSubmit()}
						/>
					</form>
					{#if it.usage > 0}<span class="tag-usage" title="Tickets liés">{it.usage} ticket{it.usage > 1 ? 's' : ''}</span>{/if}
					<div class="ref-item-end">
						{#if it.archived}<span class="tag-arch">archivé</span>{/if}
						<form
							method="POST"
							action="?/refArchive"
							use:enhance={async ({ cancel }) => {
								if (!it.archived && it.usage > 0) {
									const ok = await confirmDialog(
										`${it.usage} ticket${it.usage > 1 ? 's' : ''} seront détachés à terme. Archiver quand même ?`
									);
									if (!ok) cancel();
								}
							}}
						>
							<input type="hidden" name="type" value={type} />
							<input type="hidden" name="id" value={it.id} />
							<input type="hidden" name="archived" value={it.archived ? 'false' : 'true'} />
							<button class="ref-btn" type="submit">{it.archived ? '↺ Restaurer' : '🗄 Archiver'}</button>
						</form>
					</div>
				</div>
			{/each}
			{#if filtered.length === 0}
				<p class="hint" style="margin:0;">{items.length === 0 ? "Aucun élément pour l'instant." : 'Aucun résultat pour cette recherche.'}</p>
			{/if}
		</div>
	{/snippet}

	{#if tab === 'referentiels'}
		<!-- Un seul bandeau pour tout l'onglet : sans lui, un refus du serveur (code SSP déjà pris,
		     catégorie en double…) était totalement silencieux — le champ gardait la saisie, la base
		     l'ancienne valeur, et on ne le découvrait qu'en revenant sur la page. -->
		{#if form?.error}<div class="flash error toast-tr" role="alert">{form.error}</div>{/if}
		<div class="ref-layout">
			<!-- Une section à la fois plutôt que les 7 cartes empilées d'avant : la liste la plus longue
			     ne désaligne plus ses voisines, et la recherche/l'ajout ci-dessous ciblent toujours la
			     bonne section sans avoir à la chercher sur la page. -->
			<nav class="ref-nav card" aria-label="Sections des référentiels">
				{#each REF_SECTIONS as s (s.key)}
					<button type="button" class:on={refSection === s.key} onclick={() => setRefSection(s.key)}>
						<span>{s.label}</span>
						<span class="ref-nav-count">{refSectionCount[s.key]}</span>
					</button>
				{/each}
			</nav>

			<section class="card block ref-panel">
				{#if refSection === 'projects'}
					{@render refBlock('Projets', 'project', 'Nouveau projet…', data.projects)}
				{:else if refSection === 'sprints'}
					{@render refBlock('Sprints', 'sprint', 'Nouveau sprint…', data.sprints)}
				{:else if refSection === 'versions'}
					{@render refBlock('Versions', 'version', 'Nouvelle version…', data.versions)}
				{:else if refSection === 'categories'}
					{@const filtered = data.categories.filter((c) => refMatch(c.label))}
					<h3>Catégories</h3>
					<p class="hint">Cibles d'imputation hors-ticket (MCO, congés, formation…). « Non productif » est exclu de la charge projet.</p>
					{#if form?.catOk}<div class="flash ok toast-tr" role="status">Mis à jour ✓</div>{/if}
					{@render refToolbar('Rechercher une catégorie…')}
					{#if refAddOpen}
						<form method="POST" action="?/catCreate" use:enhance class="ref-add">
							<input class="ref-input" name="label" placeholder="Nouvelle catégorie…" required />
							<select class="param-kind" name="kind">
								<option value="PRODUCTIVE">Productif</option>
								<option value="NON_PRODUCTIVE">Non productif</option>
							</select>
							<button class="btn btn-ghost" type="submit">+ Ajouter</button>
						</form>
					{/if}
					<div class="ref-list">
						{#each filtered as c (c.id)}
							<div class="ref-item" class:archived={c.archived}>
								<form method="POST" action="?/catRename" use:enhance={enhanceEdit}>
									<input type="hidden" name="id" value={c.id} />
									<input class="ref-name" name="label" value={c.label} disabled={c.archived} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
								</form>
								{#if c.usage > 0}<span class="tag-usage" title="Imputations liées">{c.usage} imp.</span>{/if}
								<form method="POST" action="?/catKind" use:enhance={enhanceEdit}>
									<input type="hidden" name="id" value={c.id} />
									<select class="param-kind" name="kind" value={c.kind} disabled={c.archived} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
										<option value="PRODUCTIVE">Productif</option>
										<option value="NON_PRODUCTIVE">Non productif</option>
									</select>
								</form>
								<div class="ref-item-end">
									{#if c.archived}<span class="tag-arch">archivé</span>{/if}
									{#if c.locked}
										<span class="ref-btn ref-btn-locked" title="Requise par le suivi des absences — ne peut pas être archivée">🔒 requis</span>
									{:else}
										<form
											method="POST"
											action="?/catArchive"
											use:enhance={async ({ cancel }) => {
												if (!c.archived && c.usage > 0) {
													const ok = await confirmDialog(
														`${c.usage} imputation${c.usage > 1 ? 's' : ''} seront supprimées à terme. Archiver quand même ?`
													);
													if (!ok) cancel();
												}
											}}
										>
											<input type="hidden" name="id" value={c.id} />
											<input type="hidden" name="archived" value={c.archived ? 'false' : 'true'} />
											<button class="ref-btn" type="submit">{c.archived ? '↺ Restaurer' : '🗄 Archiver'}</button>
										</form>
									{/if}
								</div>
							</div>
						{/each}
						{#if filtered.length === 0}
							<p class="hint" style="margin:0;">{data.categories.length === 0 ? 'Aucune catégorie.' : 'Aucun résultat pour cette recherche.'}</p>
						{/if}
					</div>
				{:else if refSection === 'ssp'}
					{@const filtered = data.ssps.filter((s) => refMatch(`${s.code} ${s.label}`))}
					<h3>Codes SSP</h3>
					<p class="hint">
						Codes budgétaires portés par les tickets. Le libellé est ce qu'on lit partout ailleurs
						(synthèse, clôture mensuelle) — le code reste la clé côté compta. Le budget est en jours.
					</p>
					{#if form?.sspOk}<div class="flash ok toast-tr" role="status">Mis à jour ✓</div>{/if}
					{@render refToolbar('Rechercher un code ou un libellé…')}
					{#if refAddOpen}
						<form method="POST" action="?/sspCreate" use:enhance class="ref-add ssp-add">
							<input class="ref-input ssp-code" name="code" placeholder="8364BEB5354" required />
							<input class="ref-input" name="label" placeholder="Site Internet" />
							<input class="ref-input ssp-budget" name="budgetDays" type="number" step="0.01" min="0" placeholder="budget (j)" />
							<button class="btn btn-ghost" type="submit">+ Ajouter</button>
						</form>
					{/if}
					<div class="ref-list">
						{#each filtered as s (s.id)}
							<div class="ref-item" class:archived={s.archived}>
								<!-- Un seul form pour les 3 champs : le code, le libellé et le budget se valident
								     ensemble (l'unicité porte sur le code, la modifier seule échouerait à mi-chemin). -->
								<form
									method="POST"
									action="?/sspUpdate"
									class="ssp-form"
									use:enhance={({ formElement }) =>
										async ({ result, update }) => {
											// reset: false — cf. enhanceEdit. Ici c'est critique : les 3 champs
											// partagent un form, donc éditer le libellé ressuscitait le code et le
											// budget du chargement initial, et les réécrivait en base à la validation
											// suivante.
											await update({ reset: false });
											// Refus du serveur : `update()` n'invalide pas le load, donc le champ garderait
											// la saisie rejetée pendant que la base garde l'ancienne valeur — l'écran
											// mentirait jusqu'au prochain changement de page.
											if (result.type === 'failure') {
												const f = formElement;
												(f.elements.namedItem('code') as HTMLInputElement).value = s.code;
												(f.elements.namedItem('label') as HTMLInputElement).value = s.label;
												(f.elements.namedItem('budgetDays') as HTMLInputElement).value =
													s.budgetDays === null ? '' : String(s.budgetDays);
											}
										}}
								>
									<input type="hidden" name="id" value={s.id} />
									<input
										class="ref-name ssp-code"
										name="code"
										value={s.code}
										disabled={s.archived}
										title="Code budgétaire"
										onchange={(e) => e.currentTarget.form?.requestSubmit()}
									/>
									<input
										class="ref-name"
										name="label"
										value={s.label}
										disabled={s.archived}
										placeholder="Libellé lisible…"
										onchange={(e) => e.currentTarget.form?.requestSubmit()}
									/>
									{#if s.usage > 0}<span class="tag-usage" title="Tickets liés">{s.usage} ticket{s.usage > 1 ? 's' : ''}</span>{/if}
									<input
										class="ref-name ssp-budget tabnum"
										name="budgetDays"
										type="number"
										step="0.01"
										min="0"
										value={s.budgetDays ?? ''}
										disabled={s.archived}
										placeholder="budget (j)"
										title="Budget alloué en jours"
										onchange={(e) => submitSoon(e.currentTarget.form!)}
									/>
								</form>
								<div class="ref-item-end">
									{#if s.archived}<span class="tag-arch">archivé</span>{/if}
									<form
										method="POST"
										action="?/sspArchive"
										use:enhance={async ({ cancel }) => {
											if (!s.archived && s.usage > 0) {
												const ok = await confirmDialog(
													`${s.usage} ticket${s.usage > 1 ? 's' : ''} perdront ce code SSP à terme. Archiver quand même ?`
												);
												if (!ok) cancel();
											}
										}}
									>
										<input type="hidden" name="id" value={s.id} />
										<input type="hidden" name="archived" value={s.archived ? 'false' : 'true'} />
										<button class="ref-btn" type="submit">{s.archived ? '↺ Restaurer' : '🗄 Archiver'}</button>
									</form>
								</div>
							</div>
						{/each}
						{#if filtered.length === 0}
							<p class="hint" style="margin:0;">{data.ssps.length === 0 ? 'Aucun code SSP.' : 'Aucun résultat pour cette recherche.'}</p>
						{/if}
					</div>
				{:else if refSection === 'activities'}
					{@const dragEnabled = refSearch.trim() === ''}
					{@const filtered = activityOrder.filter((a) => refMatch(a.label))}
					<h3>Activités</h3>
					<p class="hint">Nature du travail (Dev, TU, DA…), optionnelle sur une imputation. Glisse-dépose ⠿ pour réordonner : c'est cet ordre qui sert dans la répartition par activité des synthèses (sauf préférence "alphabétique" d'un membre dans ses paramètres de compte). Vide la recherche pour réordonner.</p>
					{#if form?.actOk}<div class="flash ok toast-tr" role="status">Mis à jour ✓</div>{/if}
					{@render refToolbar('Rechercher une activité…')}
					{#if refAddOpen}
						<form method="POST" action="?/actCreate" use:enhance class="ref-add">
							<input class="ref-input" name="label" placeholder="Nouvelle activité…" required />
							<button class="btn btn-ghost" type="submit">+ Ajouter</button>
						</form>
					{/if}
					<div class="ref-list">
						{#each filtered as a (a.id)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="ref-item"
								class:archived={a.archived}
								class:drag-over={dragOverActivityId === a.id && draggingActivityId !== a.id}
								ondragover={(e) => { if (dragEnabled) { e.preventDefault(); dragOverActivityId = a.id; } }}
								ondragleave={() => { if (dragOverActivityId === a.id) dragOverActivityId = null; }}
								ondrop={(e) => { e.preventDefault(); onActivityDrop(a.id); }}
							>
								<span
									class="drag-handle"
									draggable={dragEnabled}
									ondragstart={(e) => { draggingActivityId = a.id; e.dataTransfer?.setData('text/plain', a.id); }}
									ondragend={() => { draggingActivityId = null; dragOverActivityId = null; }}
									aria-label="Glisser pour réordonner {a.label}"
									title={dragEnabled ? undefined : 'Videz la recherche pour réordonner'}
									role="button"
									tabindex="-1"
								>⠿</span>
								<form method="POST" action="?/actRename" use:enhance={enhanceEdit}>
									<input type="hidden" name="id" value={a.id} />
									<input class="ref-name" name="label" value={a.label} disabled={a.archived} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
								</form>
								{#if a.usage > 0}<span class="tag-usage" title="Imputations liées">{a.usage} imp.</span>{/if}
								<div class="ref-item-end ref-item-end-wide">
									{#if a.archived}<span class="tag-arch">inactive</span>{/if}
									<form
										method="POST"
										action="?/actActive"
										use:enhance={async ({ cancel }) => {
											if (!a.archived) {
												const ok = await confirmDialog(
													'Désactiver cette activité ? Elle restera visible sur les imputations et tickets existants, mais ne sera plus proposée pour de nouvelles saisies.'
												);
												if (!ok) cancel();
											}
										}}
									>
										<input type="hidden" name="id" value={a.id} />
										<input type="hidden" name="active" value={a.archived ? 'true' : 'false'} />
										<button class="ref-btn" type="submit">{a.archived ? 'Activer' : 'Désactiver'}</button>
									</form>
									{#if a.usage === 0}
										<form
											method="POST"
											action="?/actDelete"
											use:enhance={async ({ cancel }) => {
												const ok = await confirmDialog({
													message: `Supprimer définitivement l'activité « ${a.label} » ?`,
													confirmLabel: 'Supprimer'
												});
												if (!ok) cancel();
											}}
										>
											<input type="hidden" name="id" value={a.id} />
											<button class="ref-btn ref-btn-danger" type="submit">Supprimer</button>
										</form>
									{/if}
								</div>
							</div>
						{/each}
						{#if filtered.length === 0}
							<p class="hint" style="margin:0;">{activityOrder.length === 0 ? 'Aucune activité.' : 'Aucun résultat pour cette recherche.'}</p>
						{:else if dragEnabled}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="drop-end"
								class:drag-over={dragOverActivityId === DROP_END}
								ondragover={(e) => { if (draggingActivityId) { e.preventDefault(); dragOverActivityId = DROP_END; } }}
								ondragleave={() => { if (dragOverActivityId === DROP_END) dragOverActivityId = null; }}
								ondrop={(e) => { e.preventDefault(); onActivityDrop(DROP_END); }}
							></div>
						{/if}
					</div>
				{:else if refSection === 'groups'}
					{@const dragEnabled = refSearch.trim() === ''}
					{@const filtered = groupOrder.filter((g) => refMatch(g.label))}
					<h3>Groupes de tickets</h3>
					<p class="hint">Regroupement libre et transverse, indépendant des sprints/versions. Un ticket peut appartenir à plusieurs groupes. Glisse-dépose ⠿ pour réordonner : c'est cet ordre qui sert dans les synthèses par sprint/version. Vide la recherche pour réordonner.</p>
					{#if form?.groupOk}<div class="flash ok toast-tr" role="status">Mis à jour ✓</div>{/if}
					{@render refToolbar('Rechercher un groupe…')}
					{#if refAddOpen}
						<form method="POST" action="?/groupCreate" use:enhance class="ref-add">
							<input class="ref-input" name="label" placeholder="Nouveau groupe…" required />
							<button class="btn btn-ghost" type="submit">+ Ajouter</button>
						</form>
					{/if}
					<div class="ref-list">
						{#each filtered as g (g.id)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="ref-item"
								class:archived={g.archived}
								class:drag-over={dragOverGroupId === g.id && draggingGroupId !== g.id}
								ondragover={(e) => { if (dragEnabled) { e.preventDefault(); dragOverGroupId = g.id; } }}
								ondragleave={() => { if (dragOverGroupId === g.id) dragOverGroupId = null; }}
								ondrop={(e) => { e.preventDefault(); onGroupDrop(g.id); }}
							>
								<span
									class="drag-handle"
									draggable={dragEnabled}
									ondragstart={(e) => { draggingGroupId = g.id; e.dataTransfer?.setData('text/plain', g.id); }}
									ondragend={() => { draggingGroupId = null; dragOverGroupId = null; }}
									aria-label="Glisser pour réordonner {g.label}"
									title={dragEnabled ? undefined : 'Videz la recherche pour réordonner'}
									role="button"
									tabindex="-1"
								>⠿</span>
								<form method="POST" action="?/groupRename" use:enhance={enhanceEdit}>
									<input type="hidden" name="id" value={g.id} />
									<input class="ref-name" name="label" value={g.label} disabled={g.archived} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
								</form>
								{#if g.usage > 0}<span class="tag-usage" title="Tickets liés">{g.usage} ticket{g.usage > 1 ? 's' : ''}</span>{/if}
								<div class="ref-item-end">
									{#if g.archived}<span class="tag-arch">inactif</span>{/if}
									<form method="POST" action="?/groupArchive" use:enhance>
										<input type="hidden" name="id" value={g.id} />
										<input type="hidden" name="archived" value={g.archived ? 'false' : 'true'} />
										<button class="ref-btn" type="submit">{g.archived ? 'Activer' : 'Désactiver'}</button>
									</form>
								</div>
							</div>
						{/each}
						{#if filtered.length === 0}
							<p class="hint" style="margin:0;">{groupOrder.length === 0 ? 'Aucun groupe.' : 'Aucun résultat pour cette recherche.'}</p>
						{:else if dragEnabled}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="drop-end"
								class:drag-over={dragOverGroupId === DROP_END}
								ondragover={(e) => { if (draggingGroupId) { e.preventDefault(); dragOverGroupId = DROP_END; } }}
								ondragleave={() => { if (dragOverGroupId === DROP_END) dragOverGroupId = null; }}
								ondrop={(e) => { e.preventDefault(); onGroupDrop(DROP_END); }}
							></div>
						{/if}
					</div>
				{/if}
			</section>
		</div>
	{/if}

	{#if tab === 'workflow'}
		<section class="card block">
			<h3>États du workflow</h3>
			<p class="hint">Statuts des tickets (et colonnes du Kanban). Réordonne avec ▲▼ ; emoji et couleur servent de pastille partout.</p>
			{#if form?.stateOk}<div class="flash ok">Mis à jour ✓</div>{/if}
			<div class="state-list">
				{#each data.states as s, i (s.id)}
					<div class="state-row">
						<div class="state-order">
							<form method="POST" action="?/stateMove" use:enhance>
								<input type="hidden" name="id" value={s.id} />
								<input type="hidden" name="dir" value="up" />
								<button class="ord-btn" type="submit" disabled={i === 0} aria-label="Monter">▲</button>
							</form>
							<form method="POST" action="?/stateMove" use:enhance>
								<input type="hidden" name="id" value={s.id} />
								<input type="hidden" name="dir" value="down" />
								<button class="ord-btn" type="submit" disabled={i === data.states.length - 1} aria-label="Descendre">▼</button>
							</form>
						</div>
						<form class="state-edit" method="POST" action="?/stateUpdate" use:enhance={enhanceEdit}>
							<input type="hidden" name="id" value={s.id} />
							<input class="state-color" type="color" name="color" value={s.color ?? '#94A3B8'} onchange={(e) => e.currentTarget.form?.requestSubmit()} aria-label="Couleur" />
							<input class="state-emoji" name="emoji" value={s.emoji ?? ''} maxlength="4" placeholder="🏷️" onchange={(e) => e.currentTarget.form?.requestSubmit()} aria-label="Emoji" />
							<input class="ref-name state-label" name="label" value={s.label} onchange={(e) => e.currentTarget.form?.requestSubmit()} aria-label="Libellé" />
						</form>
						{#if s.usage > 0}<span class="tag-usage" title="Tickets dans cet état">{s.usage} tk</span>{/if}
						<form
							method="POST"
							action="?/stateDelete"
							use:enhance={async ({ cancel }) => {
								if (s.usage > 0) {
									const ok = await confirmDialog(
										`${s.usage} ticket${s.usage > 1 ? 's' : ''} perdront cet état. Supprimer quand même ?`
									);
									if (!ok) cancel();
								}
							}}
						>
							<input type="hidden" name="id" value={s.id} />
							<button class="ref-btn" type="submit">🗑 Supprimer</button>
						</form>
					</div>
				{/each}
				{#if data.states.length === 0}<p class="hint" style="margin:0;">Aucun état.</p>{/if}
			</div>
			<form class="state-add" method="POST" action="?/stateCreate" use:enhance>
				<input class="state-color" type="color" name="color" value="#94A3B8" aria-label="Couleur" />
				<input class="state-emoji" name="emoji" maxlength="4" placeholder="🏷️" aria-label="Emoji" />
				<input class="ref-input" name="label" placeholder="Nouvel état…" required />
				<button class="btn btn-ghost" type="submit">+ Ajouter</button>
			</form>
		</section>
	{/if}

	{#if tab === 'support'}
		<section class="card block">
			<h3>Support</h3>
			<p class="hint">
				Désigne à tour de rôle qui suit les tickets du support, selon la cadence choisie. La page est visible dans
				« Mon espace » une fois activée.
			</p>
			{#if form?.supportOk}<div class="flash ok">Réglage mis à jour ✓</div>{/if}

			<form method="POST" action="?/supportEnabled" use:enhance>
				<input type="hidden" name="enabled" value={String(!data.support.enabled)} />
				<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:6px;">
					<span>Support actuellement <b>{data.support.enabled ? 'activé' : 'désactivé'}</b></span>
					<button class="btn {data.support.enabled ? 'btn-ghost' : 'btn-primary'}" type="submit">
						{data.support.enabled ? 'Désactiver' : 'Activer'}
					</button>
				</div>
			</form>

			<form method="POST" action="?/supportCadence" use:enhance={enhanceEdit} style="margin-top:14px;">
				<div class="field">
					<label for="support-cadence">Cadence de rotation</label>
					<select
						id="support-cadence"
						name="cadence"
						value={data.support.cadence}
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
					>
						{#each SUPPORT_CADENCES as c (c.value)}
							<option value={c.value}>{c.label}</option>
						{/each}
					</select>
				</div>
			</form>

			<form method="POST" action="?/supportIncludeSaturday" use:enhance style="margin-top:14px;">
				<input type="hidden" name="includeSaturday" value={String(!data.support.includeSaturday)} />
				<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;">
					<span
						>Samedi <b>{data.support.includeSaturday ? 'inclus' : 'exclu'}</b> de la perm
						<span class="hint" style="margin:2px 0 0;">En cadence « Chaque jour », détermine si le samedi compte comme un jour de rotation (le dimanche n'est jamais inclus).</span>
					</span>
					<button class="btn btn-ghost" type="submit">
						{data.support.includeSaturday ? 'Exclure' : 'Inclure'}
					</button>
				</div>
			</form>
		</section>

		<section class="card block">
			<h3>Ordre de rotation</h3>
			<p class="hint">Réordonne avec ▲▼. La personne du jour/de la semaine/du mois tourne automatiquement dans cet ordre.</p>
			<div class="state-list">
				{#each data.supportMembers as m, i (m.id)}
					<div class="state-row">
						<div class="state-order">
							<form method="POST" action="?/supportMemberMove" use:enhance>
								<input type="hidden" name="id" value={m.id} />
								<input type="hidden" name="dir" value="up" />
								<button class="ord-btn" type="submit" disabled={i === 0} aria-label="Monter">▲</button>
							</form>
							<form method="POST" action="?/supportMemberMove" use:enhance>
								<input type="hidden" name="id" value={m.id} />
								<input type="hidden" name="dir" value="down" />
								<button class="ord-btn" type="submit" disabled={i === data.supportMembers.length - 1} aria-label="Descendre">▼</button>
							</form>
						</div>
						<span class="ref-name">{m.displayName}</span>
						<form method="POST" action="?/supportMemberRemove" use:enhance>
							<input type="hidden" name="id" value={m.id} />
							<button class="ref-btn" type="submit">🗑 Retirer</button>
						</form>
					</div>
				{/each}
				{#if data.supportMembers.length === 0}<p class="hint" style="margin:0;">Personne dans la rotation.</p>{/if}
			</div>
			<form
				class="state-add"
				method="POST"
				action="?/supportMemberAdd"
				use:enhance={() => async ({ update }) => { newRotationUserId = ''; update(); }}
			>
				<select class="ref-input" name="userId" bind:value={newRotationUserId} required>
					<option value="" disabled>Ajouter un membre…</option>
					{#each rotationCandidates as m (m.id)}
						<option value={m.id}>{m.displayName}</option>
					{/each}
				</select>
				<button class="btn btn-ghost" type="submit" disabled={!newRotationUserId}>+ Ajouter</button>
			</form>
		</section>
	{/if}

	{#if tab === 'jira'}
		<section class="card block">
			<h3>Intégration Jira</h3>
			<p class="hint">Pull planifié + forçage manuel des tickets Jira, propre à cet espace.</p>
			{#if form?.error}<div class="flash error toast-tr" role="alert">{form.error}</div>{/if}
			{#if form?.jiraSaveOk}<div class="flash ok toast-tr" role="status">Configuration enregistrée ✓</div>{/if}

			{#if !jiraConfigured || jiraEditing}
				<form
					method="POST"
					action="?/jiraSave"
					use:enhance={() => async ({ result, update }) => {
						await update({ reset: false });
						if (result.type === 'success') {
							jiraEditing = false;
							jiraPatEditing = false;
						}
					}}
					class="jira-steps"
				>
					<div class="step">
						<div class="step-num">1</div>
						<div class="step-body">
							<h4>Connexion</h4>
							<div class="field">
								<label for="jira-jql">Filtre JQL</label>
								<input id="jira-jql" name="jql" value={data.jira.jql} placeholder="project = CARTEJEUNE_BLM" />
								<p class="hint" style="margin:6px 0 0;">Ne doit pas contenir ORDER BY (inutile ici, incompatible avec la date minimum ci-dessous).</p>
							</div>
							<div class="field-row">
								<div class="field">
									<label for="jira-updated-since">Date minimum de mise à jour (optionnel)</label>
									<input id="jira-updated-since" name="updatedSinceDate" type="date" />
									<p class="hint pat-meta">
										{#if data.jira.updatedSince}
											Actuelle : <b>{formatDateTime(new Date(data.jira.updatedSince))}</b>
										{:else}
											Aucune limite
										{/if}
									</p>
								</div>
								<div class="field">
									<label for="jira-created-since">Date de création minimum (optionnel)</label>
									<input id="jira-created-since" name="createdSinceDate" type="date" />
									<p class="hint pat-meta">
										{#if data.jira.createdSince}
											Actuelle : <b>{formatDateTime(new Date(data.jira.createdSince))}</b>
										{:else}
											Exclut les tickets créés avant cette date, même mis à jour depuis
										{/if}
									</p>
								</div>
							</div>
							<div class="field">
								<label for="jira-pat">Token Jira (PAT)</label>
								{#if data.jira.patConfigured && !jiraPatEditing}
									<div class="jira-pat-summary">
										<div class="jira-pat-summary-info">
											<span class="pill active">✓ Configuré</span>
											{#if data.jira.patUpdatedByName && data.jira.patUpdatedAt}
												<span class="hint">Modifié par {data.jira.patUpdatedByName} le {formatDateTime(new Date(data.jira.patUpdatedAt))}</span>
											{/if}
										</div>
										<button type="button" class="btn btn-ghost" onclick={() => (jiraPatEditing = true)}>Changer le token</button>
									</div>
								{:else}
									<input id="jira-pat" name="pat" type="password" autocomplete="new-password" placeholder="Coller le token ici" />
									{#if data.jira.patConfigured}
										<p class="hint pat-meta">Laisser vide pour ne pas changer.</p>
									{:else}
										<p class="hint pat-meta">Aucun token enregistré pour l'instant.</p>
									{/if}
								{/if}
							</div>
						</div>
					</div>

					<div class="step">
						<div class="step-num">2</div>
						<div class="step-body">
							<h4>En cas de conflit sur une clé déjà connue</h4>
							<div class="field">
								<select id="jira-conflict" name="conflictStrategy" value={data.jira.conflictStrategy}>
									<option value="KEEP_LOCAL">Garder les tickets existants tels quels</option>
									<option value="JIRA_WINS">Jira fait autorité (écrase les champs cochés ci-dessous)</option>
								</select>
								<p class="hint" style="margin:6px 0 0;">
									L'estimation, le RAE et le workflow restent toujours saisis à la main, quelle que soit
									l'option — seuls les champs cochés ci-dessous peuvent venir de Jira.
								</p>
							</div>
							<div class="field">
								<label for="jira-sync-title">Champs synchronisés depuis Jira</label>
								<div class="jira-sync-fields">
									<label class="jira-sync-field">
										<input id="jira-sync-title" type="checkbox" name="syncTitle" checked={data.jira.syncTitle} />
										<span>Titre</span>
									</label>
									<label class="jira-sync-field">
										<input type="checkbox" name="syncProject" checked={data.jira.syncProject} />
										<span>Projet</span>
									</label>
									<label class="jira-sync-field">
										<input type="checkbox" name="syncParent" checked={data.jira.syncParent} />
										<span>Parent (sous-tâche)</span>
									</label>
									<label class="jira-sync-field">
										<input type="checkbox" name="syncSprint" checked={data.jira.syncSprint} />
										<span>Sprint</span>
									</label>
									<label class="jira-sync-field">
										<input type="checkbox" name="syncVersion" checked={data.jira.syncVersion} />
										<span>Version</span>
									</label>
								</div>
								<p class="hint" style="margin:6px 0 0;">
									Un champ décoché n'est plus jamais mis à jour par le sync — sauf le titre, toujours posé
									à la création d'un nouveau ticket (impossible d'en créer un sans titre).
								</p>
							</div>
						</div>
					</div>

					<div class="step">
						<div class="step-num">3</div>
						<div class="step-body">
							<details class="step-details" open={!!data.jira.regexPattern}>
								<summary>Réconciliation des clés <span class="step-optional">optionnel</span></summary>
								<p class="hint">
									Si la clé renvoyée par Jira ne correspond pas à celle déjà utilisée dans l'app (ex.
									<code>CARTEJEUNE_BLM-123</code> côté Jira vs <code>BLM-123</code> ici), un motif à
									rechercher/remplacer les fait correspondre avant tout rapprochement.
								</p>
								<div class="field">
									<label for="jira-regex-pattern">Motif à rechercher (regex)</label>
									<input id="jira-regex-pattern" name="regexPattern" bind:value={jiraRegexPattern} placeholder="^CARTEJEUNE_" />
								</div>
								<div class="field">
									<label for="jira-regex-replacement">Remplacement</label>
									<input id="jira-regex-replacement" name="regexReplacement" bind:value={jiraRegexReplacement} placeholder="(laisser vide pour supprimer)" />
								</div>
								<div class="field">
									<label for="jira-regex-sample">Tester avec une clé exemple</label>
									<input id="jira-regex-sample" bind:value={jiraSampleKey} />
								</div>
								<p class="regex-preview">
									{#if jiraSampleResult === null}
										<span class="err-text">Regex invalide.</span>
									{:else}
										→ <b>{jiraSampleResult}</b>
									{/if}
								</p>
							</details>
						</div>
					</div>

					<div class="jira-form-actions">
						<button class="btn btn-primary" type="submit">Enregistrer</button>
						{#if jiraConfigured}
							<button type="button" class="btn btn-ghost" onclick={() => { jiraEditing = false; jiraPatEditing = false; }}>Annuler</button>
						{/if}
					</div>
				</form>
			{:else}
				<div class="jira-config-summary">
					<span class="pill active">✓ Configuré</span>
					<button type="button" class="btn btn-ghost" onclick={() => (jiraEditing = true)}>Éditer la configuration</button>
				</div>
			{/if}
		</section>

		<section class="card block">
			<h3>Activation</h3>

			{#if jiraAutoDisabled}
				<div class="flash warn">
					Synchronisation désactivée automatiquement après {data.jira.consecutiveFailures} échecs
					d'authentification consécutifs. Vérifie/renouvelle le token ci-dessus, puis réactive-la.
				</div>
			{/if}
			{#if form?.jiraToggleOk}<div class="flash ok">Réglage mis à jour ✓</div>{/if}

			<form method="POST" action="?/jiraToggleEnabled" use:enhance>
				<input type="hidden" name="enabled" value={String(!data.jira.enabled)} />
				<div class="row-between">
					<span>Synchronisation planifiée actuellement <b>{data.jira.enabled ? 'activée' : 'désactivée'}</b></span>
					<button class="btn {data.jira.enabled ? 'btn-ghost' : 'btn-primary'}" type="submit">
						{data.jira.enabled ? 'Désactiver' : 'Activer'}
					</button>
				</div>
			</form>

			<div class="sync-status">
				{#if data.jira.lastSyncAt}
					<span>
						Dernier run : <b>{formatDateTime(new Date(data.jira.lastSyncAt))}</b>
						{#if data.jira.lastSyncStatus === 'SUCCESS'}
							<span class="pill active">✓ {data.jira.lastSyncTicketCount} ticket{(data.jira.lastSyncTicketCount ?? 0) > 1 ? 's' : ''}</span>
						{:else}
							<span class="pill pending">✗ échec</span>
						{/if}
					</span>
					{#if data.jira.lastSyncStatus === 'ERROR' && data.jira.lastSyncError}
						<p class="hint err-text">{data.jira.lastSyncError}</p>
					{/if}
				{:else}
					<span class="hint">Aucun run pour l'instant.</span>
				{/if}
				<p class="hint" style="margin:8px 0 0;">
					Filtré depuis :
					<b>{data.jira.updatedSince ? formatDateTime(new Date(data.jira.updatedSince)) : "aucune limite pour l'instant"}</b>
				</p>
				<p class="hint" style="margin:4px 0 0;">
					Créés depuis :
					<b>{data.jira.createdSince ? formatDateTime(new Date(data.jira.createdSince)) : "aucune limite pour l'instant"}</b>
				</p>
			</div>

			{#if form?.jiraResetSinceOk}<div class="flash ok">Réinitialisé ✓</div>{/if}
			{#if form?.jiraResetCreatedSinceOk}<div class="flash ok">Réinitialisé ✓</div>{/if}
			{#if form?.jiraSyncOk}<div class="flash ok">Sync manuel terminé ✓ ({form.jiraTicketsUpserted} ticket{form.jiraTicketsUpserted > 1 ? 's' : ''})</div>{/if}
			<div class="jira-force-actions">
				{#if data.jira.updatedSince}
					<form
						method="POST"
						action="?/jiraResetUpdatedSince"
						use:enhance={async ({ cancel }) => {
							const ok = await confirmDialog({
								message: 'Le prochain run Jira re-téléchargera tous les tickets du filtre JQL. Continuer ?',
								confirmLabel: 'Réinitialiser'
							});
							if (!ok) cancel();
						}}
					>
						<button type="submit" class="btn btn-ghost">Réinitialiser le filtre de date</button>
					</form>
				{/if}

				{#if data.jira.createdSince}
					<form method="POST" action="?/jiraResetCreatedSince" use:enhance>
						<button type="submit" class="btn btn-ghost">Retirer la date de création minimum</button>
					</form>
				{/if}

				<form
					method="POST"
					action="?/jiraSyncNow"
					use:enhance={() => {
						jiraSyncing = true;
						return async ({ update }) => {
							await update();
							jiraSyncing = false;
						};
					}}
				>
					<button class="btn btn-ghost" type="submit" disabled={jiraSyncing}>
						{jiraSyncing ? 'Synchronisation…' : 'Forcer le sync maintenant'}
					</button>
				</form>
			</div>
		</section>

		<section class="card block">
			<h3>Historique des synchronisations</h3>
			{#if form?.jiraUndoOk}
				<div class="flash ok">{form.jiraUndoDeleted} ticket{form.jiraUndoDeleted > 1 ? 's' : ''} supprimé{form.jiraUndoDeleted > 1 ? 's' : ''} ✓</div>
			{/if}

			{#if data.jiraSyncRuns.length === 0}
				<span class="hint">Aucun run pour l'instant.</span>
			{:else}
				<ul class="jira-run-list">
					{#each data.jiraSyncRuns as run (run.id)}
						<li class="jira-run-row">
							<div class="row-between">
								<span>
									<b>{formatDateTime(new Date(run.startedAt))}</b>
									{#if run.status === 'SUCCESS'}
										<span class="pill active">
											✓ {run.ticketsSeen} vu{run.ticketsSeen > 1 ? 's' : ''}{#if run.ticketsCreated > 0}
												&nbsp;· {run.ticketsCreated} ajouté{run.ticketsCreated > 1 ? 's' : ''}
											{/if}
										</span>
									{:else}
										<span class="pill pending">✗ échec</span>
									{/if}
								</span>
								{#if run.ticketsCreated > 0}
									<div class="jira-run-actions">
										<a class="btn btn-ghost" href="/tickets?jiraRun={run.id}">Voir les tickets</a>
										{#if run.undoneAt}
											<span class="hint" style="margin:0;">Lot annulé le {formatDateTime(new Date(run.undoneAt))}</span>
										{:else}
											<form
												method="POST"
												action="?/jiraUndoSyncRun"
												use:enhance={async ({ cancel }) => {
													const ok = await confirmDialog({
														message:
															'Supprime les tickets de ce lot encore vierges de toute saisie (imputation, chiffrage, état…). Un ticket déjà touché depuis le sync est automatiquement conservé.',
														confirmLabel: 'Annuler ce lot'
													});
													if (!ok) cancel();
												}}
											>
												<input type="hidden" name="runId" value={run.id} />
												<button type="submit" class="btn btn-ghost">Annuler ce lot</button>
											</form>
										{/if}
									</div>
								{/if}
							</div>
							{#if run.status === 'ERROR' && run.error}<p class="hint err-text">{run.error}</p>{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if tab === 'general'}
		<section class="card block export-block">
			<div>
				<h3>Export Excel</h3>
				<p class="hint" style="margin-bottom:0;">Classeur complet (synthèse, par projet/sprint, par activité, par personne, paramétrage…). Le <b>consommé</b> est borné sur la période choisie (par défaut le dernier mois) ; le chiffrage reste l'état courant.</p>
			</div>
			<ExportModal label="Télécharger l'Excel" />
		</section>

		<div class="cols-2">
			<section class="card block">
				<h3>Couleur de l'espace</h3>
				<p class="hint">Personnalise l'accent de toute l'interface pour cet espace.</p>
				{#if form?.accentOk}<div class="flash ok">Couleur mise à jour ✓ (rechargez pour l'appliquer partout)</div>{/if}
				<form method="POST" action="?/accent" use:enhance>
					<AccentPicker bind:color={accent} bind:rgbMode bind:discoMode presets={PRESETS} />
					<input type="hidden" name="color" value={accent} />
					<input type="hidden" name="rgb" value={rgbMode} />
					<input type="hidden" name="disco" value={discoMode} />
					{#if rgbMode}<p class="hint" style="margin:8px 0 0;">Le mode RGB fait défiler l'accent en continu sur toute l'interface, une fois enregistré.</p>{/if}
					{#if discoMode}<p class="hint" style="margin:8px 0 0;">Le mode Disco fait sauter l'accent à une couleur aléatoire, sans transition, une fois enregistré.</p>{/if}
					<button class="btn btn-primary" type="submit" style="margin-top:14px;">Enregistrer la couleur</button>
				</form>
			</section>

			<section class="card block">
				<h3>Phase Test</h3>
				<p class="hint">Quand elle est désactivée, les champs <b>Est. / RAE Test</b>, <b>Prépa</b> et les indicateurs qualité (Cypress, Doc tech., Prépa qualif) disparaissent des écrans et de l'export ; les totaux ne comptent que la Réalisation.</p>
				{#if form?.testPhaseOk}<div class="flash ok">Réglage mis à jour ✓ (rechargez les autres onglets)</div>{/if}
				<form method="POST" action="?/testPhase" use:enhance>
					<input type="hidden" name="enabled" value={String(!data.testPhase)} />
					<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:6px;">
						<span>Phase Test actuellement <b>{data.testPhase ? 'activée' : 'désactivée'}</b></span>
						<button class="btn {data.testPhase ? 'btn-ghost' : 'btn-primary'}" type="submit">
							{data.testPhase ? 'Désactiver' : 'Activer'}
						</button>
					</div>
				</form>
			</section>

			<section class="card block">
				<h3>Team mood</h3>
				<p class="hint">
					Chaque membre vote une fois par plage (1-5, anonyme, modifiable tant que la plage est active). Les résultats
					agrégés sont visibles uniquement par les admins, sur <a href="/admin/mood">la page dédiée</a>.
				</p>
				{#if form?.moodOk}<div class="flash ok">Réglage mis à jour ✓</div>{/if}

				<form method="POST" action="?/moodEnabled" use:enhance>
					<input type="hidden" name="enabled" value={String(!data.mood.enabled)} />
					<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:6px;">
						<span>Team mood actuellement <b>{data.mood.enabled ? 'activé' : 'désactivé'}</b></span>
						<button class="btn {data.mood.enabled ? 'btn-ghost' : 'btn-primary'}" type="submit">
							{data.mood.enabled ? 'Désactiver' : 'Activer'}
						</button>
					</div>
				</form>

				<form
					method="POST"
					action="?/moodConfig"
					use:enhance={() => async ({ update }) => update({ reset: false })}
					style="margin-top:14px;"
				>
					<div class="field">
						<label for="mood-period">Durée de la plage</label>
						<select id="mood-period" name="periodKind" bind:value={moodPeriodKind}>
							{#each MOOD_PERIODS as p (p.value)}
								<option value={p.value}>{p.label}</option>
							{/each}
						</select>
					</div>
					{#if moodPeriodKind !== 'MONTH'}
						<div class="field">
							<label for="mood-weekday">Jour de départ de chaque plage</label>
							<select id="mood-weekday" name="startWeekday" bind:value={moodStartWeekday}>
								{#each WEEKDAYS as w, i (i)}
									<option value={i}>{w}</option>
								{/each}
							</select>
						</div>
					{/if}
					<button class="btn btn-ghost" type="submit">Enregistrer</button>
				</form>
			</section>

			<section class="card block">
				<h3>Budget &amp; imputation</h3>
				<p class="hint">
					<b>PPR</b> = Estimation Réelle × ratio, calculé à la volée sur chaque ticket. <b>Pas d'imputation</b> = le pas
					de saisie proposé dans la grille (0.25 = quart de jour).
				</p>
				{#if form?.pprRatioOk || form?.imputationStepOk}<div class="flash ok">Réglage mis à jour ✓</div>{/if}
				<div style="display:flex;flex-direction:column;gap:14px;margin-top:6px;">
					<form method="POST" action="?/pprRatio" use:enhance={enhanceEdit} style="display:flex;align-items:center;justify-content:space-between;gap:14px;">
						<span>Ratio PPR</span>
						<div style="display:flex;align-items:center;gap:8px;">
							<input class="cap-input" type="number" name="value" min="0.01" max="1" step="0.05" value={data.pprRatio} />
							<button class="btn btn-ghost" type="submit">Enregistrer</button>
						</div>
					</form>
					<form method="POST" action="?/imputationStep" use:enhance={enhanceEdit} style="display:flex;align-items:center;justify-content:space-between;gap:14px;">
						<span>Pas d'imputation</span>
						<div style="display:flex;align-items:center;gap:8px;">
							<input class="cap-input" type="number" name="value" min="0.00" max="1" step="any" value={data.imputationStep} />
							<button class="btn btn-ghost" type="submit">Enregistrer</button>
						</div>
					</form>
				</div>
			</section>
		</div>
	{/if}
</div>

{#if accessModalMember}
	<MemberAccessModal member={accessModalMember} onclose={() => (accessModalFor = null)} />
{/if}

<style>
	.admin {
		max-width: 1180px;
	}
	.tabs {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		border-radius: 30px;
		background: var(--surface-sunk);
		border: 1px solid var(--border);
		margin-bottom: 18px;
	}
	@media (max-width: 640px) {
		.tabs {
			display: flex;
			max-width: 100%;
			overflow-x: auto;
		}
		.tabs button {
			flex-shrink: 0;
		}
	}
	.tabs button {
		padding: 8px 18px;
		border-radius: 30px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.tabs button.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	.block {
		padding: 22px;
		margin-bottom: 18px;
	}
	/* Couleur / Phase Test / Mood / Budget côte à côte */
	.cols-2 {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 18px;
		align-items: start;
		margin-bottom: 18px;
	}
	.cols-2 .block {
		margin-bottom: 0;
		height: 100%;
	}
	@media (max-width: 820px) {
		.cols-2 {
			grid-template-columns: 1fr;
		}
	}
	.export-block {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
	}
	.block h3 {
		font-family: var(--font-display);
		font-size: 18px;
		font-weight: 600;
		margin-bottom: 4px;
	}
	.hint {
		color: var(--text-mute);
		font-size: 13px;
		margin-bottom: 16px;
	}
	.invite-row {
		display: grid;
		grid-template-columns: 1fr 1.4fr 130px auto;
		gap: 12px;
		align-items: end;
	}
	.invite-row .field {
		margin-bottom: 0;
	}
	.invite-row button {
		height: 42px;
	}
	@media (max-width: 640px) {
		.invite-row {
			grid-template-columns: 1fr;
		}
		.invite-row button {
			height: auto;
		}
	}
	.invite-msg {
		margin-top: 16px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		overflow: hidden;
	}
	.invite-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		background: var(--surface-2);
	}
	.invite-subject {
		padding: 10px 14px;
		font-weight: 600;
		font-size: 13px;
		border-top: 1px solid var(--border);
	}
	.invite-msg pre {
		padding: 14px;
		font-family: var(--font-ui);
		font-size: 13px;
		white-space: pre-wrap;
		color: var(--text-soft);
		border-top: 1px solid var(--border);
		background: var(--surface-2);
	}
	/* `clip` (pas de scroll ici) pour ne rogner qu'au rayon de la card ; le scroll horizontal reste
	   local à .members-scroll, comme .tk-card/.tk-scroll dans tickets/+page.svelte. */
	.members-wrap {
		position: relative;
		overflow: clip;
	}
	.members-scroll {
		overflow-x: auto;
		overflow-y: visible;
	}
	.members-wrap::after {
		content: '';
		display: none;
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 28px;
		pointer-events: none;
		background: linear-gradient(to right, transparent, var(--surface) 70%);
	}
	@media (max-width: 900px) {
		.members-wrap::after {
			display: block;
		}
	}
	.block-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 10px;
	}
	.block-head h3 {
		margin: 0;
	}
	table.members {
		width: 100%;
		min-width: 640px;
		border-collapse: collapse;
	}
	.members td {
		padding: 10px 6px;
		border-top: 1px solid var(--border);
	}
	.members tr:first-child td {
		border-top: none;
	}
	/* Sépare visuellement le groupe des désactivés, renvoyés en bas de liste (cf. filteredMembers). */
	.member-sep td {
		padding: 8px 6px 4px;
		border-top: none;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-mute);
	}
	.mc {
		display: flex;
		align-items: center;
		gap: 11px;
	}
	.mc b {
		display: block;
		font-size: 13.5px;
		font-weight: 600;
	}
	.mc span {
		font-size: 12px;
		color: var(--text-mute);
	}
	.pill.pending {
		background: var(--warn-tint);
		color: var(--warn);
	}
	.pill.active {
		background: var(--accent-tint);
		color: var(--accent-ink);
	}
	.pill.off {
		background: var(--surface-sunk);
		color: var(--text-mute);
	}
	.pill.owner {
		background: color-mix(in srgb, #CA8A04 18%, transparent);
		color: #CA8A04;
	}
	.members tr.inactive td {
		opacity: 0.6;
	}
	.you {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--accent-ink);
		background: var(--accent-tint);
		padding: 1px 6px;
		border-radius: 20px;
		vertical-align: middle;
		margin-left: 6px;
	}
	.factice-tag {
		color: var(--text-mute);
		background: var(--surface-sunk);
	}
	.role-sel {
		padding: 5px 9px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 12.5px;
	}
	.role-sel:focus {
		outline: none;
		border-color: var(--accent);
	}
	.param-kind {
		padding: 6px 9px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 12.5px;
		flex-shrink: 0;
	}
	.param-kind:focus {
		outline: none;
		border-color: var(--accent);
	}
	.param-kind:disabled {
		opacity: 0.6;
	}
	.m-actions {
		text-align: right;
	}
	.member-menu-trigger {
		font-size: 15px;
		line-height: 1;
		padding: 6px 12px;
	}
	.member-menu {
		position: fixed;
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 220px;
		padding: 6px;
		border-radius: var(--r-md, 10px);
		border: 1px solid var(--border);
		background: var(--surface);
		box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
	}
	.member-menu-item {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 7px 9px;
		border-radius: 8px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-soft);
		text-align: left;
		white-space: nowrap;
	}
	.member-menu-item:hover {
		background: var(--accent-tint, var(--surface-2));
		color: var(--text);
	}
	.member-menu-item.danger:hover {
		background: rgba(192, 57, 43, 0.12);
		color: #c0392b;
	}
	.cap-form {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.cap-input {
		width: 64px;
		padding: 5px 8px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 12.5px;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.cap-input:focus {
		outline: none;
		border-color: var(--accent);
	}
	.cap-unit {
		font-size: 11px;
		color: var(--text-mute);
	}
	.access-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
		margin-left: 5px;
	}

	/* États du workflow */
	.state-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 14px;
	}
	.state-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.state-order {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.ord-btn {
		width: 22px;
		height: 15px;
		display: grid;
		place-items: center;
		font-size: 9px;
		color: var(--text-mute);
		border: 1px solid var(--border);
		border-radius: 5px;
		line-height: 1;
	}
	.ord-btn:hover:not(:disabled) {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.ord-btn:disabled {
		opacity: 0.3;
	}
	.state-edit {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}
	.state-color {
		width: 30px;
		height: 30px;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: none;
		cursor: pointer;
		flex-shrink: 0;
	}
	.state-emoji {
		width: 44px;
		text-align: center;
		padding: 7px 4px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 15px;
		flex-shrink: 0;
	}
	.state-label {
		flex: 1;
		min-width: 0;
	}
	.state-add {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.state-add .ref-input {
		flex: 1;
		min-width: 0;
	}

	/* Sous-menu latéral de l'onglet Référentiels : une section à la fois plutôt que 7 cartes
	   empilées, pour ne plus désaligner de grille quand une liste dépasse ses voisines. */
	.ref-layout {
		display: flex;
		align-items: flex-start;
		gap: 20px;
	}
	.ref-nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 0 0 180px;
		padding: 8px;
		/* .card ne pose que fond/bordure/ombre (cf. app.css) : sans ce padding le sous-menu collait
		   ses boutons directement au bord, plus dur à distinguer du reste de la page. */
		/* Relatif à .main (seul ancêtre scrollable) : le sous-menu reste visible même en bas d'une
		   longue liste, sans jamais scoper la page dans un panneau borné. */
		position: sticky;
		top: 0;
	}
	.ref-nav button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		padding: 9px 12px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--text-mute);
		font: inherit;
		font-size: 13.5px;
		text-align: left;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}
	.ref-nav button:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.ref-nav button.on {
		background: var(--surface-2);
		color: var(--text);
		font-weight: 600;
	}
	.ref-nav-count {
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--text-mute);
	}
	.ref-panel {
		flex: 1;
		min-width: 0;
	}
	.ref-search {
		margin-bottom: 12px;
	}
	/* Recherche membres : à droite du titre plutôt qu'en pleine largeur en dessous — un filtre, pas
	   l'action principale de la card. */
	.member-search {
		flex: 0 0 auto;
		width: 200px;
		max-width: 45%;
		margin-bottom: 0;
	}
	.member-search .ref-search-input {
		padding: 6px 10px;
		font-size: 12.5px;
	}
	.ref-search-input {
		width: 100%;
		box-sizing: border-box;
		padding: 8px 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-2);
		font: inherit;
		font-size: 13.5px;
		color: var(--text);
	}
	.ref-search-input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
	}
	/* Recherche + bascule d'ajout sur une même ligne (cf. refToolbar) : deux intentions différentes
	   (filtrer / créer), visuellement séparées au lieu de deux champs empilés et collés. */
	.ref-toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}
	.ref-toolbar .ref-search-input {
		flex: 1;
		min-width: 0;
		width: auto;
	}
	.ref-add-toggle {
		flex: 0 0 auto;
		white-space: nowrap;
	}
	.ref-add-caret {
		display: inline-block;
		font-size: 9px;
		transition: transform 0.15s;
	}
	.ref-add-caret.open {
		transform: rotate(180deg);
	}
	@media (max-width: 720px) {
		.ref-layout {
			flex-direction: column;
			/* .ref-layout est en `align-items:flex-start` pour le mode sidebar (desktop) : sans cette
			   surcharge, .ref-panel hérite du même comportement une fois empilé en colonne et se
			   contente de la largeur de son contenu au lieu de prendre toute la largeur disponible. */
			align-items: stretch;
		}
		.ref-nav {
			/* Bande horizontale à défilement plutôt qu'une liste empilée : même mécanique que .tabs
			   plus haut sur cette page (max-width:640px) — `width:100%` sur chaque bouton ferait sinon
			   un bouton par ligne, pas un vrai rang horizontal. */
			flex-direction: row;
			overflow-x: auto;
			position: static;
			flex-basis: auto;
			width: 100%;
		}
		.ref-nav button {
			flex-shrink: 0;
			width: auto;
		}
	}
	.ref-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 14px;
	}
	.ref-item {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.ref-item > form:first-of-type {
		flex: 1;
		min-width: 0;
	}
	.ref-item.drag-over {
		box-shadow: inset 0 2px 0 var(--accent);
	}
	/* Zone de fin de ligne (statut archivé + action) : largeur minimale réservée pour que le tag
	   "🔒 requis" (plus court qu'un bouton "Archiver") ne fasse pas bouger le reste de la ligne —
	   le tag d'usage (ex. "30 imp."), lui, reste juste après le nom, dans l'ordre naturel de lecture. */
	.ref-item-end {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex: 0 0 auto;
		gap: 6px;
		min-width: 170px;
	}
	/* Activités : deux boutons possibles (Désactiver + Supprimer) au lieu d'un seul ailleurs. */
	.ref-item-end-wide {
		min-width: 260px;
	}
	/* Même gabarit qu'un .ref-btn (padding, taille, coins) pour que "🔒 requis" occupe exactement la
	   place du bouton "Archiver" qu'il remplace — non interactif, donc pas de bordure ni de hover. */
	.ref-btn-locked {
		display: inline-flex;
		align-items: center;
		padding: 6px 10px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-mute);
		background: var(--surface-sunk);
		border-radius: 8px;
		white-space: nowrap;
	}
	/* En dessous, une ligne de saisie (nom + kind/budget + actions) ne tient plus sur une largeur de
	   téléphone : elle passe sur plusieurs lignes plutôt que d'écraser le champ nom à rien. Doit
	   rester APRÈS .ref-item-end/.ref-item-end-wide/.ssp-form ci-dessus : même spécificité (une
	   classe), c'est l'ordre dans la feuille qui tranche. */
	@media (max-width: 560px) {
		.ref-item {
			flex-wrap: wrap;
		}
		.ref-item > form:first-of-type {
			flex-basis: 100%;
		}
		.ref-item-end {
			min-width: 0;
			flex: 1 1 auto;
		}
		.ssp-form {
			flex-wrap: wrap;
		}
		.ssp-form .ref-name:not(.ssp-code):not(.ssp-budget) {
			flex-basis: 100%;
		}
		.ref-toolbar {
			flex-wrap: wrap;
		}
	}
	.drop-end {
		height: 22px;
		margin-top: -6px;
	}
	.drop-end.drag-over {
		box-shadow: inset 0 2px 0 var(--accent);
	}
	.drag-handle {
		font-size: 15px;
		line-height: 1;
		color: var(--accent);
		cursor: grab;
		padding: 2px 4px;
		user-select: none;
	}
	.drag-handle:active {
		cursor: grabbing;
	}
	.ref-name {
		width: 100%;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 8px;
		padding: 7px 9px;
		font: inherit;
		font-size: 13.5px;
		color: var(--text);
		transition: border-color 0.15s, background 0.15s;
	}
	.ref-name:hover:not(:disabled),
	.ref-name:focus {
		border-color: var(--border-strong);
		background: var(--surface-2);
		outline: none;
	}
	.ref-name:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
	}
	.ref-name:disabled {
		color: var(--text-mute);
	}
	.ref-item.archived {
		opacity: 0.7;
	}
	.tag-arch {
		font-size: 10.5px;
		font-weight: 600;
		color: var(--text-mute);
		background: var(--surface-sunk);
		padding: 2px 7px;
		border-radius: 20px;
	}
	.tag-usage {
		font-size: 10.5px;
		font-weight: 600;
		color: var(--text-soft);
		background: var(--surface-sunk);
		padding: 2px 7px;
		border-radius: 20px;
		white-space: nowrap;
	}
	.ref-btn {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-soft);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 6px 10px;
		white-space: nowrap;
		transition: border-color 0.15s, color 0.15s;
	}
	.ref-btn:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.ref-btn-danger:hover {
		border-color: #c0392b;
		color: #c0392b;
	}
	/* Replié par défaut (cf. refAddOpen) : encadré une fois déplié pour bien le distinguer de la
	   barre de recherche juste au-dessus et de la liste juste en dessous. */
	.ref-add {
		display: flex;
		gap: 8px;
		padding: 10px;
		margin-bottom: 12px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface-2);
	}
	/* Un SSP a 3 champs là où les autres référentiels n'en ont qu'un : le code et le budget sont
	   de largeur fixe, seul le libellé absorbe la place restante. */
	.ssp-form {
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
		gap: 6px;
	}
	.ssp-code {
		flex: 0 0 11ch;
		font-variant-numeric: tabular-nums;
	}
	.ssp-budget {
		flex: 0 0 15ch;
		text-align: right;
	}
	.ref-add .btn {
		white-space: nowrap;
		flex-shrink: 0;
	}
	.ref-input {
		flex: 1;
		min-width: 0;
		padding: 9px 11px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13.5px;
	}
	.ref-input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
	}
	/* Toast générique haut-droite (Jira, Référentiels) : flottant plutôt qu'en tête de carte —
	   un flash resté dans le flux du document décale tout le reste (cf. Jira qui se replie en résumé
	   au succès, ou les 7 sections de Référentiels dont une seule est affichée à la fois). Fixe, il
	   reste visible quel que soit le scroll. */
	.toast-tr {
		position: fixed;
		top: 20px;
		right: 20px;
		z-index: 50;
		max-width: min(360px, calc(100vw - 40px));
		box-shadow: var(--shadow-lg, 0 12px 30px rgba(0, 0, 0, 0.25));
		animation: toast-tr-in 0.15s ease-out;
	}
	@keyframes toast-tr-in {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.jira-steps {
		display: flex;
		flex-direction: column;
	}
	.field-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0 14px;
	}
	@media (max-width: 560px) {
		.field-row {
			grid-template-columns: 1fr;
		}
	}
	.step {
		display: grid;
		grid-template-columns: 32px 1fr;
		gap: 14px;
		position: relative;
		padding-bottom: 22px;
	}
	.jira-steps .step:not(:last-child)::before {
		content: '';
		position: absolute;
		left: 15px;
		top: 32px;
		bottom: 0;
		width: 2px;
		background: var(--border);
	}
	.step-num {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--accent-tint);
		color: var(--accent-ink);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 14px;
		flex-shrink: 0;
		z-index: 1;
	}
	.step-body h4 {
		margin: 0 0 8px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 14.5px;
	}
	.step-optional {
		font-size: 11px;
		font-weight: 500;
		color: var(--text-mute);
		margin-left: 6px;
	}
	.step-details summary {
		cursor: pointer;
		margin: 0 0 8px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 14.5px;
	}
	.step-details:not([open]) summary {
		margin-bottom: 0;
	}
	.step-details[open] summary {
		margin-bottom: 14px;
	}
	.jira-form-actions {
		display: flex;
		gap: 10px;
		margin-left: 46px;
	}
	.jira-sync-fields {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 18px;
		margin-top: 4px;
	}
	.jira-sync-field {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13.5px;
		color: var(--text-soft);
		cursor: pointer;
	}
	.jira-sync-field input {
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
	}
	.jira-config-summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		margin-top: 14px;
		padding: 12px 14px;
		background: var(--surface-sunk);
		border-radius: 10px;
	}
	.jira-pat-summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		flex-wrap: wrap;
	}
	.jira-pat-summary-info {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.jira-pat-summary-info .hint {
		margin: 0;
	}
	.jira-run-list {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.jira-run-row {
		padding: 10px 14px;
		background: var(--surface-sunk);
		border-radius: var(--r-sm);
		font-size: 13px;
	}
	.jira-run-row .row-between {
		margin-top: 0;
		flex-wrap: wrap;
	}
	.jira-run-actions {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.jira-force-actions {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		margin-top: 10px;
	}
	.jira-run-row .btn {
		padding: 5px 10px;
		font-size: 12.5px;
	}
	.row-between {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		margin-top: 6px;
	}
	.sync-status {
		margin-top: 14px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
		font-size: 13px;
	}
	.err-text {
		color: var(--warn);
	}
	.pat-meta {
		margin: 6px 0 0;
	}
	.flash.warn {
		background: var(--warn-tint);
		border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent);
		color: var(--warn);
		padding: 10px 14px;
		border-radius: var(--r-sm);
		font-size: 13px;
		margin-bottom: 12px;
	}
	.regex-preview {
		font-size: 14px;
		margin: 4px 0 10px;
	}
	.step-body code {
		background: var(--surface-sunk);
		padding: 1px 5px;
		border-radius: 4px;
		font-size: 0.9em;
	}
</style>
