import { describe, it, expect } from 'vitest';
import { makeWorkspace } from './test-helpers';
import { createTicket } from './tickets';
import { listRefs, createRef, renameRef, setRefArchived } from './referentials';

describe('referentials', () => {
	for (const type of ['project', 'sprint', 'version'] as const) {
		it(`crée, renomme et archive un(e) ${type}`, async () => {
			const { workspaceId } = await makeWorkspace(`ref-${type}`);
			await createRef(workspaceId, type, 'Initial');
			let refs = await listRefs(workspaceId, type);
			const r = refs.find((x) => x.name === 'Initial');
			expect(r).toMatchObject({ archived: false, usage: 0 });

			await renameRef(workspaceId, type, r!.id, 'Renommé');
			await setRefArchived(workspaceId, type, r!.id, true);
			refs = await listRefs(workspaceId, type);
			expect(refs.find((x) => x.id === r!.id)).toMatchObject({ name: 'Renommé', archived: true });

			await setRefArchived(workspaceId, type, r!.id, false);
			refs = await listRefs(workspaceId, type);
			expect(refs.find((x) => x.id === r!.id)?.archived).toBe(false);
		});

		it(`refuse deux ${type}s actifs de même nom`, async () => {
			const { workspaceId } = await makeWorkspace(`ref-dup-${type}`);
			await createRef(workspaceId, type, 'Doublon');
			await expect(createRef(workspaceId, type, 'doublon')).rejects.toThrow();
		});
	}

	it('sprint et version sont des référentiels distincts malgré le même stockage', async () => {
		const { workspaceId } = await makeWorkspace('ref-kind');
		await createRef(workspaceId, 'sprint', 'Même nom');
		// Le même nom est autorisé côté version : ce sont deux `kind` différents dans la même table.
		await createRef(workspaceId, 'version', 'Même nom');

		expect((await listRefs(workspaceId, 'sprint')).map((r) => r.name)).toEqual(['Même nom']);
		expect((await listRefs(workspaceId, 'version')).map((r) => r.name)).toEqual(['Même nom']);
	});

	it('usage reflète le nombre de tickets liés à un projet', async () => {
		const { workspaceId } = await makeWorkspace('ref-usage');
		await createRef(workspaceId, 'project', 'Projet X');
		const project = (await listRefs(workspaceId, 'project')).find((r) => r.name === 'Projet X')!;
		expect(project.usage).toBe(0);

		await createTicket(workspaceId, { key: 'RU-1', title: 'Ticket lié', projectId: project.id });

		const refs = await listRefs(workspaceId, 'project');
		expect(refs.find((r) => r.id === project.id)?.usage).toBe(1);
	});

	it('renameRef et setRefArchived refusent un id inexistant', async () => {
		const { workspaceId } = await makeWorkspace('ref-404');
		await expect(renameRef(workspaceId, 'project', crypto.randomUUID(), 'X')).rejects.toThrow();
		await expect(setRefArchived(workspaceId, 'project', crypto.randomUUID(), true)).rejects.toThrow();
	});
});
