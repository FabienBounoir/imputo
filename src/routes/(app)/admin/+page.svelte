<script lang="ts">
	import { enhance } from '$app/forms';
	import ExportModal from '$lib/components/ExportModal.svelte';
	import AccentPicker from '$lib/components/AccentPicker.svelte';
	let { data, form } = $props();

	const PRESETS = ['#16A34A', '#4F46E5', '#9333EA', '#0EA5E9', '#E11D48', '#EA580C', '#0D9488', '#CA8A04'];
	let accent = $state(data.accentColor);
	let copied = $state(false);
	// initialisé depuis la valeur enregistrée : le défilement lui-même vit dans le layout racine
	// (toujours monté), donc il continue de tourner en changeant de page et après un rechargement.
	let rgbMode = $state(data.accentRgb);

	const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
	const MOOD_PERIODS: { value: string; label: string }[] = [
		{ value: 'WEEK_1', label: '1 semaine' },
		{ value: 'WEEK_2', label: '2 semaines' },
		{ value: 'WEEK_3', label: '3 semaines' },
		{ value: 'MONTH', label: '1 mois (du 1er au dernier jour)' }
	];
	let moodPeriodKind = $state(data.mood.periodKind);
	let moodStartWeekday = $state(data.mood.startWeekday);

	const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

	async function copyMessage() {
		if (!form?.invite) return;
		await navigator.clipboard.writeText(`${form.invite.subject}\n\n${form.invite.body}`);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	const TABS = [
		{ key: 'membres', label: 'Membres' },
		{ key: 'referentiels', label: 'Référentiels' },
		{ key: 'workflow', label: 'Workflow' },
		{ key: 'general', label: 'Général' }
	] as const;
	type Tab = (typeof TABS)[number]['key'];
	let tab = $state<Tab>('membres');
</script>

<div class="topbar">
	<h1>Paramètres &amp; membres<small>Espace {data.allowedDomain}</small></h1>
</div>

<div class="content admin">
	<div class="tabs">
		{#each TABS as t (t.key)}
			<button type="button" class:on={tab === t.key} onclick={() => (tab = t.key)}>{t.label}</button>
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
			<h3>Membres ({data.members.length})</h3>
			{#if form?.memberOk}<div class="flash ok">Membre mis à jour ✓</div>{/if}
			{#if form?.ownerOk}<div class="flash ok">Propriété de l'espace transmise ✓</div>{/if}
			<p class="hint" style="margin-bottom:0;">
				👑 Le <b>créateur de l'espace</b> a les mêmes droits qu'un admin, mais ne peut être ni rétrogradé ni
				désactivé par personne d'autre. Il peut transmettre ce statut à un autre membre actif.
			</p>
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
							<td class="m-actions">
								{#if m.pending}
									<form method="POST" action="?/memberInvite" use:enhance>
										<input type="hidden" name="userId" value={m.id} />
										<button class="ref-btn" type="submit">↻ Régénérer le lien</button>
									</form>
								{:else}
									<div class="action-group">
										{#if data.isOwner && !m.isOwner && m.active}
											<form
												method="POST"
												action="?/transferOwnership"
												use:enhance
												onsubmit={(e) => {
													if (!confirm(`Transmettre la propriété de l'espace à ${m.displayName} ? Vous resterez admin, mais perdrez la protection de créateur.`))
														e.preventDefault();
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
							use:enhance
							onsubmit={(e) => {
								if (!it.archived && it.usage > 0 && !confirm(`${it.usage} ticket${it.usage > 1 ? 's' : ''} seront détachés à terme. Archiver quand même ?`))
									e.preventDefault();
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
								use:enhance
								onsubmit={(e) => {
									if (!c.archived && c.usage > 0 && !confirm(`${c.usage} imputation${c.usage > 1 ? 's' : ''} seront supprimées à terme. Archiver quand même ?`))
										e.preventDefault();
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
				<p class="hint">Nature du travail (Dev, TU, DA…), optionnelle sur une imputation.</p>
				{#if form?.actOk}<div class="flash ok">Mis à jour ✓</div>{/if}
				<div class="ref-list">
					{#each data.activities as a (a.id)}
						<div class="ref-item" class:archived={a.archived}>
							<form method="POST" action="?/actRename" use:enhance>
								<input type="hidden" name="id" value={a.id} />
								<input class="ref-name" name="label" value={a.label} disabled={a.archived} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
							</form>
							{#if a.usage > 0}<span class="tag-usage" title="Imputations liées">{a.usage} imp.</span>{/if}
							{#if a.archived}<span class="tag-arch">inactive</span>{/if}
							<form
								method="POST"
								action="?/actActive"
								use:enhance
								onsubmit={(e) => {
									if (!a.archived && !confirm('Désactiver cette activité ? Elle restera visible sur les imputations et tickets existants, mais ne sera plus proposée pour de nouvelles saisies.'))
										e.preventDefault();
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
									use:enhance
									onsubmit={(e) => { if (!confirm(`Supprimer définitivement l'activité « ${a.label} » ?`)) e.preventDefault(); }}
								>
									<input type="hidden" name="id" value={a.id} />
									<button class="ref-btn ref-btn-danger" type="submit">Supprimer</button>
								</form>
							{/if}
						</div>
					{/each}
					{#if data.activities.length === 0}<p class="hint" style="margin:0;">Aucune activité.</p>{/if}
				</div>
				<form method="POST" action="?/actCreate" use:enhance class="ref-add">
					<input class="ref-input" name="label" placeholder="Nouvelle activité…" required />
					<button class="btn btn-ghost" type="submit">+ Ajouter</button>
				</form>
			</section>

			<section class="card block">
				<h3>Groupes de tickets</h3>
				<p class="hint">Regroupement libre et transverse, indépendant des sprints/versions. Un ticket peut appartenir à plusieurs groupes.</p>
				{#if form?.groupOk}<div class="flash ok">Mis à jour ✓</div>{/if}
				<div class="ref-list">
					{#each data.ticketGroups as g (g.id)}
						<div class="ref-item" class:archived={g.archived}>
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
					{#if data.ticketGroups.length === 0}<p class="hint" style="margin:0;">Aucun groupe.</p>{/if}
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
							use:enhance
							onsubmit={(e) => {
								if (s.usage > 0 && !confirm(`${s.usage} ticket${s.usage > 1 ? 's' : ''} perdront cet état. Supprimer quand même ?`))
									e.preventDefault();
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
					<AccentPicker bind:color={accent} bind:rgbMode presets={PRESETS} />
					<input type="hidden" name="color" value={accent} />
					<input type="hidden" name="rgb" value={rgbMode} />
					{#if rgbMode}<p class="hint" style="margin:8px 0 0;">Le mode RGB fait défiler l'accent en continu sur toute l'interface, une fois enregistré.</p>{/if}
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
							<input class="cap-input" type="number" name="value" min="0.00" max="1" step="0.05" value={data.imputationStep} />
							<button class="btn btn-ghost" type="submit">Enregistrer</button>
						</div>
					</form>
				</div>
			</section>
		</div>
	{/if}
</div>

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
	table.members {
		width: 100%;
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
	.ref-item form:first-of-type {
		flex: 1;
		min-width: 0;
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
</style>
