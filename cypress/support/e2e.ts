// Juste après une navigation déclenchée par un submit natif (pas cy.visit), Cypress reprend
// parfois la main un instant avant que la page soit vraiment prête à recevoir des frappes, ce
// qui avale les premiers caractères tapés. On retape tant que la valeur ne correspond pas.
Cypress.Commands.add('typeReliably', (selector: string, text: string) => {
	cy.get(selector).clear().type(text);
	cy.get(selector).then(($el) => {
		if (($el.val() as string) !== text) cy.get(selector).clear().type(text);
	});
	cy.get(selector).should('have.value', text);
});

// Même famille de piège que typeReliably, mais pour les clics : juste après un cy.visit() (ou une
// première interaction sur une page qui vient de s'afficher), Svelte peut ne pas avoir fini
// d'attacher ses listeners onclick — le clic atterrit dans le vide. On reclique si l'effet attendu
// (apparition de expectSelector) ne s'est pas produit.
Cypress.Commands.add('clickReliably', (find: () => Cypress.Chainable, expectSelector: string) => {
	find().click();
	// Laisse une vraie fenêtre de temps s'écouler avant de vérifier — un check synchrone juste
	// après le clic voit toujours "pas encore là" (le re-rendu Svelte n'est pas instantané) et
	// déclenchait un second clic qui annulait le premier sur un bouton toggle.
	cy.wait(300);
	cy.get('body').then(($body) => {
		if ($body.find(expectSelector).length === 0) find().click();
	});
	// `exist` et non `be.visible` : le résultat peut être sous le pli d'une zone scrollable, ce
	// que .type()/.click() gèrent déjà tout seuls (auto-scroll) sans qu'on ait à s'en soucier ici.
	cy.get(expectSelector).should('exist');
});

Cypress.Commands.add('registerAndLogin', (overrides = {}) => {
	const rnd = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
	const account = {
		email: `e2e-${rnd}@acme.test`,
		password: 'password123',
		workspaceName: 'Espace E2E',
		displayName: 'Test E2E',
		...overrides
	};

	cy.visit('/register');
	cy.get('#ws').type(account.workspaceName).should('have.value', account.workspaceName);
	cy.get('#dn').type(account.displayName).should('have.value', account.displayName);
	cy.get('#em').type(account.email).should('have.value', account.email);
	cy.get('#pw').type(account.password).should('have.value', account.password);
	cy.get('button[type=submit]').click();
	cy.location('pathname').should('eq', '/imputation');

	return cy.wrap(account, { log: false });
});

export type RegisteredAccount = {
	email: string;
	password: string;
	workspaceName: string;
	displayName: string;
};

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Cypress {
		interface Chainable {
			typeReliably(selector: string, text: string): Chainable<void>;
			clickReliably(find: () => Chainable, expectSelector: string): Chainable<void>;
			registerAndLogin(overrides?: Partial<RegisteredAccount>): Chainable<RegisteredAccount>;
		}
	}
}
