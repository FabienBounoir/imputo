// La fève du 6 janvier : cachée quelque part dans la page, elle se déplace de temps en temps.
// Qui la trouve porte la couronne sur son avatar jusqu'au lendemain — d'où la persistance
// locale datée, comme le thème (voir $lib/theme).

const KEY = 'imputo-feve';
const today = () => new Date().toISOString().slice(0, 10);

/** Couronne dessinée une fois, utilisée par la fève cachée ET par l'avatar couronné. */
export const CROWN_BODY = 'M3.4 17.6V7.9l4.6 3.4L12 4.6l4 6.7 4.6-3.4v9.7z';
export const CROWN_BAND = 'M4.2 18.6h15.6a1.3 1.3 0 0 1 0 2.6H4.2a1.3 1.3 0 0 1 0-2.6z';

export const epiphanyState = $state({ crowned: false });

/** À appeler une fois côté client : la couronne du jour survit à un rechargement. */
export function initEpiphany() {
	if (typeof localStorage === 'undefined') return;
	epiphanyState.crowned = localStorage.getItem(KEY) === today();
}

export function takeFeve() {
	epiphanyState.crowned = true;
	localStorage.setItem(KEY, today());
}
