import 'server-only';

export const json = (body: unknown, status = 200) => Response.json(body, { status });
export const notFound = (what = 'Not found') => json({ error: what }, 404);
export const badRequest = (error: string, details?: unknown) => json({ error, details }, 400);

export const aiConfigured = () => process.env.ANALYST_ENGINE !== 'local' && !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
