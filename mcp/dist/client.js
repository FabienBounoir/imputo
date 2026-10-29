// Client HTTP vers l'API imputo. Authentifie via POST /api/mcp/auth (échange le MCP token
// contre un cookie de session), puis réutilise ce cookie pour tous les appels suivants.
const IMPUTO_URL = process.env.IMPUTO_URL ?? 'http://localhost:5173';
const MCP_TOKEN = process.env.MCP_TOKEN;
if (!MCP_TOKEN)
    throw new Error('MCP_TOKEN manquant');
let sessionCookie = null;
async function authenticate() {
    const res = await fetch(`${IMPUTO_URL}/api/mcp/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: MCP_TOKEN })
    });
    if (!res.ok)
        throw new Error(`Auth échouée : ${res.status}`);
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie)
        throw new Error('Pas de cookie dans la réponse auth');
    // Extrait juste le nom=valeur du premier cookie (avant le premier ;)
    sessionCookie = setCookie.split(';')[0];
}
export async function imputoFetch(path, init) {
    if (!sessionCookie)
        await authenticate();
    const res = await fetch(`${IMPUTO_URL}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            Cookie: sessionCookie,
            ...(init?.headers ?? {})
        }
    });
    // Session expirée → ré-auth une fois
    if (res.status === 401) {
        sessionCookie = null;
        await authenticate();
        return fetch(`${IMPUTO_URL}${path}`, {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                Cookie: sessionCookie,
                ...(init?.headers ?? {})
            }
        });
    }
    return res;
}
export async function imputoGet(path) {
    const res = await imputoFetch(path);
    if (!res.ok)
        throw new Error(`GET ${path} → ${res.status}`);
    return res.json();
}
export async function imputoPost(path, body) {
    const res = await imputoFetch(path, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`POST ${path} → ${res.status}: ${text}`);
    }
    return res.json();
}
export async function imputopatch(path, body) {
    const res = await imputoFetch(path, { method: 'PATCH', body: JSON.stringify(body) });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`PATCH ${path} → ${res.status}: ${text}`);
    }
    return res.json();
}
