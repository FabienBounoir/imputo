<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { parseDuration, formatDuration } from '$lib/supportDuration';

	// Saisie rapide du temps passé sur un ticket de support (Shift+T, n'importe quelle page) — cf.
	// /api/support-time. Pas de launcher visible : purement au clavier, comme le spotlight global
	// (CommandPalette.svelte) — ce composant n'existe que pour armer le raccourci et héberger la
	// petite palette qu'il ouvre, il n'a rien à afficher tant qu'elle est fermée.
	let { enabled }: { enabled: boolean } = $props();

	let open = $state(false);
	let ticketRef = $state('');
	let durationRaw = $state('');
	let error = $state('');
	let submitting = $state(false);
	let ticketInput: HTMLInputElement | null = $state(null);
	let durationInput: HTMLInputElement | null = $state(null);

	const parsedMinutes = $derived(durationRaw.trim() ? parseDuration(durationRaw) : null);

	function openPalette() {
		open = true;
		ticketRef = '';
		durationRaw = '';
		error = '';
		queueMicrotask(() => ticketInput?.focus());
	}
	function closePalette() {
		open = false;
	}
	function onTicketKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (ticketRef.trim()) durationInput?.focus();
		}
	}
	function onDurationKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			submit();
		}
	}
	async function submit() {
		const ref = ticketRef.trim();
		if (!ref) {
			error = 'Identifiant de ticket requis.';
			ticketInput?.focus();
			return;
		}
		const minutes = parsedMinutes;
		if (minutes === null || minutes <= 0) {
			error = 'Durée invalide — ex. 1h, 45m, 1h30m, 2 (= 2h).';
			durationInput?.focus();
			return;
		}
		submitting = true;
		error = '';
		try {
			const res = await fetch('/api/support-time', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ticketRef: ref, duration: durationRaw })
			});
			const data = await res.json();
			if (!res.ok) {
				error = data?.error ?? 'Erreur.';
				return;
			}
			toast.success('Temps enregistré ✓', { description: `${ref} · ${formatDuration(minutes)}` });
			closePalette();
		} catch {
			error = 'Erreur réseau — réessaie.';
		} finally {
			submitting = false;
		}
	}
	function isTypingElsewhere(e: KeyboardEvent): boolean {
		const el = e.target as HTMLElement | null;
		if (!el || el === ticketInput || el === durationInput) return false;
		const tag = el.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
	}
	function onWindowKeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			e.preventDefault();
			closePalette();
			return;
		}
		if (
			!open &&
			enabled &&
			e.key.toLowerCase() === 't' &&
			e.shiftKey &&
			!e.metaKey &&
			!e.ctrlKey &&
			!e.altKey &&
			!isTypingElsewhere(e)
		) {
			e.preventDefault();
			openPalette();
		}
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="st-veil" onclick={closePalette}>
		<div class="st-palette" onclick={(e) => e.stopPropagation()}>
			<h3>Temps sur un ticket de support</h3>
			<div class="st-field">
				<label for="st-ticket">Ticket</label>
				<input
					id="st-ticket"
					bind:this={ticketInput}
					bind:value={ticketRef}
					onkeydown={onTicketKeydown}
					type="text"
					autocomplete="off"
					autocapitalize="off"
					autocorrect="off"
					spellcheck="false"
					placeholder="INC-1234"
				/>
			</div>
			<div class="st-field">
				<label for="st-duration">Durée</label>
				<input
					id="st-duration"
					bind:this={durationInput}
					bind:value={durationRaw}
					onkeydown={onDurationKeydown}
					type="text"
					autocomplete="off"
					autocapitalize="off"
					autocorrect="off"
					spellcheck="false"
					placeholder="1h, 45m, 1h30m, 2 (= 2h)…"
				/>
				{#if durationRaw.trim()}
					<span class="st-preview" class:st-preview-invalid={parsedMinutes === null}>
						{parsedMinutes === null ? 'Format non reconnu' : `→ ${formatDuration(parsedMinutes)}`}
					</span>
				{/if}
			</div>
			{#if error}<p class="st-error">{error}</p>{/if}
			<div class="st-footer">
				<span>Entrée valider · Échap fermer</span>
				<button type="button" class="btn btn-primary" onclick={submit} disabled={submitting}>Enregistrer</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.st-veil {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 16px;
		padding-top: min(14vh, 100px);
		z-index: 60;
	}
	.st-palette {
		width: 100%;
		max-width: 380px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
		padding: 20px;
	}
	.st-palette h3 {
		font-family: var(--font-display);
		font-size: 17px;
		font-weight: 600;
		margin: 0 0 14px;
	}
	.st-field {
		margin-bottom: 12px;
	}
	.st-field label {
		display: block;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-soft);
		margin-bottom: 5px;
	}
	.st-field input {
		width: 100%;
		box-sizing: border-box;
		padding: 9px 12px;
		border-radius: var(--r-md, 10px);
		border: 1px solid var(--border);
		background: var(--surface-2, var(--surface));
		color: var(--text);
		font: inherit;
		/* >=16px : sous ce seuil, iOS Safari zoome la page au focus d'un champ. */
		font-size: 16px;
		outline: none;
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	.st-field input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-tint, transparent);
	}
	.st-preview {
		display: block;
		margin-top: 5px;
		font-size: 12px;
		color: var(--accent-ink, var(--accent));
		font-weight: 600;
	}
	.st-preview-invalid {
		color: var(--warn);
		font-weight: 500;
	}
	.st-error {
		margin: 0 0 12px;
		font-size: 12.5px;
		color: var(--warn);
	}
	.st-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		font-size: 11.5px;
		color: var(--text-mute);
	}
</style>
