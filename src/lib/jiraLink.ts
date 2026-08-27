export type JiraLinkConfig = {
	jiraBaseUrl: string;
	jiraLinkEnabled: boolean;
	jiraLinkKeyRegexPattern: string | null;
	jiraLinkKeyRegexReplacement: string | null;
};

/**
 * URL Jira pour une clé locale de ticket, ou null si le lien est désactivé pour l'espace ou si la
 * regex de reconstruction est invalide. jiraLinkKeyRegexPattern va de la clé locale vers la clé
 * Jira réelle — le sens inverse de jiraKeyRegexPattern (utilisé au sync), cf. schema.ts.
 */
export function jiraTicketUrl(cfg: JiraLinkConfig, key: string): string | null {
	if (!cfg.jiraLinkEnabled) return null;
	let realKey = key;
	if (cfg.jiraLinkKeyRegexPattern) {
		try {
			realKey = key.replace(new RegExp(cfg.jiraLinkKeyRegexPattern), cfg.jiraLinkKeyRegexReplacement ?? '');
		} catch {
			return null;
		}
	}
	return `${cfg.jiraBaseUrl}/browse/${encodeURIComponent(realKey)}`;
}
