import { describe, it, expect } from 'vitest';
import { jiraTicketUrl } from './jiraLink';

const base = { jiraBaseUrl: 'https://jira.example.com', jiraLinkEnabled: true, jiraLinkKeyRegexPattern: null, jiraLinkKeyRegexReplacement: null };

describe('jiraTicketUrl', () => {
	it('null si le lien est désactivé', () => {
		expect(jiraTicketUrl({ ...base, jiraLinkEnabled: false }, 'BLM-123')).toBeNull();
	});

	it('clé telle quelle si aucune regex de reconstruction', () => {
		expect(jiraTicketUrl(base, 'BLM-123')).toBe('https://jira.example.com/browse/BLM-123');
	});

	it('applique la regex inverse pour reconstruire la clé Jira réelle', () => {
		const cfg = { ...base, jiraLinkKeyRegexPattern: '^', jiraLinkKeyRegexReplacement: 'CARTEJEUNE_' };
		expect(jiraTicketUrl(cfg, 'BLM-123')).toBe('https://jira.example.com/browse/CARTEJEUNE_BLM-123');
	});

	it('null si la regex est invalide plutôt que de planter', () => {
		const cfg = { ...base, jiraLinkKeyRegexPattern: '(', jiraLinkKeyRegexReplacement: '' };
		expect(jiraTicketUrl(cfg, 'BLM-123')).toBeNull();
	});

	it('encode la clé reconstruite dans l’URL', () => {
		expect(jiraTicketUrl(base, 'BLM 123')).toBe('https://jira.example.com/browse/BLM%20123');
	});
});
