// Constantes partagées client/serveur (formulaire, synthèse équipe, export Excel). Les valeurs
// doivent rester synchronisées avec absenceTypeEnum/absencePeriodEnum de db/schema.ts — ce fichier
// ne peut pas importer schema.ts (sous $lib/server), qui est interdit côté client.
import { monthBounds, addMonths, formatMonthShortLabel } from './utils/date';

export const ABSENCE_TYPES = ['CONGE_VALIDE', 'CONGE_PREVISIONNEL', 'FORMATION', 'HORS_PROJET'] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

export const ABSENCE_PERIODS = ['FULL', 'AM', 'PM'] as const;
export type AbsencePeriod = (typeof ABSENCE_PERIODS)[number];

export const ABSENCE_TYPE_LABELS: Record<AbsenceType, string> = {
	CONGE_VALIDE: 'Congé validé',
	CONGE_PREVISIONNEL: 'Congé prévisionnel',
	FORMATION: 'Formation',
	HORS_PROJET: 'Hors projet'
};

export const ABSENCE_PERIOD_LABELS: Record<AbsencePeriod, string> = {
	FULL: 'Journée complète',
	AM: 'Matinée',
	PM: 'Après-midi'
};

// Couleurs pleines (jour complet), reprises du fichier "Prévisions congés.xlsx" (rouge congé,
// vert formation, bleu hors-projet, or prévisionnel).
export const ABSENCE_TYPE_COLORS: Record<AbsenceType, string> = {
	CONGE_VALIDE: '#C00000',
	CONGE_PREVISIONNEL: '#FFC000',
	FORMATION: '#00B050',
	HORS_PROJET: '#4472C4'
};

// Étendue de la synthèse équipe / export : nombre de mois affichés à partir du mois ancre.
export const ABSENCE_SPANS = [1, 3, 6, 12] as const;
export type AbsenceSpan = (typeof ABSENCE_SPANS)[number];
export const ABSENCE_SPAN_LABELS: Record<AbsenceSpan, string> = {
	1: 'Mois',
	3: 'Trimestre',
	6: 'Semestre',
	12: 'Année'
};

/** Bornes [start, end] couvrant `span` mois à partir du mois contenant `anchorISO`. */
export function absenceRangeBounds(anchorISO: string, span: AbsenceSpan): { start: string; end: string } {
	const start = monthBounds(anchorISO).start;
	const end = monthBounds(addMonths(start, span - 1)).end;
	return { start, end };
}

/** Lit `?span=` depuis l'URL — retombe sur 1 (mois) si absent ou invalide. */
export function parseAbsenceSpan(raw: string | null): AbsenceSpan {
	const n = Number(raw);
	return (ABSENCE_SPANS as readonly number[]).includes(n) ? (n as AbsenceSpan) : 1;
}

/** Regroupe des jours ISO consécutifs par mois — en-tête « bandeau mois » de la synthèse/export/image. */
export function groupDaysByMonth(days: string[]): { label: string; count: number }[] {
	const groups: { label: string; count: number }[] = [];
	for (const d of days) {
		const label = formatMonthShortLabel(d);
		const last = groups[groups.length - 1];
		if (last?.label === label) last.count++;
		else groups.push({ label, count: 1 });
	}
	return groups;
}
