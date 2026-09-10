/**
 * Préférence « Garder mes filtres » (Réglages) : ce qu'on choisit dans la barre doit être réappliqué
 * à la prochaine arrivée à blanc sur /tickets.
 *
 * Testé ici en e2e et pas seulement en unitaire parce que le bug d'origine vivait précisément dans
 * le trajet que seul le navigateur emprunte : navigateWith() mettait bien `sort` dans l'URL, mais
 * l'oubliait dans le POST vers ?/rememberFilters. Côté serveur, tout allait bien — le tri repartait
 * quand même au défaut à chaque retour sur la page.
 */
const TRI = 'select[aria-label="Trier par"]';

/** Arrive sur la page et pose un tri non-défaut, socle des deux scénarios ci-dessous. */
function visitEtTrie(valeur: string) {
	cy.visit('/tickets');
	cy.selectReliably(TRI, valeur);
	cy.location('search', { timeout: 10000 }).should('contain', `sort=${valeur}`);
}

describe('tickets — mémorisation des filtres et du tri', () => {
	it('le tri choisi survit à un départ et un retour sur la page', () => {
		cy.registerAndLogin().then(() => {
			visitEtTrie('priority_desc');

			// Quitter la page, puis y revenir SANS aucun paramètre : c'est l'arrivée à blanc qui
			// déclenche la réapplication des filtres mémorisés (une URL déjà paramétrée n'est jamais
			// réécrite, cf. +page.server.ts).
			cy.visit('/imputation');
			cy.location('pathname').should('eq', '/imputation');

			cy.visit('/tickets');
			cy.location('search').should('contain', 'sort=priority_desc');
			cy.get(TRI).should('have.value', 'priority_desc');
		});
	});

	it('un filtre et le tri sont mémorisés ensemble, et « Réinitialiser » ne fait tomber que le filtre', () => {
		cy.registerAndLogin().then(() => {
			visitEtTrie('created_desc');

			// typeReliably : la recherche est débouncée et déclenche une navigation qui re-rend le
			// champ — une frappe brute y perd des caractères (même motif que la commande existante).
			cy.typeReliably('input[placeholder*="Rechercher"]', 'ZZZINTROUVABLE');
			cy.location('search', { timeout: 10000 }).should('contain', 'q=ZZZINTROUVABLE');
			cy.location('search').should('contain', 'sort=created_desc');

			cy.visit('/tickets');
			cy.location('search').should('contain', 'q=ZZZINTROUVABLE');
			cy.location('search').should('contain', 'sort=created_desc');

			// « Réinitialiser » vide les filtres mais conserve le tri : c'est un choix d'affichage,
			// pas un filtre. Attente avant le clic pour la même raison que selectReliably : sur une
			// page tout juste chargée, un clic pré-hydratation part dans le vide sans être rejoué.
			cy.wait(1500);
			cy.contains('button', 'Réinitialiser').click();
			cy.location('search').should('not.contain', 'ZZZINTROUVABLE');
			cy.get(TRI).should('have.value', 'created_desc');

			cy.visit('/tickets');
			cy.get(TRI).should('have.value', 'created_desc');
		});
	});

	it('les quatre tris sont proposés', () => {
		cy.registerAndLogin().then(() => {
			cy.visit('/tickets');
			cy.get(`${TRI} option`).should('have.length', 4);
			for (const v of ['created', 'created_desc', 'priority', 'priority_desc']) {
				cy.get(`${TRI} option[value="${v}"]`).should('exist');
			}
		});
	});
});
