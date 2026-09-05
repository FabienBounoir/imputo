import type { AbsenceType } from '$lib/absenceTypes';

/**
 * Ligne de la feuille d'imputation côté client — miroir de ImputationRow
 * ($lib/server/services/imputation.ts, non importable ici) partagé entre la page et la vue mobile.
 */
export type Row = {
	rowKey: string;
	targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE';
	targetId: string;
	activityId: string | null;
	/** Objectif hebdo TICKET à l'origine de la ligne (distingue deux objectifs sur le même ticket) — null hors ce cas. */
	objectiveId: string | null;
	/** Note propre à cet objectif TICKET (weeklyObjective.label) — distincte du commentaire partagé du ticket. */
	objectiveNote: string | null;
	label: string;
	sublabel: string;
	emoji: string | null;
	nonProductive: boolean;
	sprintName: string | null;
	versionName: string | null;
	/** Périmètre du ticket — `null` pour une catégorie ou un objectif libre, qui n'en ont pas. */
	perimeterId: string | null;
	perimeterName: string | null;
	perimeterColor: string | null;
	perimeterTransverse: boolean;
	/** Ordre du périmètre dans l'espace ; les lignes sans périmètre portent MAX_SAFE_INTEGER. */
	perimeterSortOrder: number;
	raeReal: number | null;
	estimation: number | null;
	amounts: Record<string, number>;
	/** Jours issus d'une absence validée (day ISO → id de l'absence) — non éditables ici. */
	lockedDays: Record<string, string>;
	/** Type d'absence lié à la catégorie de cette ligne — pilote la couleur des cases verrouillées. */
	absenceType: AbsenceType | null;
};

/** Les lignes sans périmètre (catégories, absences, objectifs libres) forment la dernière section. */
export const NO_PERIMETER_ORDER = Number.MAX_SAFE_INTEGER;
export const NO_PERIMETER_LABEL = 'Catégories';

/**
 * Ordre d'affichage des lignes de la feuille : par périmètre, puis par libellé.
 *
 * Vit ici (et non dans `$lib/server/services/imputation.ts`) pour être appliqué des DEUX côtés avec
 * exactement la même règle : le serveur trie ce qu'il envoie, et la page retrie après avoir ajouté
 * les épingles, les objectifs et les lignes créées à la volée — sinon une ligne neuve atterrirait
 * en bas de la grille, sous le mauvais en-tête de section.
 *
 * `rowKey` en dernier départage deux lignes de même libellé (même ticket, deux activités) : sans
 * lui l'ordre resterait instable d'un rendu à l'autre.
 */
export function compareRows(
	a: Pick<Row, 'perimeterSortOrder' | 'perimeterName' | 'label' | 'rowKey'>,
	b: Pick<Row, 'perimeterSortOrder' | 'perimeterName' | 'label' | 'rowKey'>
): number {
	return (
		a.perimeterSortOrder - b.perimeterSortOrder ||
		(a.perimeterName ?? '').localeCompare(b.perimeterName ?? '') ||
		a.label.localeCompare(b.label) ||
		a.rowKey.localeCompare(b.rowKey)
	);
}
