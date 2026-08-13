// Vacances scolaires françaises (zones A/B/C) — constantes partagées client/serveur.

export const SCHOOL_ZONES = ['A', 'B', 'C'] as const;
export type SchoolZone = (typeof SCHOOL_ZONES)[number];

export const SCHOOL_ZONE_LABELS: Record<SchoolZone, string> = {
	A: 'Zone A',
	B: 'Zone B',
	C: 'Zone C'
};

export const SCHOOL_ZONE_COLORS: Record<SchoolZone, string> = {
	A: '#E76F51',
	B: '#2A9D8F',
	C: '#6A4C93'
};

export type SchoolHolidayPeriod = { zone: SchoolZone; label: string; startDate: string; endDate: string };

/** True si `dateISO` tombe dans une période de vacances de `zone` (borne de fin exclusive). */
export function isSchoolHoliday(dateISO: string, zone: SchoolZone, periods: SchoolHolidayPeriod[]): boolean {
	return periods.some((p) => p.zone === zone && dateISO >= p.startDate && dateISO < p.endDate);
}
