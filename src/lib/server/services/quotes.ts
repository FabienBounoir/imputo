import { todayInParis } from '$lib/utils/date';

// L'API plafonne count à 10 (son message d'erreur dit 20, mais 11 est déjà refusé) et ignore
// minLength/maxLength : on tire donc deux paquets aléatoires et on filtre la longueur ici.
const API =
	'https://quickquote-api.vercel.app/api/quotes?lang=fr&category=motivation&sort=random&count=10';
const MIN_LEN = 20;
const MAX_LEN = 140;

// ponytail: cache mémoire par process, pas de table ni de CronJob. Conséquences assumées : un
// redémarrage refetch, et deux pods peuvent servir deux listes différentes le même jour — c'est
// cosmétique. Passer à une table `daily_quote` + /api/jobs/quotes si un jour il faut la même
// liste partout ou un historique.
let cache: { day: string; quotes: string[] } = { day: '', quotes: [] };

// API injoignable : on ne rappelle pas à chaque page vue (chaque essai coûte le timeout au
// rendu), et on continue à servir les phrases de la veille en attendant.
const RETRY_MS = 60_000;
let lastTry = 0;

// Filet quand l'API n'a jamais répondu depuis le démarrage (premier jour, API en carafe).
const FALLBACK = [
	'Un petit pas chaque jour vaut mieux qu’un grand pas jamais fait.',
	'La régularité bat l’intensité.',
	'Fait vaut mieux que parfait.'
];

/** Les phrases du jour (20 max), rechargées une fois par jour au premier appel. */
export async function getDailyQuotes(): Promise<string[]> {
	const day = todayInParis();
	if (cache.day === day) return cache.quotes;

	if (Date.now() - lastTry >= RETRY_MS) {
		lastTry = Date.now();
		const quotes = await fetchQuotes();
		if (quotes.length) cache = { day, quotes };
	}
	return cache.quotes.length ? cache.quotes : FALLBACK;
}

/** ~20 phrases distinctes = deux tirages aléatoires de 10, dédoublonnés. */
async function fetchQuotes(): Promise<string[]> {
	const packs = await Promise.all([fetchPack(), fetchPack()]);
	return [...new Set(packs.flat())];
}

async function fetchPack(): Promise<string[]> {
	try {
		const res = await fetch(API, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return [];
		const body = await res.json();
		return (Array.isArray(body?.data) ? body.data : [])
			// Certaines citations collent leur auteur avec un séparateur maison (« … @ -Kiyosaki »).
			.map((q: { text?: unknown }) => String(q?.text ?? '').replace(/\s*@\s*-\s*/, ' — ').trim())
			.filter((t: string) => t.length >= MIN_LEN && t.length <= MAX_LEN);
	} catch {
		// Réseau coupé, timeout, JSON invalide : jamais bloquant, on garde la liste précédente.
		return [];
	}
}
