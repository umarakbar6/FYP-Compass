import {
  externalScreening,
  validateSourceReferences,
} from '../../../backend/agents/external-screening.ts';
import { validateAgentRequest } from '../../../backend/agents/request.ts';
import { qaEvidence, qaEvidenceSha256 } from './qa-evidence.ts';
import { matchingPreview } from '../../../backend/agents/matching.ts';

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { unzipSync } from 'npm:fflate@0.8.3';
import { readBoundedBody } from '../../../backend/http/read-body.ts';
import { stripMarkup } from '../../../backend/http/markup-text.ts';
import {
  generateAgentDraft,
  validateGroundedReferences,
  validateDraft,
  embedding,
  cosine,
  scheduleDraft,
} from '../../../backend/agents/engine.ts';
import { inspectDocument } from '../../../src/security/documents.ts';
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
  const deadline = AbortSignal.timeout(120000);
  const providerFetch: typeof fetch = (input, init) =>
    fetch(input, {
      ...init,
      signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])]),
    });
  let run: string | undefined, actor: string | undefined;
  let stage = 'request';
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return reply(415, { error: 'Use JSON.' });
    const raw = await readBoundedBody(request, 6000);
    if (raw === null) return reply(413, { error: 'Request too large.' });
    let body;
    try {
      body = validateAgentRequest(JSON.parse(raw));
    } catch {
      return reply(400, {
        error: 'Supply a valid agent request, authorized project and explicit consent.',
      });
    }
    const kind = body.kind;
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') || '', {
      global: {
        headers: { Authorization: 'Bearer ' + token },
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([deadline, AbortSignal.timeout(30000)]),
          }),
      },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: identity, error: authError } = await caller.auth.getUser(token);
    if (authError || !identity.user) return reply(401, { error: 'Invalid session.' });
    actor = identity.user.id;
    const context = await caller.rpc('fyp_agents_context', {
      p_kind: kind,
      p_project_id: body.project_id,
    });
    if (context.error)
      return reply(context.error.code === '42501' ? 403 : 400, {
        error: 'This agent or project is unavailable for your role.',
      });
    const evidence = context.data;
    if (evidence.actor_id !== actor) return reply(403, { error: 'Evidence owner mismatch.' });
    if (kind === 'qa') {
      if (
        !qaEvidence.release_ready ||
        Deno.env.get('FYP_QA_REVIEW_APPROVED_SHA256') !== qaEvidenceSha256
      )
        return reply(503, {
          error:
            'External code and test evidence review is disabled until the owner approves this exact selected payload. Local quality scripts remain available.',
        });
      evidence.evidence = qaEvidence;
    }
    if (
      kind === 'document' &&
      (!evidence.evidence.documents?.length ||
        evidence.evidence.documents.some(
          (d: { document?: { name?: string; size?: number } }) =>
            !d.document ||
            (d.document.name?.toLowerCase().endsWith('.pdf') && (d.document.size || 0) < 128),
        ))
    )
      return reply(422, {
        error:
          'This project has no complete usable document evidence. Select a project with real PDF or DOCX uploads. Existing accepted evidence is preserved.',
      });
    delete evidence.actor_id;
    evidence.request = body.question;
    if (body.external_sources) {
      evidence.external_source_consent = true;
      evidence.external_search_terms = body.search_terms || evidence.evidence.proposal?.title;
    }
    if (JSON.stringify(evidence).length > 90000)
      return reply(413, {
        error: 'Select a smaller session or project before generating a draft.',
      });
    const key = Deno.env.get('GEMINI_API_KEY') || '',
      model =
        (kind === 'document'
          ? Deno.env.get('GEMINI_DOCUMENT_MODEL')
          : kind === 'qa'
            ? Deno.env.get('GEMINI_QA_MODEL')
            : undefined) ||
        Deno.env.get('GEMINI_MODEL') ||
        '';
    if (!key || !model)
      return reply(503, { error: 'Gemini is not configured for drafting agents.' });
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(evidence))),
      ),
    )
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');
    const reservation = await caller.rpc('fyp_agents_reserve', {
      p_kind: kind,
      p_project_id: body.project_id,
      p_evidence_hash: digest,
    });
    if (reservation.error)
      return reply(reservation.error.code === 'P0429' ? 429 : 503, {
        error: 'Agent request limit reached or reservation unavailable.',
      });
    run = reservation.data;
    const attachments: { mimeType: string; data: string }[] = [];
    let documentBytes = 0;
    if (kind === 'document') {
      stage = 'document_evidence';
      const docs = evidence.evidence.documents;
      if (!docs?.length) throw Error('No authorized document available.');
      for (const doc of docs) {
        const file = doc.document;
        const access = await caller.rpc('fyp_v2_core_file_access', {
          p_name: file.path,
          p_write: false,
        });
        if (access.error || access.data !== true) throw Error('Document unavailable.');
        const downloaded = await caller.storage.from('fyp-v2-submissions').download(file.path);
        if (downloaded.error || !downloaded.data || downloaded.data.size > 10485760)
          throw Error('Document unavailable.');
        const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
        documentBytes += bytes.length;
        if (documentBytes > 12 * 1024 * 1024)
          throw Error('Selected documents exceed the bounded provider request.');
        const verdict = inspectDocument(bytes, file.name);
        if (verdict.mime === 'application/pdf') {
          let binary = '';
          for (let i = 0; i < bytes.length; i += 8192)
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          attachments.push({ mimeType: 'application/pdf', data: btoa(binary) });
        } else {
          const xml = unzipSync(bytes)['word/document.xml'];
          if (!xml) throw Error('Document text unavailable.');
          doc.authorized_text = stripMarkup(new TextDecoder().decode(xml))
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .slice(0, 20000);
        }
        delete doc.document;
      }
    }
    if (kind === 'proposal') {
      stage = 'proposal_embedding';
      const proposal = evidence.evidence.proposal,
        comparisons = evidence.evidence.comparison_proposals || [];
      if (proposal?.abstract) {
        const original = await embedding(
          key,
          proposal.title + '\n' + proposal.abstract,
          providerFetch,
        );
        const cache = await admin.rpc('fyp_agents_cache_embedding', {
          p_actor: actor,
          p_proposal_id: proposal.id,
          p_embedding: JSON.stringify(original),
          p_source_version: proposal.source_version,
        });
        if (cache.error) throw Error('Semantic cache unavailable.');
        for (const item of comparisons.slice(0, 3)) {
          const vector = await embedding(key, item.title + '\n' + item.abstract, providerFetch);
          const saved = await admin.rpc('fyp_agents_cache_embedding', {
            p_actor: actor,
            p_proposal_id: item.id,
            p_embedding: JSON.stringify(vector),
            p_source_version: item.source_version,
          });
          if (saved.error) throw Error('Semantic cache unavailable.');
        }
        const matches = await caller.rpc('fyp_agents_semantic_matches', {
          p_project_id: body.project_id,
          p_embedding: JSON.stringify(original),
        });
        if (matches.error) throw Error('Semantic query unavailable.');
        evidence.semantic_similarity = {
          method:
            'Gemini embeddings with private pgvector cosine search; current authorized internal proposals only',
          input_scope:
            'First 6000 characters of each title and abstract; not a full external plagiarism scan',
          matches: matches.data,
        };
      }
    }
    if (kind === 'proposal' && body.external_sources && body.source_consent) {
      stage = 'external_source_retrieval';
      const proposal = evidence.evidence.proposal;
      if (!proposal?.title || !proposal?.abstract) throw Error('Proposal text is required.');
      evidence.external_screening = await externalScreening(
        body.search_terms || proposal.title,
        proposal.abstract,
        providerFetch,
      );
    }
    if (kind === 'matching') {
      stage = 'matching_embedding';
      const data = evidence.evidence,
        active = data.sessions.find((s: { active: boolean }) => s.active)?.id;
      const capacities = data.capacities.filter(
        (c: { session_id: string }) => c.session_id === active,
      );
      const pending = data.groups.filter(
        (g: { session_id: string; proposal: { status: string }; allocation: unknown }) =>
          g.session_id === active &&
          g.proposal &&
          g.proposal.status === 'submitted' &&
          !g.allocation,
      );
      const semantic: Record<string, number> = {};
      const proposals = (data.proposal_text || [])
        .filter((p: { group_id: string }) =>
          pending.some((g: { id: string }) => g.id === p.group_id),
        )
        .slice(0, 4);
      const topics = new Map<string, string>(
        data.topics.map((t: { id: string; name: string }) => [t.id, t.name]),
      );
      const vectors = new Map<string, number[]>();
      for (let i = 0; i < Math.min(6, pending.length ? capacities.length : 0); i += 3)
        await Promise.all(
          capacities
            .slice(i, Math.min(i + 3, 6))
            .map(async (c: { supervisor_id: string; topic_ids: string[] }) => {
              const text = (c.topic_ids || []).map((id) => topics.get(id) || '').join(', ');
              if (text) vectors.set(c.supervisor_id, await embedding(key, text, providerFetch));
            }),
        );
      for (const p of proposals) {
        const vector = await embedding(key, p.title + '\n' + p.abstract, providerFetch);
        for (const [id, target] of vectors)
          semantic[p.group_id + ':' + id] = cosine(vector, target);
      }
      stage = 'matching_preview';
      evidence.preference_first_preview = matchingPreview(pending, capacities, semantic);
      evidence.semantic_scope = {
        provider: 'Gemini embeddings',
        proposals_compared: proposals.length,
        maximum: 4,
        not_compared:
          'Remaining projects use topic overlap and stable ID, never fabricated embedding scores.',
      };
    }

    if (kind === 'scheduler') {
      const config = body.schedule;
      if (
        !config ||
        typeof config.start !== 'string' ||
        !Array.isArray(config.rooms) ||
        config.rooms.some((s: unknown) => typeof s !== 'string' || !s.trim() || s.length > 120)
      )
        throw Error('Supply schedule start, rooms and slot parameters.');
      evidence.timetable = scheduleDraft({
        availability: evidence.evidence.availability,
        projects: evidence.evidence.readiness,
        examiners: evidence.evidence.examiners,
        rooms: config.rooms
          .map((s: string) => s.trim())
          .filter(
            (s: string, i: number, a: string[]) =>
              a.findIndex((v) => v.toLowerCase() === s.toLowerCase()) === i,
          ),
        start: config.start,
        slots: config.slots,
        minutes: config.minutes,
        existing: evidence.evidence.defenses.map((d: { project_id: string }) => ({
          ...d,
          supervisor_id: evidence.evidence.groups.find((g: { id: string }) => g.id === d.project_id)
            ?.allocation?.supervisor_id,
        })),
      });
    }
    if (kind === 'report') evidence.sql_counts_preview = evidence.evidence.sql_totals;
    if (kind === 'support')
      evidence.routing = {
        recommended_queue: 'coordinator',
        category: /login|password|account|invite/i.test(body.question)
          ? 'account_access'
          : /price|plan|cost|service/i.test(body.question)
            ? 'service_enquiry'
            : /deadline|milestone|submission/i.test(body.question)
              ? 'academic_workflow'
              : 'general_support',
        requires_human_review: true,
        no_contact_sent: true,
      };
    stage = 'draft_generation';
    const draft = await generateAgentDraft(key, model, kind, evidence, attachments, providerFetch);
    validateGroundedReferences(draft, evidence);
    if (evidence.external_screening)
      validateSourceReferences(draft.references, evidence.external_screening);
    if (evidence.external_screening) {
      // Persist retrieved evidence in the existing private draft schema; never fabricated quotes.
      draft.references = [
        ...draft.references.slice(0, 9),
        ...evidence.external_screening.sources.map(
          (s: {
            id: string;
            url: string;
            scope: string;
            sourcePassage: string;
            proposalPassage: string | null;
            exactSharedWords: number;
          }) =>
            s.id +
            ' | ' +
            s.url +
            ' | ' +
            s.scope +
            ' | consecutive shared words shown: ' +
            s.exactSharedWords +
            ' | retrieved passage: ' +
            s.sourcePassage.slice(0, 600) +
            (s.proposalPassage
              ? ' | proposal passage: ' + s.proposalPassage.slice(0, 600)
              : ' | no exact passage overlap'),
        ),
      ];
      validateDraft(draft);
    }
    stage = 'draft_persistence';
    const saved = await admin.rpc('fyp_agents_finish', {
      p_id: run,
      p_actor: actor,
      p_draft: draft,
      p_source: 'gemini',
      p_report: evidence.external_screening || null,
    });
    if (saved.error) throw Error('Draft persistence unavailable.');
    return reply(200, {
      id: run,
      source: 'gemini',
      model,
      draft,
      evidence: {
        snapshot_at: evidence.snapshot_at,
        kind,
        project_id: body.project_id,
        preview:
          evidence.external_screening ||
          evidence.preference_first_preview ||
          evidence.timetable ||
          evidence.sql_counts_preview ||
          evidence.routing ||
          null,
      },
      requires_human_approval: true,
    });
  } catch (cause) {
    const providerStatus =
      cause instanceof Error
        ? /^(?:Provider|Embedding) HTTP (\d{3})$/.exec(cause.message)?.[1]
        : undefined;
    const failureCode = providerStatus ? 'provider_http_' + providerStatus : stage + '_unavailable';
    if (run && actor)
      await admin.rpc('fyp_agents_finish', {
        p_id: run,
        p_actor: actor,
        p_draft: null,
        p_source: 'failed',
        p_report: null,
      });
    console.error(
      JSON.stringify({
        event: 'draft_agent_failure',
        reference: run || crypto.randomUUID(),
        failureCode,
      }),
    );
    return reply(providerStatus === '429' ? 429 : 503, {
      failure_code: failureCode,
      error:
        providerStatus === '429'
          ? 'Gemini usage limit reached. No draft was saved. Retry after the provider quota resets.'
          : 'The agent could not complete a verified draft. No marks, allocations, notices or schedules were changed. Check available evidence and retry later.',
    });
  }
});
