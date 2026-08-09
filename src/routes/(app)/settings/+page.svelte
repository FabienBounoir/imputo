<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import {
		pushSupported,
		isSubscribed,
		subscribePush,
		unsubscribePush,
		saveNotifPrefs,
		sendTestNotification,
		type NotifPrefs
	} from '$lib/push';
	import { setTheme, storedTheme, type ThemePref } from '$lib/theme';
	import { seasonalState, setSeasonalEnabled, setForcedEffect, activeSeasonalEffects, SEASONAL_EFFECTS } from '$lib/seasonal.svelte';
	import { konamiState } from '$lib/konami.svelte';
	import AccentPicker from '$lib/components/AccentPicker.svelte';
	import PasswordField from '$lib/components/PasswordField.svelte';

	let { data, form } = $props();

	let supported = $state(true);
	let subscribed = $state(false);
	let busy = $state(false);
	let flash = $state('');
	let prefs = $state<NotifPrefs>({ ...data.prefs });
	let themePref = $state<ThemePref>('system');

	const PRESETS = ['#16A34A', '#4F46E5', '#9333EA', '#0EA5E9', '#E11D48', '#EA580C', '#0D9488', '#CA8A04'];
	let accentOverride = $state(data.accentMode !== 'WORKSPACE');
	let accentRgb = $state(data.accentMode === 'RGB');
	let accentColor = $state(data.accentColor ?? data.workspace?.accentColor ?? PRESETS[0]);
	const activeSeasonal = $derived(activeSeasonalEffects());

	const TYPES: { key: keyof NotifPrefs; label: string }[] = [
		{ key: 'eveningMissing', label: "Soir : imputation du jour non saisie" },
		{ key: 'morningYesterday', label: 'Matin : la veille n’a pas été renseignée' },
		{ key: 'raeStale', label: 'RAE périmé sur mes tickets' },
		{ key: 'weeklyRecap', label: 'Récap du vendredi (semaine incomplète)' },
		{ key: 'moodDeadline', label: 'Team mood : dernier jour pour voter' },
		...(data.role === 'ADMIN'
			? [{ key: 'moodRecap' as const, label: 'Team mood : baisse nette de la moyenne (admin)' }]
			: [])
	];

	onMount(async () => {
		supported = pushSupported();
		subscribed = await isSubscribed();
		themePref = storedTheme() ?? 'system';
	});

	function note(msg: string) {
		flash = msg;
		setTimeout(() => (flash = ''), 2500);
	}

	async function enable() {
		busy = true;
		const ok = await subscribePush(data.vapidPublicKey);
		busy = false;
		subscribed = ok;
		if (ok) {
			prefs.enabled = true;
			await saveNotifPrefs(prefs);
			note('Notifications activées ✓');
		} else {
			note('Permission refusée ou non disponible.');
		}
	}
	async function disable() {
		busy = true;
		await unsubscribePush();
		busy = false;
		subscribed = false;
		note('Notifications désactivées sur cet appareil.');
	}
	async function savePref() {
		await saveNotifPrefs(prefs);
		note('Préférences enregistrées ✓');
	}
	async function test() {
		const sent = await sendTestNotification();
		note(sent > 0 ? 'Notification de test envoyée.' : 'Aucun appareil abonné — active les notifications ci-dessus.');
	}
	function pickTheme(p: ThemePref) {
		themePref = p;
		setTheme(p);
	}

	const TABS = [
		{ key: 'notifications', label: 'Notifications' },
		{ key: 'securite', label: 'Sécurité' },
		{ key: 'apparence', label: 'Apparence' }
	] as const;
	type Tab = (typeof TABS)[number]['key'];
	let tab = $state<Tab>(form?.pwOk || form?.pwError ? 'securite' : form?.accentPrefOk ? 'apparence' : 'notifications');
</script>

<div class="topbar">
	<h1>Réglages<small>Préférences personnelles</small></h1>
	<div class="spacer"></div>
	{#if flash}<span class="saved">{flash}</span>{/if}
</div>

<div class="content settings">
	<div class="tabs">
		{#each TABS as t (t.key)}
			<button type="button" class:on={tab === t.key} onclick={() => (tab = t.key)}>{t.label}</button>
		{/each}
	</div>

	{#if tab === 'notifications'}
		<section class="card block">
			<h3>Notifications</h3>
			<p class="hint">Rappels pour ne pas oublier de saisir ton imputation ou de mettre à jour ton RAE. Envoyés même quand l’app est fermée (navigateur compatible, ou app installée sur iOS).</p>

			{#if !data.vapidConfigured}
				<div class="flash error">Notifications non configurées côté serveur (clés VAPID manquantes).</div>
			{:else if !supported}
				<div class="flash error">Ton navigateur ne supporte pas les notifications push.</div>
			{:else}
				<div class="row">
					<div>
						<b>Notifications push</b>
						<span class="sub">{subscribed ? 'Activées sur cet appareil' : 'Désactivées sur cet appareil'}</span>
					</div>
					{#if subscribed}
						<button class="btn btn-ghost" onclick={disable} disabled={busy}>Désactiver</button>
					{:else}
						<button class="btn btn-primary" onclick={enable} disabled={busy}>Activer</button>
					{/if}
				</div>

				{#if subscribed}
					<div class="prefs">
						<label class="pref master">
							<input type="checkbox" bind:checked={prefs.enabled} onchange={savePref} />
							<span>Activer les rappels</span>
						</label>
						{#each TYPES as t (t.key)}
							<label class="pref" class:off={!prefs.enabled}>
								<input type="checkbox" bind:checked={prefs[t.key]} onchange={savePref} disabled={!prefs.enabled} />
								<span>{t.label}</span>
							</label>
						{/each}
						<button class="btn btn-ghost test" onclick={test}>Envoyer une notification de test</button>
					</div>
				{/if}
			{/if}
		</section>
	{:else if tab === 'securite'}
		<section class="card block">
			<h3>Mot de passe</h3>
			<p class="hint">Change ton mot de passe de connexion.</p>
			{#if form?.pwOk}<div class="flash ok">Mot de passe changé ✓</div>{/if}
			{#if form?.pwError}<div class="flash error">{form.pwError}</div>{/if}
			<form method="POST" action="?/changePassword" use:enhance>
				<PasswordField id="cpw" name="currentPassword" label="Mot de passe actuel" autocomplete="current-password" required />
				<PasswordField id="npw" name="password" label="Nouveau mot de passe" placeholder="8 caractères minimum" autocomplete="new-password" required />
				<PasswordField id="ncf" name="confirm" label="Confirmer le nouveau mot de passe" autocomplete="new-password" required />
				<button class="btn btn-primary" type="submit">Changer le mot de passe</button>
			</form>
		</section>
	{:else if tab === 'apparence'}
		<section class="card block">
			<h3>Thème</h3>
			<p class="hint">Apparence de l’interface. « Système » suit le réglage de ton appareil.</p>
			<div class="seg">
				<button type="button" class:on={themePref === 'system'} onclick={() => pickTheme('system')}>Système</button>
				<button type="button" class:on={themePref === 'light'} onclick={() => pickTheme('light')}>Clair</button>
				<button type="button" class:on={themePref === 'dark'} onclick={() => pickTheme('dark')}>Sombre</button>
			</div>
		</section>

		<section class="card block">
			<h3>Couleur d’accent</h3>
			<p class="hint">Par défaut, suit la couleur choisie par l’admin de l’espace. Force ta propre couleur (ou le mode RGB) si tu préfères, sur tous les espaces.</p>
			{#if form?.accentPrefOk}<div class="flash ok">Préférence enregistrée ✓</div>{/if}
			<form method="POST" action="?/accentPref" use:enhance>
				<div class="seg">
					<button type="button" class:on={!accentOverride} onclick={() => (accentOverride = false)}>Suivre l’espace</button>
					<button type="button" class:on={accentOverride} onclick={() => (accentOverride = true)}>Personnaliser</button>
				</div>
				{#if accentOverride}
					<div style="margin-top:14px;">
						<AccentPicker bind:color={accentColor} bind:rgbMode={accentRgb} presets={PRESETS} />
					</div>
				{/if}
				<input type="hidden" name="mode" value={!accentOverride ? 'WORKSPACE' : accentRgb ? 'RGB' : 'CUSTOM'} />
				<input type="hidden" name="color" value={accentColor} />
				<button class="btn btn-primary" type="submit" style="margin-top:14px;">Enregistrer</button>
			</form>
		</section>

		<section class="card block">
			<h3>Effets saisonniers</h3>
			<p class="hint">Petites surprises visuelles liées aux périodes de l'année (ex. neige à Noël). Désactivable si tu préfères une interface sobre.</p>
			<div class="row">
				<div>
					<b>{activeSeasonal.length ? activeSeasonal.map((e) => e.label).join(' + ') : 'Aucun effet actif en ce moment'}</b>
					<span class="sub">{seasonalState.enabled ? 'Activés' : 'Désactivés'} sur cet appareil</span>
				</div>
				{#if seasonalState.enabled}
					<button class="btn btn-ghost" onclick={() => setSeasonalEnabled(false)}>Désactiver</button>
				{:else}
					<button class="btn btn-primary" onclick={() => setSeasonalEnabled(true)}>Activer</button>
				{/if}
			</div>

			{#if konamiState.unlocked}
				<div class="konami-force">
					<p class="hint" style="margin:16px 0 8px;">🕹️ Mode forcé — débloqué par le code Konami. Outrepasse la détection par date, pratique pour tester (ou juste pour le fun).</p>
					<div class="seg seg-wrap">
						<button type="button" class:on={!seasonalState.forced} onclick={() => setForcedEffect(null)}>Auto (date)</button>
						{#each SEASONAL_EFFECTS as e (e.id)}
							<button type="button" class:on={seasonalState.forced === e.id} onclick={() => setForcedEffect(e.id)}>{e.label}</button>
						{/each}
					</div>
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.settings {
		max-width: 680px;
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
	.saved {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--accent);
		background: var(--accent-tint-2);
		padding: 6px 12px;
		border-radius: 30px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
	}
	.row b {
		display: block;
		font-size: 14px;
	}
	.row .sub {
		font-size: 12.5px;
		color: var(--text-mute);
	}
	.prefs {
		margin-top: 16px;
		border-top: 1px solid var(--border);
		padding-top: 14px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.pref {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13.5px;
		color: var(--text-soft);
		cursor: pointer;
	}
	.pref.master {
		font-weight: 600;
		color: var(--text);
	}
	.pref.off {
		opacity: 0.5;
	}
	.pref input {
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
	}
	.test {
		align-self: flex-start;
		margin-top: 4px;
	}
	.seg {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		border-radius: 30px;
		background: var(--surface-sunk);
		border: 1px solid var(--border);
	}
	.seg button {
		padding: 7px 16px;
		border-radius: 30px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.seg button.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	/* Le sélecteur d'effet forcé (mode konami) a trop d'options à labels longs pour tenir sur
	   une ligne façon "segmented control" : on le laisse retomber en chips sur plusieurs lignes. */
	.seg-wrap {
		flex-wrap: wrap;
		border-radius: 14px;
	}
	.seg-wrap button {
		border-radius: 20px;
	}
</style>
