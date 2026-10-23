import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { unzipSync } from 'npm:fflate@0.8.3';
import { createAssistantsHandler } from '../../../backend/agents/handler.ts';
import { qaEvidence, qaEvidenceSha256 } from './qa-evidence.ts';
const url = Deno.env.get('SUPABASE_URL') || '';
Deno.serve(createAssistantsHandler({
  origin: Deno.env.get('HEALTH_APP_ORIGIN') || '',
  env: (name) => Deno.env.get(name),
  qaEvidence,
  qaEvidenceSha256,
  unzipSync,
  admin: createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  createCaller: (token, deadline) => createClient(url, Deno.env.get('SUPABASE_ANON_KEY') || '', {
    global: {
      headers: { Authorization: 'Bearer ' + token },
      fetch: (input, init) => fetch(input, {
        ...init, signal: AbortSignal.any([deadline, AbortSignal.timeout(30000)]),
      }),
    },
    auth: { persistSession: false, autoRefreshToken: false },
  }),
}));
