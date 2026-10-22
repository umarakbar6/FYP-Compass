import { readBoundedBody } from '../../../backend/http/read-body.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { inspectDocument } from '../../../src/security/documents.ts';
const url = Deno.env.get('SUPABASE_URL') || '',
  anon = Deno.env.get('SUPABASE_ANON_KEY') || '',
  server = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const origin = Deno.env.get('HEALTH_APP_ORIGIN') || '';
Deno.serve(async (request) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const reply = (status: number, body: object) =>
    new Response(JSON.stringify(body), { status, headers });
  if (request.headers.get('origin') && request.headers.get('origin') !== origin)
    return reply(403, { error: 'Origin is not allowed.' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return reply(401, { error: 'Sign in first.' });
  try {
    const client = createClient(url, anon, {
      global: {
        headers: { Authorization: 'Bearer ' + token },
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }),
      },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const user = await client.auth.getUser(token);
    if (user.error || !user.data.user) return reply(401, { error: 'Invalid session.' });
    const profile = await client
      .from('fyp_profiles')
      .select('role')
      .eq('id', user.data.user.id)
      .single();
    if (profile.data?.role !== 'student')
      return reply(403, { error: 'Only student uploads are supported.' });
    const raw = await readBoundedBody(request, 1500);
    if (raw === null) return reply(413, { error: 'Request is too large.' });
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply(400, { error: 'Invalid JSON.' });
    }
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).sort().join(',') !== 'name,path' ||
      typeof body.path !== 'string' ||
      typeof body.name !== 'string' ||
      body.path.length > 500 ||
      body.path.split('/')[0] !== user.data.user.id
    )
      return reply(400, { error: 'Supply your uploaded document path and name only.' });
    const allowed = await client.rpc('fyp_v2_core_file_access', {
      p_name: body.path,
      p_write: true,
    });
    if (allowed.error || allowed.data !== true)
      return reply(403, { error: 'Document is not owned by your group.' });
    const downloaded = await client.storage.from('fyp-v2-submissions').download(body.path);
    if (downloaded.error || !downloaded.data)
      return reply(404, { error: 'Uploaded document is unavailable.' });
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    let verdict;
    try {
      verdict = inspectDocument(bytes, body.name);
    } catch (cause) {
      return reply(422, {
        error: cause instanceof Error ? cause.message : 'Document content is unsupported.',
      });
    }
    const expected = body.name.toLowerCase().endsWith('.pdf') ? '.pdf' : '.docx';
    if (!body.path.toLowerCase().endsWith(expected))
      return reply(422, { error: 'Document extension differs from the uploaded path.' });
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const admin = createClient(url, server, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const recorded = await admin.rpc('fyp_ops_record_document', {
      p_actor: user.data.user.id,
      p_path: body.path,
      p_size: bytes.byteLength,
      p_sha256: digest,
      p_mime: verdict.mime,
    });
    if (recorded.error)
      return reply(503, {
        error: 'Content verification could not be recorded. Retry this uploaded file.',
      });
    return reply(200, { verified: true, method: verdict.method });
  } catch {
    console.error(
      JSON.stringify({
        event: 'document_verification_unavailable',
        reference: crypto.randomUUID(),
      }),
    );
    return reply(503, {
      error: 'Document verification is temporarily unavailable. The file was not attached.',
    });
  }
});
