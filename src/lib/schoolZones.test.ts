import { describe, it, expect } from 'vitest';
import { isSchoolHoliday, type SchoolHolidayPeriod } from './schoolZones';

const periods: SchoolHolidayPeriod[] = [{ zone: 'A', label: 'Vacances de la Toussaint', startDate: '2025-10-18', endDate: '2025-11-03' }];

describe('isSchoolHoliday', () => {
	it('true sur les jours couverts, y compris la première borne', () => {
		expect(isSchoolHoliday('2025-10-18', 'A', periods)).toBe(true);
		expect(isSchoolHoliday('2025-11-02', 'A', periods)).toBe(true);
	});

	it('false sur la borne de fin (exclusive) et hors période', () => {
		expect(isSchoolHoliday('2025-11-03', 'A', periods)).toBe(false);
		expect(isSchoolHoliday('2025-10-17', 'A', periods)).toBe(false);
	});

	it("false pour une autre zone", () => {
		expect(isSchoolHoliday('2025-10-20', 'B', periods)).toBe(false);
	});
});
