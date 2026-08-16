<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { formatDateTime } from '$lib/utils/date';
	import ExportModal from '$lib/components/ExportModal.svelte';
	import AccentPicker from '$lib/components/AccentPicker.svelte';
	import MemberAccessModal from '$lib/components/MemberAccessModal.svelte';
	import { confirmDialog } from '$lib/confirm.svelte';
	let { data, form } = $props();

	let accessModalFor = $state<string | null>(null);
	const accessModalMember = $derived(data.members.find((m) => m.id === accessModalFor) ?? null);

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

	const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

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
		replaceState(`?tab=${next}`, {});
	}

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
					{#each data.members as m (m.id)}
						{@const isSelf = m.id === data.selfId}
						<tr class:inactive={!m.active && !m.pending}>
							<td><div class="mc"><span class="avatar">{initials(m.displayName)}</span><div><b>{m.displayName}{#if isSelf} <span class="you">vous</span>{/if}</b><span>{m.email}</span></div></div></td>
							<td>
								{#if m.isOwner}
									<span class="pill owner" title="Créateur de l'espace">👑 Créateur</span>
								{:else if isSelf}
									<span class="pill">{m.role === 'ADMIN' ? 'Admin' : m.role === 'MANAGER' ? 'Manager' : 'Membre'}</span>
								{:else}
									<form method="POST" action="?/memberRole" use:enhance>
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
								<form method="POST" action="?/memberCapacity" use:enhance class="cap-form">
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
											form.requestSubmit();
										}}
									/>
									<span class="cap-unit">%</span>
								</form>
							</td>
							<td>
								{#if m.role !== 'ADMIN'}
									<button type="button" class="ref-btn" onclick={() => (accessModalFor = m.id)}>
										⚙ Accès
										{#if m.canViewImputations || m.canViewMoodResults}<span class="access-dot" title="Au moins une capacité de lecture accordée"></span>{/if}
									</button>
								{/if}
							</td>
							<td class="m-actions">
								{#if m.pending}
									<form method="POST" action="?/memberInvite" use:enhance>
										<input type="hidden" name="userId" value={m.id} />
										<button class="ref-btn" type="submit">↻ Régénérer le lien</button>
									</form>
								{:else}
									<div class="action-group">
										<form method="POST" action="?/memberInvite" use:enhance>
											<input type="hidden" name="userId" value={m.id} />
											<button class="ref-btn" type="submit" title="Envoyer un lien pour réinitialiser son mot de passe">🔑 Lien de réinitialisation</button>
										</form>
										{#if data.isOwner && !m.isOwner && m.active}
											<form
												method="POST"
												action="?/transferOwnership"
												use:enhance={async ({ cancel }) => {
													const ok = await confirmDialog({
														message: `Transmettre la propriété de l'espace à ${m.displayName} ? Vous resterez admin, mais perdrez la protection de créateur.`,
														confirmLabel: 'Transmettre'
													});
													if (!ok) cancel();
												}}
											>
												<input type="hidden" name="userId" value={m.id} />
												<button class="ref-btn" type="submit">👑 Transmettre</button>
											</form>
										{/if}
										{#if !isSelf && !m.isOwner}
											<form method="POST" action="?/memberActive" use:enhance>
												<input type="hidden" name="userId" value={m.id} />
												<input type="hidden" name="active" value={m.active ? 'false' : 'true'} />
												<button class="ref-btn" type="submit">{m.active ? 'Désactiver' : 'Réactiver'}</button>
											</form>
										{/if}
									</div>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			</div>
			</div>
		</section>
	{/if}

	{#snippet refBlock(title: string, type: 'project' | 'sprint' | 'version', placeholder: string, items: { id: string; name: string; archived: boolean; usage: number }[])}
		<section class="card block">
			<h3>{title}</h3>
			{#if form?.refOk === type}<div class="flash ok">Mis à jour ✓</div>{/if}
			<div class="ref-list">
				{#each items as it (it.id)}
					<div class="ref-item" class:archived={it.archived}>
						<form method="POST" action="?/refRename" use:enhance>
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
				{/each}
				{#if items.length === 0}<p class="hint" style="margin:0;">Aucun élément pour l'instant.</p>{/if}
			</div>
			<form method="POST" action="?/refCreate" use:enhance class="ref-add">
				<input type="hidden" name="type" value={type} />
				<input class="ref-input" name="name" placeholder={placeholder} required />
				<button class="btn btn-ghost" type="submit">+ Ajouter</button>
			</form>
		</section>
	{/snippet}

	{#if tab === 'referentiels'}
		<div class="ref-grid">
			{@render refBlock('Projets', 'project', 'Nouveau projet…', data.projects)}
			{@render refBlock('Sprints', 'sprint', 'Nouveau sprint…', data.sprints)}
			{@render refBlock('Versions', 'version', 'Nouvelle version…', data.versions)}
		</div>

		<div class="cols-2">
			<section class="card block">
				<h3>Catégories</h3>
				<p class="hint">Cibles d'imputation hors-ticket (MCO, congés, formation…). « Non productif » est exclu de la charge projet.</p>
				{#if form?.catOk}<div class="flash ok">Mis à jour ✓</div>{/if}
				<div class="ref-list">
					{#each data.categories as c (c.id)}
						<div class="ref-item" class:archived={c.archived}>
							<form method="POST" action="?/catRename" use:enhance>
								<input type="hidden" name="id" value={c.id} />
								<input class="ref-name" name="label" value={c.label} disabled={c.archived} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
							</form>
							{#if c.usage > 0}<span class="tag-usage" title="Imputations liées">{c.usage} imp.</span>{/if}
							<form method="POST" action="?/catKind" use:enhance>
								<input type="hidden" name="id" value={c.id} />
								<select class="param-kind" name="kind" value={c.kind} disabled={c.archived} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
									<option value="PRODUCTIVE">Productif</option>
									<option value="NON_PRODUCTIVE">Non productif</option>
								</select>
							</form>
							{#if c.archived}<span class="tag-arch">archivé</span>{/if}
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
						</div>
					{/each}
					{#if data.categories.length === 0}<p class="hint" style="margin:0;">Aucune catégorie.</p>{/if}
				</div>
				<form method="POST" action="?/catCreate" use:enhance class="ref-add">
					<input class="ref-input" name="label" placeholder="Nouvelle catégorie…" required />
					<select class="param-kind" name="kind">
						<option value="PRODUCTIVE">Productif</option>
						<option value="NON_PRODUCTIVE">Non productif</option>
					</select>
					<button class="btn btn-ghost" type="submit">+ Ajouter</button>
				</form>
			</section>

			<section class="card block">
				<h3>Activités</h3>
				<p class="hint">Nature du travail (Dev, TU, DA…), optionnelle sur une imputation. Glisse-dépose ⠿ pour réordonner : c'est cet ordre qui sert dans la répartition par activité des synthèses (sauf préférence "alphabétique" d'un membre dans ses paramètres de compte).</p>
				{#if form?.actOk}<div class="flash ok">Mis à jour ✓</div>{/if}
				<div class="ref-list">
					{#each activityOrder as a (a.id)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="ref-item"
							class:archived={a.archived}
							class:drag-over={dragOverActivityId === a.id && draggingActivityId !== a.id}
							ondragover={(e) => { e.preventDefault(); dragOverActivityId = a.id; }}
							ondragleave={() => { if (dragOverActivityId === a.id) dragOverActivityId = null; }}
							ondrop={(e) => { e.preventDefault(); onActivityDrop(a.id); }}
						>
							<span
								class="drag-handle"
								draggable="true"
								ondragstart={(e) => { draggingActivityId = a.id; e.dataTransfer?.setData('text/plain', a.id); }}
								ondragend={() => { draggingActivityId = null; dragOverActivityId = null; }}
								aria-label="Glisser pour réordonner {a.label}"
								role="button"
								tabindex="-1"
							>⠿</span>
							<form method="POST" action="?/actRename" use:enhance>
								<input type="hidden" name="id" value={a.id} />
								<input class="ref-name" name="label" value={a.label} disabled={a.archived} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
							</form>
							{#if a.usage > 0}<span class="tag-usage" title="Imputations liées">{a.usage} imp.</span>{/if}
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
					{/each}
					{#if activityOrder.length === 0}
						<p class="hint" style="margin:0;">Aucune activité.</p>
					{:else}
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
				<form method="POST" action="?/actCreate" use:enhance class="ref-add">
					<input class="ref-input" name="label" placeholder="Nouvelle activité…" required />
					<button class="btn btn-ghost" type="submit">+ Ajouter</button>
				</form>
			</section>

			<section class="card block">
				<h3>Groupes de tickets</h3>
				<p class="hint">Regroupement libre et transverse, indépendant des sprints/versions. Un ticket peut appartenir à plusieurs groupes. Glisse-dépose ⠿ pour réordonner : c'est cet ordre qui sert dans les synthèses par sprint/version.</p>
				{#if form?.groupOk}<div class="flash ok">Mis à jour ✓</div>{/if}
				<div class="ref-list">
					{#each groupOrder as g (g.id)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="ref-item"
							class:archived={g.archived}
							class:drag-over={dragOverGroupId === g.id && draggingGroupId !== g.id}
							ondragover={(e) => { e.preventDefault(); dragOverGroupId = g.id; }}
							ondragleave={() => { if (dragOverGroupId === g.id) dragOverGroupId = null; }}
							ondrop={(e) => { e.preventDefault(); onGroupDrop(g.id); }}
						>
							<span
								class="drag-handle"
								draggable="true"
								ondragstart={(e) => { draggingGroupId = g.id; e.dataTransfer?.setData('text/plain', g.id); }}
								ondragend={() => { draggingGroupId = null; dragOverGroupId = null; }}
								aria-label="Glisser pour réordonner {g.label}"
								role="button"
								tabindex="-1"
							>⠿</span>
							<form method="POST" action="?/groupRename" use:enhance>
								<input type="hidden" name="id" value={g.id} />
								<input class="ref-name" name="label" value={g.label} disabled={g.archived} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
							</form>
							{#if g.usage > 0}<span class="tag-usage" title="Tickets liés">{g.usage} ticket{g.usage > 1 ? 's' : ''}</span>{/if}
							{#if g.archived}<span class="tag-arch">inactif</span>{/if}
							<form method="POST" action="?/groupArchive" use:enhance>
								<input type="hidden" name="id" value={g.id} />
								<input type="hidden" name="archived" value={g.archived ? 'false' : 'true'} />
								<button class="ref-btn" type="submit">{g.archived ? 'Activer' : 'Désactiver'}</button>
							</form>
						</div>
					{/each}
					{#if groupOrder.length === 0}
						<p class="hint" style="margin:0;">Aucun groupe.</p>
					{:else}
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
				<form method="POST" action="?/groupCreate" use:enhance class="ref-add">
					<input class="ref-input" name="label" placeholder="Nouveau groupe…" required />
					<button class="btn btn-ghost" type="submit">+ Ajouter</button>
				</form>
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
						<form class="state-edit" method="POST" action="?/stateUpdate" use:enhance>
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

			<form method="POST" action="?/supportCadence" use:enhance style="margin-top:14px;">
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
			{#if form?.error}<div class="flash error">{form.error}</div>{/if}
			{#if form?.jiraSaveOk}<div class="flash ok">Configuration enregistrée ✓</div>{/if}

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
							<div class="field">
								<label for="jira-updated-since">Date minimum (optionnel)</label>
								<input id="jira-updated-since" name="updatedSinceDate" type="date" />
								<p class="hint pat-meta">
									{#if data.jira.updatedSince}
										Valeur actuelle : <b>{formatDateTime(new Date(data.jira.updatedSince))}</b> — laisser vide pour ne pas modifier.
									{:else}
										Aucune limite actuellement — laisser vide pour ne pas modifier.
									{/if}
								</p>
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
							<h4>Réconciliation des clés <span class="step-optional">optionnel</span></h4>
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

			<div class="jira-activation">
				<h4>Activation</h4>

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
				</div>

				{#if form?.jiraResetSinceOk}<div class="flash ok">Réinitialisé ✓</div>{/if}
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
							<button type="submit" class="btn btn-ghost">Réinitialiser le filtre</button>
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
			</div>

			<div class="jira-history">
				<h4>Historique des synchronisations</h4>
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
			</div>
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
					<form method="POST" action="?/pprRatio" use:enhance style="display:flex;align-items:center;justify-content:space-between;gap:14px;">
						<span>Ratio PPR</span>
						<div style="display:flex;align-items:center;gap:8px;">
							<input class="cap-input" type="number" name="value" min="0.01" max="1" step="0.05" value={data.pprRatio} />
							<button class="btn btn-ghost" type="submit">Enregistrer</button>
						</div>
					</form>
					<form method="POST" action="?/imputationStep" use:enhance style="display:flex;align-items:center;justify-content:space-between;gap:14px;">
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
	.action-group {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
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

	.ref-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
		gap: 18px;
		margin-bottom: 18px;
	}
	.ref-grid .block {
		margin-bottom: 0;
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
	.ref-add {
		display: flex;
		gap: 8px;
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
	@media (max-width: 860px) {
		.ref-grid {
			grid-template-columns: 1fr;
		}
	}

	/* ---------- Jira ---------- */
	.jira-steps {
		display: flex;
		flex-direction: column;
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
	.step-body h4,
	.jira-activation h4 {
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
	.jira-activation,
	.jira-history {
		margin-top: 22px;
		padding-top: 20px;
		border-top: 1px solid var(--border);
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
