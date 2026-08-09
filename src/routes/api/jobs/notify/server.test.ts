import { describe, it, expect } from 'vitest';
import { POST } from './+server';
import { config } from '$lib/server/config';

function authedUrl(qs: string) {
	return new URL(`http://localhost/x?secret=${config.cronSecret}&${qs}`);
}

describe('POST /api/jobs/notify', () => {
	it('rejette sans secret', async () => {
		const url = new URL('http://localhost/x?kind=morning');
		await expect(POST({ request: new Request(url), url } as never)).rejects.toMatchObject({ status: 401 });
	});

	it('rejette avec un mauvais secret', async () => {
		const url = new URL('http://localhost/x?kind=morning&secret=wrong');
		await expect(POST({ request: new Request(url), url } as never)).rejects.toMatchObject({ status: 401 });
	});

	it('rejette un kind invalide même avec le bon secret', async () => {
		const url = authedUrl('kind=bogus');
		await expect(POST({ request: new Request(url), url } as never)).rejects.toMatchObject({ status: 400 });
	});

	it('accepte le bon secret + un kind valide', async () => {
		const url = authedUrl('kind=morning');
		const res = await POST({ request: new Request(url), url } as never);
		expect((await res.json()).ok).toBe(true);
	});
});
