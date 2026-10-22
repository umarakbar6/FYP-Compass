import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { readBoundedBody } from '../../../backend/http/read-body.ts';
import { parseRoster } from '../../../src/operations/roster.ts';
const origin = Deno.env.get('HEALTH_APP_ORIGIN') || '',
  url = Deno.env.get('SUPABASE_URL') || '';
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
  if (!origin || request.headers.get('origin') !== origin)
    return reply(403, { error: 'Origin denied.' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return reply(401, { error: 'Sign in first.' });
  try {
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') || '', {
      global: { headers: { Authorization: 'Bearer ' + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: identity, error: authError } = await caller.auth.getUser(token);
    if (authError || !identity.user) return reply(401, { error: 'Invalid session.' });
    const profile = await caller
      .from('fyp_profiles')
      .select('role')
      .eq('id', identity.user.id)
      .single();
    if (profile.data?.role !== 'coordinator')
      return reply(403, { error: 'Coordinator access required.' });
    // Fail closed before creating identities or sending email until the owner configures SMTP.
    if (Deno.env.get('INVITES_ENABLED') !== 'true')
      return reply(503, {
        error:
          'Invitation delivery is not enabled. Configure and verify custom SMTP before enabling invitations.',
      });
    const raw = await readBoundedBody(request, 70000);
    if (raw === null) return reply(413, { error: 'Roster is too large.' });
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply(400, { error: 'Invalid JSON.' });
    }
    if (
      !body ||
      body.confirm !== true ||
      typeof body.csv !== 'string' ||
      !/^[a-f0-9-]{36}$/i.test(body.request_id) ||
      !/^[a-f0-9-]{36}$/i.test(body.session_id)
    )
      return reply(400, { error: 'Confirm a valid preview and academic session.' });
    const people = parseRoster(body.csv).map(({ email, full_name, role }) => ({
      email,
      full_name,
      role,
    }));
    const reserved = await caller.rpc('fyp_admin_invite_reserve', {
      p_request_id: body.request_id,
      p_session_id: body.session_id,
      p_people: people,
    });
    if (reserved.error)
      return reply(reserved.error.code === 'P0429' ? 429 : 400, {
        error: 'Roster could not be reserved. Check the preview, session and invitation limit.',
      });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const results = [];
    for (const item of reserved.data) {
      if (item.status !== 'pending') {
        results.push({ email: item.email, status: item.status });
        continue;
      }
      const claimed = await caller.rpc('fyp_admin_invite_claim', { p_id: item.id });
      if (claimed.error || claimed.data !== true) {
        results.push({ email: item.email, status: 'processing_or_interrupted' });
        continue;
      }
      const invite = await admin.auth.admin.inviteUserByEmail(item.email, {
        redirectTo: origin + '/auth/reset',
        data: { full_name: item.full_name },
      });
      if (invite.error || !invite.data.user) {
        await admin.rpc('fyp_admin_invite_finish', {
          p_id: item.id,
          p_actor: identity.user.id,
          p_auth_id: null,
          p_status: 'failed',
        });
        results.push({ email: item.email, status: 'failed' });
        continue;
      }
      const saved = await admin.rpc('fyp_admin_invite_finish', {
        p_id: item.id,
        p_actor: identity.user.id,
        p_auth_id: invite.data.user.id,
        p_status: 'sent',
      });
      if (saved.error)
        await admin.rpc('fyp_admin_invite_finish', {
          p_id: item.id,
          p_actor: identity.user.id,
          p_auth_id: invite.data.user.id,
          p_status: 'profile_pending',
        });
      results.push({ email: item.email, status: saved.error ? 'profile_pending' : 'sent' });
    }
    return reply(200, { results });
  } catch {
    console.error(JSON.stringify({ event: 'invitation_failure', reference: crypto.randomUUID() }));
    return reply(503, {
      error: 'Invitation processing was interrupted. Refresh the batch status before retrying.',
    });
  }
});
