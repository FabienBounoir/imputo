import { describe, expect, it } from 'vitest';
import { appendJiraTestPage } from './jiraTestPage';

const issue = (key: string) => ({ key, summary: key, isNew: false });

describe('appendJiraTestPage', () => {
	it('écarte un ticket renvoyé deux fois par Jira sans décaler la page suivante', () => {
		const first = appendJiraTestPage([], 0, { issues: [issue('A-1'), issue('A-2')], total: 5 });
		const second = appendJiraTestPage(first.issues, first.nextStart, {
			issues: [issue('A-3'), issue('A-3'), issue('A-2')],
			total: 5
		});
		expect(second.issues.map((i) => i.key)).toEqual(['A-1', 'A-2', 'A-3']);
		expect(second.nextStart).toBe(5);
	});

	it("s'arrête sur une page vide alors que Jira en annonce davantage", () => {
		expect(appendJiraTestPage([issue('A-1')], 1, { issues: [], total: 9 }).nextStart).toBe(9);
	});
});
