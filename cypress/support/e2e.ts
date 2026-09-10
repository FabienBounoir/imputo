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

/**
 * Change la valeur d'un <select> et déclenche le gestionnaire Svelte.
 *
 * `cy.get(sel).select(v)` ne suffit pas ici : Svelte 5 écoute `change` par délégation depuis la
 * racine de l'app, et l'événement produit par Cypress ne réveille pas ce gestionnaire — la valeur
 * se pose bien dans le DOM (l'assertion `have.value` passe) mais rien ne se passe ensuite, ce qui
 * donne un échec très trompeur. Idem si l'on construit l'événement soi-même dans un `.then()` :
 * `new Event(...)` y utilise le realm du runner, pas celui de la page.
 *
 * On passe donc par `cy.window()` pour émettre un événement du BON realm, celui de l'application.
 */
Cypress.Commands.add('selectReliably', (selector: string, value: string) => {
	cy.get(selector).should('exist');
	// Cypress réessaie les ASSERTIONS, jamais les INTERACTIONS : un changement émis avant que Svelte
	// n'ait attaché ses gestionnaires part une fois dans le vide et n'est jamais rejoué — l'assertion
	// qui suit échoue alors jusqu'au bout de son timeout, quel qu'il soit. D'où cette attente, même
	// principe que clickReliably.
	cy.wait(1500);
	cy.window().then((win) => {
		const el = win.document.querySelector(selector) as HTMLSelectElement | null;
		if (!el) throw new Error(`selectReliably: aucun élément pour « ${selector} »`);
		el.value = value;
		el.dispatchEvent(new win.Event('change', { bubbles: true }));
	});
	cy.get(selector).should('have.value', value);
});

/**
 * Génère une invitation et renvoie le lien.
 *
 * Le lien n'est PLUS dans le DOM en temps normal : depuis « update invite message to include a
 * link », il part directement dans le presse-papier, et le bloc `.invite-msg` n'apparaît qu'en
 * repli, si la copie automatique échoue. Lire le DOM ne marche donc plus — on intercepte
 * `clipboard.writeText` pour récupérer l'argument, ce qui teste au passage le vrai chemin nominal
 * plutôt que son repli.
 *
 * À appeler une fois le formulaire d'invitation rempli (#dn, #em, éventuellement #ro).
 */
Cypress.Commands.add('generateInviteLink', () => {
	cy.window().then((win) => {
		cy.stub(win.navigator.clipboard, 'writeText').as('inviteCopy').resolves();
	});
	cy.contains('button', "Générer l'invitation").click();
	return cy
		.get('@inviteCopy')
		.should('have.been.called')
		.then((stub) => {
			const copied = String((stub as unknown as sinon.SinonStub).args[0][0]);
			const match = copied.match(/\/invite\/\S+/);
			expect(match, "lien d'invitation présent dans le presse-papier").to.not.be.null;
			return cy.wrap(match![0], { log: false });
		});
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
			/** Clique « Générer l'invitation » et renvoie le chemin /invite/… récupéré du presse-papier. */
			generateInviteLink(): Chainable<string>;
			/** Change un <select> en émettant un `change` du realm de la page (cf. la commande). */
			selectReliably(selector: string, value: string): Chainable<void>;
		}
	}
}
