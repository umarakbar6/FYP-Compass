import { readBoundedBody } from '../../../backend/http/read-body.ts';
// Compatibility bridge: all transports now use the same authenticated SMTP claim API.
const origin = Deno.env.get('HEALTH_APP_ORIGIN') || '';
Deno.serve(async (request) => {
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers });
  if (origin !== 'https://fyp-compass-ten.vercel.app' || request.headers.get('origin') !== origin)
    return reply(403, { error: 'Origin denied.' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
  try {
    const raw = await readBoundedBody(request, 2000);
    if (!raw) return reply(413, { error: 'Request too large.' });
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply(400, { error: 'Use a valid JSON delivery request.' });
    }
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((k) => !['confirm', 'run_id', 'reminder_id'].includes(k))
    )
      return reply(400, { error: 'Invalid reminder request.' });
    const response = await fetch(origin + '/api/reminder-email', {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        authorization: request.headers.get('authorization') || '',
      },
      body: JSON.stringify({ ...body, type: 'reminder' }),
      signal: AbortSignal.timeout(55000),
    });
    return reply(response.status, await response.json());
  } catch {
    return reply(503, {
      error:
        'Delivery could not be confirmed. Retry uses the same saved SMTP claim and cannot automatically resend an attempted message.',
    });
  }
});
