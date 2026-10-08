// Pagination de l'aperçu « Tester ce JQL » (modale de l'admin, chargement au scroll).
export type JiraTestIssue = { key: string; summary: string; isNew: boolean };

/**
 * Ajoute une page Jira aux tickets déjà affichés et donne la position de la page suivante.
 * Jira peut renvoyer deux fois le même ticket (vu en preprod : 42 annoncés, 41 distincts) : la liste
 * étant indexée par clé, un doublon faisait planter le rendu et laissait « Chargement… » affiché.
 * La position suivante compte ce que Jira a renvoyé, doublons compris, et pas la longueur de la liste
 * affichée — sinon chaque page redemanderait un ticket déjà vu.
 */
export function appendJiraTestPage(
	shown: JiraTestIssue[],
	startAt: number,
	page: { issues: JiraTestIssue[]; total: number }
): { issues: JiraTestIssue[]; nextStart: number } {
	const seen = new Set(shown.map((i) => i.key));
	const fresh = page.issues.filter((i) => !seen.has(i.key) && seen.add(i.key));
	return {
		issues: [...shown, ...fresh],
		// Page vide alors que Jira en annonce davantage : on s'arrête, plutôt que de redemander sans fin.
		nextStart: page.issues.length ? startAt + page.issues.length : page.total
	};
}
