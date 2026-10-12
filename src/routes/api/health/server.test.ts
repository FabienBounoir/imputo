import { describe, it, expect, vi, afterEach } from 'vitest';
import { db } from '$lib/server/db';
import { GET } from './+server';

const call = () => GET({} as never) as Promise<Response>;

describe('GET /api/health', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('ok quand la base répond', async () => {
		const res = await call();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: 'ok' });
	});

	it('503 quand la base refuse la connexion', async () => {
		vi.spyOn(db, 'execute').mockRejectedValue(new Error('connect ECONNREFUSED'));
		const res = await call();
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ status: 'db_down' });
	});

	it('503 quand la base ne répond pas en 2 secondes', async () => {
		vi.useFakeTimers();
		vi.spyOn(db, 'execute').mockReturnValue(new Promise(() => {}) as never);
		const pending = call();
		await vi.advanceTimersByTimeAsync(2000);
		expect((await pending).status).toBe(503);
	});
});
