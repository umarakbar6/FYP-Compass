import { createClient } from '@supabase/supabase-js';
import { unzipSync } from 'fflate';
import { createAssistantsHandler } from '../agents/handler.ts';
import { createHealthAgentHandler, geminiGenerator } from '../health-agent/handler.ts';
import {
  qaEvidence,
  qaEvidenceSha256,
} from '../../supabase/functions/fyp-assistants-v1/qa-evidence.ts';

// Reuse the production handlers; local mode never fabricates a Gemini response.
export function createLocalFunctions({
  origin,
  environment,
  providerFetch,
  rpc,
  serviceRpc,
  url,
  authenticate,
}) {
  const admin = {
    rpc: async (name, args) => {
      try {
        return { data: await serviceRpc(name, args), error: null };
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      }
    },
  };
  const assistants = createAssistantsHandler({
    origin,
    env: (name) => environment[name],
    qaEvidence,
    qaEvidenceSha256,
    unzipSync,
    admin,
    fetch: providerFetch,
    createCaller: (token, deadline) =>
      createClient(url(), 'local-demo-public-client', {
        global: {
          headers: { Authorization: 'Bearer ' + token },
          fetch: (input, init) =>
            fetch(input, {
              ...init,
              signal: AbortSignal.any([deadline, AbortSignal.timeout(30000)]),
            }),
        },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
  });
  const key = environment.GEMINI_API_KEY;
  const healthModel = environment.GEMINI_HEALTH_MODEL || environment.GEMINI_MODEL;
  const health = createHealthAgentHandler({
    origin,
    authenticate,
    prepare: (actor, projectId) =>
      rpc(actor.id, 'prepare_group_health_draft', { p_project_id: projectId }),
    reserve: (actor, projectId) => rpc(actor.id, 'fyp_ops_reserve_ai', { p_project_id: projectId }),
    record: (actor, id, status, duration, providerStatus) =>
      serviceRpc('fyp_ops_finish_ai', {
        p_id: id,
        p_actor: actor.id,
        p_status: status,
        p_duration_ms: duration,
        p_provider_status: providerStatus,
      }),
    save: (actor, projectId, risk, text, source, version) =>
      rpc(actor.id, 'save_group_health_draft', {
        p_project_id: projectId,
        p_expected_version: version,
        p_health: risk,
        p_text: text,
        p_source: source,
      }),
    generate: key && healthModel ? geminiGenerator(key, healthModel, providerFetch) : undefined,
  });
  return { 'fyp-assistants-v1': assistants, 'fyp-health-agent-v2': health };
}
