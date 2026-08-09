import { describe, it, expect } from 'vitest';
import { POST } from './+server';
import { config } from '$lib/server/config';

describe('POST /api/jobs/cleanup', () => {
	it('rejette sans secret', async () => {
		const request = new Request('http://localhost/x');
		await expect(POST({ request, url: new URL('http://localhost/x') } as never)).rejects.toMatchObject({
			status: 401
		});
	});

	it('rejette avec un mauvais secret', async () => {
		const request = new Request('http://localhost/x', { headers: { authorization: 'Bearer wrong' } });
		await expect(POST({ request, url: new URL('http://localhost/x') } as never)).rejects.toMatchObject({
			status: 401
		});
	});

	it('accepte le bon secret via le header Authorization', async () => {
		const request = new Request('http://localhost/x', {
			headers: { authorization: `Bearer ${config.cronSecret}` }
		});
		const res = await POST({ request, url: new URL('http://localhost/x') } as never);
		const body = await res.json();
		expect(body.ok).toBe(true);
	});

	it('accepte le bon secret via ?secret=', async () => {
		const url = new URL(`http://localhost/x?secret=${config.cronSecret}`);
		const request = new Request(url);
		const res = await POST({ request, url } as never);
		expect((await res.json()).ok).toBe(true);
	});
});
