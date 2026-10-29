import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import { z } from 'zod';
import { imputoGet, imputoPost } from './client.js';
const MCP_BEARER = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER)
    throw new Error('MCP_BEARER_TOKEN manquant');
const PORT = Number(process.env.PORT ?? 3000);
// ─── Tools ────────────────────────────────────────────────────────────────────
function makeServer() {
    const server = new McpServer({ name: 'imputo', version: '1.0.0' });
    server.tool('get_workspace', 'Retourne les infos de l\'espace courant : membres, rôle de l\'utilisateur connecté.', {}, async () => {
        const data = await imputoGet('/api/mcp/workspace');
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    });
    server.tool('list_tickets', 'Liste les tickets avec filtres optionnels.', {
        page: z.number().int().min(1).optional().describe('Page (défaut 1)'),
        q: z.string().optional().describe('Recherche texte'),
        sprintId: z.string().uuid().optional().describe('Filtrer par sprint'),
        assignedTo: z.string().uuid().optional().describe('Filtrer par membre assigné'),
        stateId: z.string().uuid().optional().describe('Filtrer par état'),
        sspCode: z.string().optional().describe('Filtrer par code SSP')
    }, async (args) => {
        const params = new URLSearchParams();
        if (args.page)
            params.set('page', String(args.page));
        if (args.q)
            params.set('q', args.q);
        if (args.sprintId)
            params.set('sprint', args.sprintId);
        if (args.assignedTo)
            params.set('assignedTo', args.assignedTo);
        if (args.stateId)
            params.set('state', args.stateId);
        if (args.sspCode)
            params.set('ssp', args.sspCode);
        const data = await imputoGet(`/api/tickets?${params}`);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    });
    server.tool('get_ticket', 'Retourne le détail d\'un ticket par son ID.', { id: z.string().uuid().describe('UUID du ticket') }, async ({ id }) => {
        const data = await imputoGet(`/api/tickets/${id}`);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    });
    server.tool('search_tickets', 'Recherche des tickets par texte (titre, clé Jira). Retourne une liste compacte.', { q: z.string().describe('Texte à rechercher'), limit: z.number().int().min(1).max(50).optional() }, async ({ q, limit }) => {
        const params = new URLSearchParams({ q });
        if (limit)
            params.set('limit', String(limit));
        const data = await imputoGet(`/api/tickets/search?${params}`);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    });
    server.tool('log_time', 'Impute du temps sur un ticket ou une catégorie pour un jour donné.', {
        targetType: z.enum(['TICKET', 'CATEGORY']).describe('Type de cible'),
        targetId: z.string().uuid().describe('UUID du ticket ou de la catégorie'),
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Jour au format YYYY-MM-DD'),
        amount: z.number().min(0).max(1).describe('Montant en jours (0.125, 0.25, 0.5, 1…)'),
        activityId: z.string().uuid().optional().describe('UUID de l\'activité (optionnel)')
    }, async (args) => {
        await imputoPost('/api/mcp/imputation', args);
        return { content: [{ type: 'text', text: `Imputation de ${args.amount}j posée sur ${args.targetId} le ${args.day}.` }] };
    });
    server.tool('log_support_time', 'Impute du temps support sur un ticket via sa clé Jira ou son titre.', {
        ticketRef: z.string().describe('Clé Jira ou titre du ticket (ex: PROJ-123)'),
        duration: z.string().describe('Durée au format "1h30", "45m", "2h"'),
        at: z.string().optional().describe('Moment précis ISO 8601 (optionnel, défaut maintenant)')
    }, async (args) => {
        await imputoPost('/api/support-time', args);
        return { content: [{ type: 'text', text: `Temps support ${args.duration} enregistré sur ${args.ticketRef}.` }] };
    });
    server.tool('get_timesheet', 'Retourne la feuille de temps de l\'utilisateur connecté (données brutes de la page Imputation).', {
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date de début YYYY-MM-DD'),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date de fin YYYY-MM-DD')
    }, async ({ from, to }) => {
        const data = await imputoGet(`/api/command/data?from=${from}&to=${to}`);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    });
    return server;
}
// ─── HTTP server avec auth Bearer ─────────────────────────────────────────────
const httpServer = createServer(async (req, res) => {
    // Health check (sans auth — utilisé par la livenessProbe OpenShift)
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }
    // Auth Bearer
    const auth = req.headers['authorization'] ?? '';
    if (!auth.startsWith('Bearer ') || auth.slice(7) !== MCP_BEARER) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
    }
    // Une instance MCP par requête (stateless HTTP)
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res);
});
httpServer.listen(PORT, () => {
    console.log(`imputo MCP server listening on :${PORT}`);
});
