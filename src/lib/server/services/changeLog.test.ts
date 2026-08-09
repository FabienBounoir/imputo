import { describe, it, expect } from 'vitest';
import { makeWorkspace } from './test-helpers';
import { logChange, listEntityHistory, listWorkspaceHistoryPage } from './changeLog';

describe('changeLog', () => {
	it('logChange + listEntityHistory : retrouve l’historique d’une entité, plus récent en premier', async () => {
		const ws = await makeWorkspace('changelog');
		const ticketId = crypto.randomUUID();

		await logChange({
			workspaceId: ws.workspaceId,
			entityType: 'TICKET',
			entityId: ticketId,
			field: 'estimationReal',
			action: 'UPDATE',
			oldValue: '1',
			newValue: '2',
			changedById: ws.userId
		});
		await logChange({
			workspaceId: ws.workspaceId,
			entityType: 'TICKET',
			entityId: ticketId,
			field: 'estimationReal',
			action: 'UPDATE',
			oldValue: '2',
			newValue: '3',
			changedById: ws.userId
		});

		const history = await listEntityHistory(ws.workspaceId, 'TICKET', ticketId);
		expect(history).toHaveLength(2);
		expect(history[0].newValue).toBe('3'); // le plus récent d'abord
		expect(history[1].newValue).toBe('2');
		expect(history[0].changedByName).toBe('changelog owner');
	});

	it("ne mélange pas l'historique d'entités différentes ou d'un autre espace", async () => {
		const wsA = await makeWorkspace('cl-a');
		const wsB = await makeWorkspace('cl-b');
		const entityId = crypto.randomUUID();

		await logChange({
			workspaceId: wsA.workspaceId,
			entityType: 'ABSENCE',
			entityId,
			action: 'DELETE',
			oldValue: '2026-01-01',
			newValue: null,
			changedById: wsA.userId
		});
		await logChange({
			workspaceId: wsB.workspaceId,
			entityType: 'ABSENCE',
			entityId,
			action: 'DELETE',
			oldValue: '2026-02-02',
			newValue: null,
			changedById: wsB.userId
		});

		const historyA = await listEntityHistory(wsA.workspaceId, 'ABSENCE', entityId);
		expect(historyA).toHaveLength(1);
		expect(historyA[0].oldValue).toBe('2026-01-01');
	});

	it('listWorkspaceHistoryPage : filtre par type d’entité et pagine par curseur', async () => {
		const ws = await makeWorkspace('cl-page');
		for (let i = 0; i < 3; i++) {
			await logChange({
				workspaceId: ws.workspaceId,
				entityType: 'TICKET',
				entityId: crypto.randomUUID(),
				field: 'raeReal',
				action: 'UPDATE',
				oldValue: String(i),
				newValue: String(i + 1),
				changedById: ws.userId
			});
		}
		await logChange({
			workspaceId: ws.workspaceId,
			entityType: 'ABSENCE',
			entityId: crypto.randomUUID(),
			action: 'DELETE',
			oldValue: '2026-03-03',
			newValue: null,
			changedById: ws.userId
		});

		const ticketsOnly = await listWorkspaceHistoryPage(ws.workspaceId, { entityType: 'TICKET' });
		expect(ticketsOnly.entries).toHaveLength(3);
		expect(ticketsOnly.entries.every((e) => e.entityType === 'TICKET')).toBe(true);

		const firstPage = await listWorkspaceHistoryPage(ws.workspaceId, { limit: 2 });
		expect(firstPage.entries).toHaveLength(2);
		expect(firstPage.nextCursor).not.toBeNull();

		const secondPage = await listWorkspaceHistoryPage(ws.workspaceId, {
			limit: 2,
			cursor: firstPage.nextCursor!
		});
		expect(secondPage.entries.length).toBeGreaterThan(0);
		const firstIds = new Set(firstPage.entries.map((e) => e.id));
		expect(secondPage.entries.every((e) => !firstIds.has(e.id))).toBe(true);
	});
});
