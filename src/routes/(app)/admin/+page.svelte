<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();

	const PRESETS = ['#16A34A', '#4F46E5', '#9333EA', '#0EA5E9', '#E11D48', '#EA580C', '#0D9488', '#CA8A04'];
	let accent = $state(data.accentColor);
	let copied = $state(false);

	const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

	// Export Excel : modal avec presets de période + choix des feuilles.
	const iso = (d: Date) => d.toISOString().slice(0, 10);
	const SHEETS = [
		{ key: 'synthese', label: 'Synthèse (page de garde)' },
		{ key: 'us', label: 'Synthèse US' },
		{ key: 'projsprint', label: 'Par projet & sprint' },
		{ key: 'activite', label: 'Par activité' },
		{ key: 'imputation', label: 'Imputation détaillée' },
		{ key: 'personne', label: 'Par personne' },
		{ key: 'absences', label: 'Hors-projet & absences' }
	];
	let showExport = $state(false);
	let exFrom = $state('');
	let exTo = $state('');
	let exPreset = $state('month');
	let exSheets = $state(new Set(SHEETS.map((s) => s.key)));

	function applyPreset(p: string) {
		exPreset = p;
		const now = new Date();
		if (p === 'week') {
			const m = new Date(now);
			m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
			exFrom = iso(m);
			exTo = iso(now);
		} else if (p === 'month') {
			exFrom = iso(new Date(now.getFullYear(), now.getMonth(), 1));
			exTo = iso(now);
		} else if (p === 'lastmonth') {
			exFrom = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
			exTo = iso(new Date(now.getFullYear(), now.getMonth(), 0));
		}
	}
	function openExport() {
		if (!exFrom || !exTo) applyPreset('month');
		showExport = true;
	}
	function toggleSheet(key: string) {
		if (exSheets.has(key)) exSheets.delete(key);
		else exSheets.add(key);
		exSheets = new Set(exSheets);
	}
	function downloadExport() {
		const params = new URLSearchParams({ from: exFrom, to: exTo });
		if (exSheets.size < SHEETS.length) params.set('sheets', [...exSheets].join(','));
		window.location.href = `/export?${params.toString()}`;
		showExport = false;
	}

	async function copyMessage() {
		if (!form?.invite) return;
		await navigator.clipboard.writeText(`${form.invite.subject}\n\n${form.invite.body}`);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<div class="topbar">
	<h1>Paramètres &amp; membres<small>Espace {data.allowedDomain}</small></h1>
</div>

<div class="content admin">
	<section class="card block export-block">
		<div>
			<h3>Export Excel</h3>
			<p class="hint" style="margin-bottom:0;">Classeur complet (synthèse, par projet/sprint, par activité, par personne, paramétrage…). Le <b>consommé</b> est borné sur la période choisie (par défaut le dernier mois) ; le chiffrage reste l'état courant.</p>
		</div>
		<button class="btn btn-primary" onclick={openExport}>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="3" width="12" height="8" rx="1.5"/><path d="M12 17v-6M9 14l3 3 3-3"/><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/></svg>
			Télécharger l'Excel
		</button>
	</section>

	<div class="cols-2">
		<section class="card block">
			<h3>Inviter un membre</h3>
			<p class="hint">L'invitation génère un message à copier puis envoyer vous-même (pas d'email automatique). Domaine autorisé : <b>@{data.allowedDomain}</b>.</p>
			{#if form?.error}<div class="flash error">{form.error}</div>{/if}

			<form method="POST" action="?/invite" use:enhance>
				<div class="invite-row">
					<div class="field"><label for="dn">Nom</label><input id="dn" name="displayName" placeholder="Prénom Nom" required /></div>
					<div class="field"><label for="em">Email</label><input id="em" name="email" type="email" placeholder="prenom@{data.allowedDomain}" required /></div>
					<div class="field"><label for="ro">Rôle</label><select id="ro" name="role"><option value="USER">Membre</option><option value="ADMIN">Admin</option></select></div>
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
			<h3>Couleur de l'espace</h3>
			<p class="hint">Personnalise l'accent de toute l'interface pour cet espace.</p>
			{#if form?.accentOk}<div class="flash ok">Couleur mise à jour ✓ (rechargez pour l'appliquer partout)</div>{/if}
			<form method="POST" action="?/accent" use:enhance>
				<div class="swatches">
					{#each PRESETS as c (c)}
						<button type="button" class="sw" class:sel={accent.toLowerCase() === c.toLowerCase()} style="background:{c}" onclick={() => (accent = c)} aria-label={c}></button>
					{/each}
					<input class="hex" type="text" bind:value={accent} maxlength="7" aria-label="Couleur personnalisée" />
					<span class="preview" style="background:{accent}"></span>
				</div>
				<input type="hidden" name="color" value={accent} />
				<button class="btn btn-primary" type="submit" style="margin-top:14px;">Enregistrer la couleur</button>
			</form>
		</section>
	</div>

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
						{#if a.archived}<span class="tag-arch">archivé</span>{/if}
						<form
							method="POST"
							action="?/actArchive"
							use:enhance
							onsubmit={(e) => {
								if (!a.archived && a.usage > 0 && !confirm(`${a.usage} imputation${a.usage > 1 ? 's' : ''} perdront cette activité. Archiver quand même ?`))
									e.preventDefault();
							}}
						>
							<input type="hidden" name="id" value={a.id} />
							<input type="hidden" name="archived" value={a.archived ? 'false' : 'true'} />
							<button class="ref-btn" type="submit">{a.archived ? '↺ Restaurer' : '🗄 Archiver'}</button>
						</form>
					</div>
				{/each}
				{#if data.activities.length === 0}<p class="hint" style="margin:0;">Aucune activité.</p>{/if}
			</div>
			<form method="POST" action="?/actCreate" use:enhance class="ref-add">
				<input class="ref-input" name="label" placeholder="Nouvelle activité…" required />
				<button class="btn btn-ghost" type="submit">+ Ajouter</button>
			</form>
		</section>
	</div>

	<section class="card block">
		<h3>Membres ({data.members.length})</h3>
		{#if form?.memberOk}<div class="flash ok">Membre mis à jour ✓</div>{/if}
		<table class="members">
			<tbody>
				{#each data.members as m (m.id)}
					{@const isSelf = m.id === data.selfId}
					<tr class:inactive={!m.active && !m.pending}>
						<td><div class="mc"><span class="avatar">{initials(m.displayName)}</span><div><b>{m.displayName}{#if isSelf} <span class="you">vous</span>{/if}</b><span>{m.email}</span></div></div></td>
						<td>
							{#if isSelf}
								<span class="pill">{m.role === 'ADMIN' ? 'Admin' : 'Membre'}</span>
							{:else}
								<form method="POST" action="?/memberRole" use:enhance>
									<input type="hidden" name="userId" value={m.id} />
									<select class="role-sel" name="role" value={m.role} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
										<option value="USER">Membre</option>
										<option value="ADMIN">Admin</option>
									</select>
								</form>
							{/if}
						</td>
						<td>{#if m.pending}<span class="pill pending">⏳ En attente</span>{:else if !m.active}<span class="pill off">🚫 Désactivé</span>{:else}<span class="pill active">✓ Actif</span>{/if}</td>
						<td>
							<form method="POST" action="?/memberCapacity" use:enhance class="cap-form">
								<input type="hidden" name="userId" value={m.id} />
								<input class="cap-input" type="number" name="capacity" min="0.1" max="1" step="0.05" value={m.capacity} title="Capacité par jour (1 = temps plein)" onchange={(e) => e.currentTarget.form?.requestSubmit()} />
								<span class="cap-unit">j/j</span>
							</form>
						</td>
						<td class="m-actions">
							{#if m.pending}
								<form method="POST" action="?/memberInvite" use:enhance>
									<input type="hidden" name="userId" value={m.id} />
									<button class="ref-btn" type="submit">↻ Régénérer le lien</button>
								</form>
							{:else if !isSelf}
								<form method="POST" action="?/memberActive" use:enhance>
									<input type="hidden" name="userId" value={m.id} />
									<input type="hidden" name="active" value={m.active ? 'false' : 'true'} />
									<button class="ref-btn" type="submit">{m.active ? 'Désactiver' : 'Réactiver'}</button>
								</form>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
</div>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (showExport = false)} />

{#if showExport}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={() => (showExport = false)}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h3>Exporter en Excel</h3>
			<p class="hint">Le <b>consommé</b> est borné sur la période ; le chiffrage reste l'état courant.</p>

			<div class="seg">
				<button type="button" class:on={exPreset === 'week'} onclick={() => applyPreset('week')}>Semaine en cours</button>
				<button type="button" class:on={exPreset === 'month'} onclick={() => applyPreset('month')}>Mois en cours</button>
				<button type="button" class:on={exPreset === 'lastmonth'} onclick={() => applyPreset('lastmonth')}>Mois dernier</button>
				<button type="button" class:on={exPreset === 'custom'} onclick={() => (exPreset = 'custom')}>Personnalisé</button>
			</div>

			<div class="ex-dates">
				<label class="ex-field">Du<input type="date" bind:value={exFrom} max={exTo} onchange={() => (exPreset = 'custom')} /></label>
				<label class="ex-field">Au<input type="date" bind:value={exTo} min={exFrom} onchange={() => (exPreset = 'custom')} /></label>
			</div>

			<div class="sheets">
				<div class="sheets-h">
					Feuilles à inclure
					<button type="button" class="link-btn" onclick={() => (exSheets = new Set(exSheets.size === SHEETS.length ? [] : SHEETS.map((s) => s.key)))}>
						{exSheets.size === SHEETS.length ? 'Tout décocher' : 'Tout cocher'}
					</button>
				</div>
				{#each SHEETS as s (s.key)}
					<label class="sheet-row"><input type="checkbox" checked={exSheets.has(s.key)} onchange={() => toggleSheet(s.key)} /> {s.label}</label>
				{/each}
			</div>

			<div class="modal-actions">
				<button class="btn btn-ghost" onclick={() => (showExport = false)}>Annuler</button>
				<button class="btn btn-primary" disabled={exSheets.size === 0 || !exFrom || !exTo} onclick={downloadExport}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="3" width="12" height="8" rx="1.5"/><path d="M12 17v-6M9 14l3 3 3-3"/><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/></svg>
					Télécharger
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.admin {
		max-width: 1180px;
	}
	.block {
		padding: 22px;
		margin-bottom: 18px;
	}
	/* Inviter (large) + Couleur (compact) côte à côte */
	.cols-2 {
		display: grid;
		grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
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
	.ex-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.ex-field input {
		padding: 7px 9px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13px;
	}
	.ex-field input:focus {
		outline: none;
		border-color: var(--accent);
	}
	/* Modal export */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		z-index: 50;
	}
	.modal {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
		padding: 24px;
		width: 100%;
		max-width: 440px;
	}
	.modal h3 {
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
		margin-bottom: 4px;
	}
	.seg {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin: 16px 0 14px;
	}
	.seg button {
		padding: 9px 10px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-soft);
		font-size: 13px;
		font-weight: 500;
		transition: border-color 0.15s, background 0.15s, color 0.15s;
	}
	.seg button:hover {
		border-color: var(--border-strong);
	}
	.seg button.on {
		border-color: var(--accent);
		background: var(--accent-tint);
		color: var(--accent-ink);
		font-weight: 600;
	}
	.ex-dates {
		display: flex;
		gap: 12px;
		margin-bottom: 16px;
	}
	.ex-dates .ex-field {
		flex: 1;
	}
	.sheets {
		border-top: 1px solid var(--border);
		padding-top: 14px;
	}
	.sheets-h {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-mute);
		margin-bottom: 10px;
	}
	.link-btn {
		font-size: 12px;
		font-weight: 600;
		color: var(--accent);
		text-transform: none;
		letter-spacing: 0;
	}
	.sheet-row {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 5px 0;
		font-size: 13.5px;
		color: var(--text-soft);
		cursor: pointer;
	}
	.sheet-row input {
		width: 15px;
		height: 15px;
		accent-color: var(--accent);
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 20px;
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
	.swatches {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
	}
	.sw {
		width: 30px;
		height: 30px;
		border-radius: 9px;
		cursor: pointer;
		outline: 2px solid transparent;
		outline-offset: 2px;
		transition: transform 0.12s;
	}
	.sw:hover {
		transform: scale(1.1);
	}
	.sw.sel {
		outline-color: var(--text-soft);
	}
	.hex {
		width: 100px;
		padding: 7px 10px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13px;
	}
	.preview {
		width: 30px;
		height: 30px;
		border-radius: 9px;
		border: 1px solid var(--border);
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
