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

// Cypress vérifie qu'un élément est actionnable (visible, pas animé, reçoit les events) avant de
// cliquer, mais ça ne garantit PAS que le listener Svelte est déjà attaché : sur une page qui
// vient de se charger, l'hydratation peut prendre jusqu'à ~1-2s (mesuré sur /tickets, page assez
// lourde) avant qu'un clic ait un effet. Un simple clic + should('exist') échoue donc si le clic
// est parti pendant cette fenêtre. On laisse une vraie marge avant de juger que rien ne s'est
// passé — une marge trop courte (300ms, testé) reclique alors qu'un rendu juste un peu lent était
// en fait en train d'aboutir, et un reclic sur un bouton toggle referme ce qu'il vient d'ouvrir.
Cypress.Commands.add('clickReliably', (find: () => Cypress.Chainable, expectSelector: string) => {
	find().click();
	cy.wait(2000);
	cy.get('body').then(($body) => {
		if ($body.find(expectSelector).length === 0) find().click();
	});
	// `exist` et non `be.visible` : le résultat peut être sous le pli d'une zone scrollable, ce
	// que .type()/.click() gèrent déjà tout seuls (auto-scroll) sans qu'on ait à s'en soucier ici.
	cy.get(expectSelector, { timeout: 4000 }).should('exist');
});

// Les référentiels de /admin sont derrière un sous-menu (une section affichée à la fois) et un
// formulaire d'ajout replié : deux clics avant de pouvoir taper. Le placeholder de la recherche
// sert de témoin — c'est le seul élément propre à une section donnée qui existe avant tout ajout.
Cypress.Commands.add('gotoRefSection', (label: string, searchPlaceholder: string) => {
	cy.clickReliably(() => cy.contains('button', 'Référentiels'), 'nav.ref-nav');
	cy.clickReliably(
		() => cy.contains('nav.ref-nav button', label),
		`input[placeholder="${searchPlaceholder}"]`
	);
});
Cypress.Commands.add('openRefAddForm', (expectSelector: string) => {
	cy.get('button.ref-add-icon-btn').click();
	cy.get(expectSelector).should('exist');
});

// Premier login (register OU activation d'une invitation) : le tour d'onboarding (driver.js,
// TourHost.svelte) s'auto-lance sur /imputation et pose un pointer-events:none sur le reste de la
// page tant qu'il n'est pas fermé — sans ça, tout clic suivant dans les specs échoue. On laisse le
// temps à l'effet onMount de le monter, puis on le ferme s'il est là (le close POST /tour, donc il
// ne réapparaît pas sur les pages suivantes).
Cypress.Commands.add('dismissOnboardingTour', () => {
	cy.wait(1500);
	cy.get('body').then(($body) => {
		if ($body.find('.driver-popover-close-btn').length) {
			cy.get('.driver-popover-close-btn').click();
		}
	});
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
	cy.dismissOnboardingTour();

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
			gotoRefSection(label: string, searchPlaceholder: string): Chainable<void>;
			openRefAddForm(expectSelector: string): Chainable<void>;
			dismissOnboardingTour(): Chainable<void>;
			registerAndLogin(overrides?: Partial<RegisteredAccount>): Chainable<RegisteredAccount>;
		}
	}
}
