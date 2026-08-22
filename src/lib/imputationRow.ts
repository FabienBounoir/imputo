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
	raeReal: number | null;
	estimation: number | null;
	amounts: Record<string, number>;
	/** Jours issus d'une absence validée (day ISO → id de l'absence) — non éditables ici. */
	lockedDays: Record<string, string>;
	/** Type d'absence lié à la catégorie de cette ligne — pilote la couleur des cases verrouillées. */
	absenceType: AbsenceType | null;
};
