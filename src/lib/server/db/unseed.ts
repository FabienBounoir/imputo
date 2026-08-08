// Supprime l'environnement de test créé par seed.ts (workspace "QA Sandbox" + ses 4 comptes).
// Usage : npm run db:unseed
import { getDb, wipeSandbox, WORKSPACE_NAME } from './seed.shared';

async function main() {
	const db = getDb();
	await wipeSandbox(db);
	console.log(`"${WORKSPACE_NAME}" et ses comptes de test ont été supprimés.`);
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
