import { env } from '$env/dynamic/private';
import { createDb } from './connection';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

export const db = createDb(env.DATABASE_URL);
export * from './schema';
