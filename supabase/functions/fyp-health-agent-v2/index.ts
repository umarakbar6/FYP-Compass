import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import {
  createHealthAgentHandler,
  geminiGenerator,
} from '../../../backend/health-agent/handler.ts';
const url = Deno.env.get('SUPABASE_URL') || '';
const key = Deno.env.get('SUPABASE_ANON_KEY') || '';
const origin = Deno.env.get('HEALTH_APP_ORIGIN') || '';
const aiKey = Deno.env.get('GEMINI_API_KEY');
const model = Deno.env.get('GEMINI_HEALTH_MODEL') || Deno.env.get('GEMINI_MODEL');
Deno.serve(async (request) => {
  // Each request gets a user-scoped client; no shared mutable auth state; academic RPCs retain caller permissions.
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  const client = createClient(url, key, {
    global: {
      headers: { Authorization: 'Bearer ' + token },
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }),
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return createHealthAgentHandler({
    origin,
    reserve: async (_actor, projectId) => {
      const { data, error } = await client.rpc('fyp_ops_reserve_ai', { p_project_id: projectId });
      if (error) throw new Error('AI budget check unavailable.');
      return data;
    },
    record: async (actor, id, status, duration, providerStatus) => {
      // Service access is confined to operational telemetry, never academic decisions.
      const ops = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await ops.rpc('fyp_ops_finish_ai', {
        p_id: id,
        p_actor: actor.id,
        p_status: status,
        p_duration_ms: duration,
        p_provider_status: providerStatus,
      });
      if (error) throw new Error('Operational status unavailable.');
    },
    authenticate: async () => {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return null;
      const profile = await client
        .from('fyp_profiles')
        .select('role')
        .eq('id', data.user.id)
        .single();
      return profile.error ? null : { id: data.user.id, role: profile.data.role };
    },
    prepare: async (_actor, projectId) => {
      const { data, error } = await client.rpc('prepare_group_health_draft', {
        p_project_id: projectId,
      });
      if (error) throw new Error('Authorized health evidence unavailable.');
      return data;
    },
    save: async (_actor, projectId, risk, text, source, version) => {
      const { error } = await client.rpc('save_group_health_draft', {
        p_project_id: projectId,
        p_expected_version: version,
        p_health: risk,
        p_text: text,
        p_source: source,
      });
      if (error) throw new Error('Draft persistence failed.');
    },
    generate: aiKey && model ? async (risk) => geminiGenerator(aiKey, model)(risk) : undefined,
  })(request);
});
