import { SCHOOL_ZONES, type SchoolHolidayPeriod } from '$lib/schoolZones';

const API_URL = 'https://data.education.gouv.fr/api/records/1.0/search/';
const TTL_MS = 24 * 60 * 60 * 1000;

let cache: { key: string; at: number; data: SchoolHolidayPeriod[] } | null = null;

type ApiRecord = { fields: { description: string; population: string; start_date: string; end_date: string } };

function schoolYearsBetween(startISO: string, endISO: string): string[] {
	const years = new Set<string>();
	for (const iso of [startISO, endISO]) {
		const [y, m] = iso.split('-').map(Number);
		// "Vacances d'Été" d'une année scolaire déborde jusqu'à fin août dans le jeu de données —
		// la rentrée (nouvelle année scolaire) n'est donc atteinte qu'en septembre.
		const startYear = m >= 9 ? y : y - 1;
		years.add(`${startYear}-${startYear + 1}`);
	}
	return [...years];
}

// L'API stocke les horodatages comme minuit Paris de la veille en UTC — reformater dans le fuseau
// Europe/Paris récupère le vrai jour calendaire de début/fin de vacances.
function parisDate(iso: string): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso));
}

/**
 * Vacances scolaires (zones A/B/C) chevauchant [startISO, endISO] — source : API officielle
 * data.education.gouv.fr. Échec réseau = pas de bandeau plutôt qu'une page cassée.
 */
export async function getSchoolHolidays(startISO: string, endISO: string): Promise<SchoolHolidayPeriod[]> {
	const key = `${startISO}_${endISO}`;
	if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.data;

	try {
		const years = schoolYearsBetween(startISO, endISO);
		const lists = await Promise.all(
			SCHOOL_ZONES.flatMap((zone) =>
				years.map(async (year) => {
					// rows=100 : chaque zone regroupe ~15-25 académies, chacune dupliquant les mêmes
					// périodes — largement sous les ~35-80 lignes brutes observées par zone/année.
					const url = `${API_URL}?dataset=fr-en-calendrier-scolaire&rows=100&refine.zones=Zone+${zone}&refine.annee_scolaire=${year}`;
					const res = await fetch(url);
					if (!res.ok) return [];
					const body = (await res.json()) as { records: ApiRecord[] };
					// "Enseignants" a des bornes légèrement différentes des élèves (été surtout) — on garde
					// la population par défaut ("-") ou "Élèves" pour éviter les doublons de dates.
					return body.records
						.filter((r) => r.fields.population !== 'Enseignants')
						.map((r) => ({
							zone,
							label: r.fields.description,
							startDate: parisDate(r.fields.start_date),
							endDate: parisDate(r.fields.end_date)
						}));
				})
			)
		);

		const seen = new Set<string>();
		const periods: SchoolHolidayPeriod[] = [];
		for (const p of lists.flat()) {
			const dedupeKey = `${p.zone}_${p.label}_${p.startDate}_${p.endDate}`;
			if (seen.has(dedupeKey) || p.endDate <= startISO || p.startDate >= endISO) continue;
			seen.add(dedupeKey);
			periods.push(p);
		}

		cache = { key, at: Date.now(), data: periods };
		return periods;
	} catch {
		return [];
	}
}
