// Script CLI autonome pour le CronJob de synchronisation Jira (image imputo:tools, npm run
// jira:sync — voir openshift/cronjob-jira-sync.yaml). Même schéma que seed.ts/migrate.js :
// process.env directement, jamais $lib/server/config (résolu par SvelteKit uniquement, cf.
// jiraSync.ts pour le détail de cette contrainte).
import { readFileSync } from 'node:fs';
import { createDb } from '$lib/server/db/connection';
import { syncAllEnabledWorkspaces, type JiraSyncConfig } from '$lib/server/services/jiraSync';

if (!process.env.DATABASE_URL) {
	try {
		for (const line of readFileSync('.env', 'utf8').split('\n')) {
			const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
			if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
	} catch {
		/* pas de .env, tant pis */
	}
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} manquant (.env ou variable d'environnement).`);
	return value;
}

async function main() {
	const db = createDb(requireEnv('DATABASE_URL'));
	const cfg: JiraSyncConfig = {
		azureTenantId: requireEnv('AZURE_TENANT_ID'),
		azureClientId: requireEnv('AZURE_CLIENT_ID'),
		azureClientSecret: requireEnv('AZURE_CLIENT_SECRET'),
		jiraBaseUrl: requireEnv('JIRA_BASE_URL'),
		patEncryptionKey: requireEnv('JIRA_PAT_ENCRYPTION_KEY')
	};

	const results = await syncAllEnabledWorkspaces(db, cfg);
	if (results.length === 0) {
		console.log('Aucun espace avec la synchronisation Jira activée.');
		return;
	}

	let failures = 0;
	for (const r of results) {
		if (r.ok) console.log(`✓ ${r.workspaceId} — ${r.ticketsUpserted} ticket(s)`);
		else {
			failures++;
			console.error(`✗ ${r.workspaceId} — ${r.error}`);
		}
	}
	console.log(`\n${results.length - failures}/${results.length} espace(s) synchronisé(s) avec succès.`);
	if (failures > 0) process.exitCode = 1;
}

main()
	.then(() => process.exit(process.exitCode ?? 0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
