/** Convertit une teinte HSL en hex, pour faire tourner l'accent (mode RGB). */
export function hslToHex(h: number, s: number, l: number) {
	s /= 100;
	l /= 100;
	const k = (n: number) => (n + h / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	const toHex = (x: number) => Math.round(255 * x).toString(16).padStart(2, '0');
	return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/** Assombrit une couleur hex `#rrggbb` d'un facteur 0–1 — pour un dégradé à 2 tons depuis une seule couleur d'accent. */
export function darkenHex(hex: string, amount: number) {
	const n = parseInt(hex.slice(1), 16);
	const shade = (byte: number) => Math.round(byte * (1 - amount)).toString(16).padStart(2, '0');
	return `#${shade((n >> 16) & 255)}${shade((n >> 8) & 255)}${shade(n & 255)}`;
}
