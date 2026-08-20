import { describe, it, expect, vi, afterEach } from 'vitest';

const reply = (texts: string[]) =>
	new Response(JSON.stringify({ data: texts.map((text) => ({ text })) }), {
		headers: { 'content-type': 'application/json' }
	});

// Le cache est un état de module : chaque cas repart d'un import neuf.
async function freshModule() {
	vi.resetModules();
	return import('./quotes');
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

// Un rafraîchissement = 2 appels HTTP (deux paquets aléatoires de 10, dédoublonnés).
const CALLS_PER_REFRESH = 2;

describe('getDailyQuotes', () => {
	it('ne rappelle l’API qu’une fois par jour, en dédoublonnant les deux paquets', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-20T10:00:00Z'));
		const fetchMock = vi.fn(async () => reply(['Une phrase assez longue pour passer le filtre.']));
		vi.stubGlobal('fetch', fetchMock);
		const { getDailyQuotes } = await freshModule();

		expect(await getDailyQuotes()).toEqual(['Une phrase assez longue pour passer le filtre.']);
		expect(await getDailyQuotes()).toEqual(['Une phrase assez longue pour passer le filtre.']);
		expect(fetchMock).toHaveBeenCalledTimes(CALLS_PER_REFRESH);

		fetchMock.mockResolvedValue(reply(['Une autre phrase, tout aussi longue et motivante.']));
		vi.setSystemTime(new Date('2026-08-21T10:00:00Z'));
		expect(await getDailyQuotes()).toEqual(['Une autre phrase, tout aussi longue et motivante.']);
		expect(fetchMock).toHaveBeenCalledTimes(2 * CALLS_PER_REFRESH);
	});

	it('écarte les phrases trop courtes ou trop longues', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => reply(['Trop court.', 'Une phrase de longueur raisonnable pour un bandeau.', 'x'.repeat(200)]))
		);
		const { getDailyQuotes } = await freshModule();
		expect(await getDailyQuotes()).toEqual(['Une phrase de longueur raisonnable pour un bandeau.']);
	});

	it('sert les phrases de la veille si l’API tombe, sans réessayer à chaque appel', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-20T10:00:00Z'));
		const veille = ['La phrase d’hier, gardée sous le coude.'];
		const fetchMock = vi.fn(async () => reply(veille));
		vi.stubGlobal('fetch', fetchMock);
		const { getDailyQuotes } = await freshModule();
		await getDailyQuotes();

		vi.setSystemTime(new Date('2026-08-21T10:00:00Z'));
		fetchMock.mockRejectedValue(new Error('timeout'));
		expect(await getDailyQuotes()).toEqual(veille);
		expect(await getDailyQuotes()).toEqual(veille);
		// 1 rafraîchissement la veille + 1 seul réessai malgré 2 appels (fenêtre RETRY_MS).
		expect(fetchMock).toHaveBeenCalledTimes(2 * CALLS_PER_REFRESH);
	});

	it('retombe sur les phrases embarquées si l’API n’a jamais répondu', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
		const { getDailyQuotes } = await freshModule();
		expect((await getDailyQuotes()).length).toBeGreaterThan(0);
	});
});
