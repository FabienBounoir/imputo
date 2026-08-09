// Détection partagée du code Konami (↑↑↓↓←→←→BA). Le layout racine s'en sert pour les
// confettis ; une fois débloqué, ça reste acquis (localStorage) et d'autres pages peuvent
// réagir à `konamiState.unlocked` (ex. Réglages -> forcer un thème de période).

const KEY = 'imputo-konami-unlocked';
const SEQUENCE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

export const konamiState = $state({ unlocked: false });

export function initKonami() {
	if (typeof localStorage === 'undefined') return;
	konamiState.unlocked = localStorage.getItem(KEY) === '1';
}

let progress = 0;

/** À appeler sur chaque keydown. Retourne true si la séquence vient d'être complétée. */
export function trackKonamiKey(e: KeyboardEvent): boolean {
	const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
	if (key === SEQUENCE[progress]) {
		progress++;
		if (progress === SEQUENCE.length) {
			progress = 0;
			if (!konamiState.unlocked) {
				konamiState.unlocked = true;
				localStorage.setItem(KEY, '1');
			}
			return true;
		}
	} else {
		progress = key === SEQUENCE[0] ? 1 : 0;
	}
	return false;
}
