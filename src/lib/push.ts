// Client Web Push : permission, abonnement (clé publique VAPID), préférences.

export type NotifPrefs = {
	enabled: boolean;
	eveningMissing: boolean;
	morningYesterday: boolean;
	raeStale: boolean;
	weeklyRecap: boolean;
	moodDeadline: boolean;
	moodRecap: boolean;
	absencePending: boolean;
	absenceValidated: boolean;
};

export function pushSupported(): boolean {
	return (
		typeof window !== 'undefined' &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window
	);
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
	const padding = '='.repeat((4 - (base64.length % 4)) % 4);
	const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(b64);
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

export async function isSubscribed(): Promise<boolean> {
	if (!pushSupported()) return false;
	const reg = await navigator.serviceWorker.getRegistration();
	if (!reg) return false;
	return !!(await reg.pushManager.getSubscription());
}

/** Demande la permission, s'abonne et enregistre côté serveur. Renvoie true si OK. */
export async function subscribePush(vapidPublicKey: string): Promise<boolean> {
	if (!pushSupported() || !vapidPublicKey) return false;
	if ((await Notification.requestPermission()) !== 'granted') return false;
	const reg = await navigator.serviceWorker.ready;
	let sub = await reg.pushManager.getSubscription();
	if (!sub) {
		sub = await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource
		});
	}
	const res = await fetch('/api/push/subscribe', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(sub.toJSON())
	});
	return res.ok;
}

export async function unsubscribePush(): Promise<void> {
	if (!pushSupported()) return;
	const reg = await navigator.serviceWorker.getRegistration();
	const sub = reg && (await reg.pushManager.getSubscription());
	if (sub) {
		await fetch('/api/push/unsubscribe', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ endpoint: sub.endpoint })
		});
		await sub.unsubscribe();
	}
}

export async function saveNotifPrefs(prefs: NotifPrefs): Promise<void> {
	await fetch('/api/push/prefs', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(prefs)
	});
}

/** Renvoie le nombre de notifications réellement envoyées (0 si non abonné ou échec). */
export async function sendTestNotification(): Promise<number> {
	const res = await fetch('/api/push/test', { method: 'POST' });
	if (!res.ok) return 0;
	const { sent } = (await res.json()) as { sent: number };
	return sent;
}
