<script lang="ts">
	import { onMount } from 'svelte';
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

	let { data } = $props();

	let supported = $state(true);
	let subscribed = $state(false);
	let busy = $state(false);
	let flash = $state('');
	let prefs = $state<NotifPrefs>({ ...data.prefs });
	let themePref = $state<ThemePref>('system');

	const TYPES: { key: keyof NotifPrefs; label: string }[] = [
		{ key: 'eveningMissing', label: "Soir : imputation du jour non saisie" },
		{ key: 'morningYesterday', label: 'Matin : la veille n’a pas été renseignée' },
		{ key: 'raeStale', label: 'RAE périmé sur mes tickets' },
		{ key: 'weeklyRecap', label: 'Récap du vendredi (semaine incomplète)' }
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
		const ok = await sendTestNotification();
		note(ok ? 'Notification de test envoyée.' : 'Échec de l’envoi (abonné ?).');
	}
	function pickTheme(p: ThemePref) {
		themePref = p;
		setTheme(p);
	}
</script>

<div class="topbar">
	<h1>Réglages<small>Préférences personnelles</small></h1>
	<div class="spacer"></div>
	{#if flash}<span class="saved">{flash}</span>{/if}
</div>

<div class="content settings">
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

	<section class="card block">
		<h3>Thème</h3>
		<p class="hint">Apparence de l’interface. « Système » suit le réglage de ton appareil.</p>
		<div class="seg">
			<button type="button" class:on={themePref === 'system'} onclick={() => pickTheme('system')}>Système</button>
			<button type="button" class:on={themePref === 'light'} onclick={() => pickTheme('light')}>Clair</button>
			<button type="button" class:on={themePref === 'dark'} onclick={() => pickTheme('dark')}>Sombre</button>
		</div>
	</section>
</div>

<style>
	.settings {
		max-width: 680px;
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
</style>
