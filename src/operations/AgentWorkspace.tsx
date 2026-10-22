import { SourceEvidencePanel } from './SourceEvidencePanel';
import { ProposalEvidenceNotice } from './ProposalEvidenceNotice';
import type { ExternalScreening } from '../../backend/agents/external-screening';
import { readableCopy } from '../lib/readable-copy';
import { useSearchParams } from 'react-router-dom';
import { EmailReminderDraft } from './EmailReminderDraft';
import { AvailabilityEditor } from './AvailabilityEditor';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { Button, ErrorMessage } from '../components/ui';
import { agentKinds, validateDraft, type AgentKind, type Draft } from '../../backend/agents/engine';
const qaReviewEnabled = import.meta.env.VITE_QA_REVIEW_ENABLED === 'true';
const labels: Record<AgentKind, string> = {
  matching: 'Matching assistant',
  proposal: 'Proposal review and source screening',
  document: 'Document summarizer',
  nudge: 'Nudge and reminder agent',
  digest: 'Supervisor digest',
  scheduler: 'Defense scheduler',
  report: 'Report writer',
  support: 'Support agent',
  qa: 'Dev and QA agent',
};
const allowed: Record<string, AgentKind[]> = {
  student: ['proposal', 'document', 'nudge', 'support'],
  supervisor: ['proposal', 'document', 'nudge', 'digest', 'support'],
  examiner: ['support'],
  coordinator: ['matching', 'scheduler', 'report', 'support', 'qa'],
};
type Saved = {
  id: string;
  kind: AgentKind;
  project_id: string | null;
  status: string;
  source: string;
  draft: Draft | null;
  report: ExternalScreening | null;
  created_at: string;
};
function validSavedDraft(value: unknown): value is Draft {
  try {
    validateDraft(value as Draft);
    return true;
  } catch {
    return false;
  }
}
function validSavedReport(value: unknown): value is ExternalScreening {
  if (!value || typeof value !== 'object') return false;
  const report = value as ExternalScreening;
  return (
    typeof report.checkedAt === 'string' &&
    typeof report.query === 'string' &&
    typeof report.coverage === 'string' &&
    typeof report.conclusion === 'string' &&
    Array.isArray(report.providers) &&
    Array.isArray(report.sources)
  );
}
export function AgentWorkspace() {
  const { user } = useAuth();
  const [search] = useSearchParams();
  const currentActor = useRef(user?.id);
  currentActor.current = user?.id;
  const options = allowed[user?.role || ''] || [];
  const [kind, setKind] = useState<AgentKind>(options[0] || 'support'),
    [project, setProject] = useState(''),
    [projects, setProjects] = useState<{ id: string; name: string }[]>([]),
    [question, setQuestion] = useState(''),
    [consent, setConsent] = useState(false),
    [externalSources, setExternalSources] = useState(false),
    [searchTerms, setSearchTerms] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<{
      id: string;
      source: string;
      draft: Draft;
      evidence?: { preview: unknown };
    } | null>(null),
    [history, setHistory] = useState<Saved[]>([]),
    [start, setStart] = useState(''),
    [rooms, setRooms] = useState(''),
    [slots, setSlots] = useState(8),
    [minutes] = useState(60);
  async function loadHistory() {
    if (!supabase) return;
    const historyActor = currentActor.current;
    try {
      const { data, error } = await supabase.rpc('fyp_agents_history');
      if (currentActor.current !== historyActor) return;
      if (error) setError('Saved drafts are temporarily unavailable.');
      else if (Array.isArray(data))
        setHistory(
          data.filter(
            (item): item is Saved =>
              item &&
              typeof item.id === 'string' &&
              agentKinds.includes(item.kind) &&
              typeof item.status === 'string' &&
              typeof item.source === 'string' &&
              (item.draft === null || validSavedDraft(item.draft)) &&
              (item.report === null || validSavedReport(item.report)) &&
              typeof item.created_at === 'string',
          ),
        );
    } catch {
      if (currentActor.current === historyActor)
        setError('Saved drafts are temporarily unavailable.');
    }
  }
  useEffect(() => {
    setResult(null);
    setBusy(false);
    setHistory([]);
    setProjects([]);
    setProject(search.get('project') || '');
    setQuestion('');
    setError('');
    const requested = search.get('kind') as AgentKind;
    setKind(
      options.includes(requested) ? requested : (allowed[user?.role || ''] || ['support'])[0],
    );
    setConsent(false);
    setExternalSources(false);
    setSearchTerms('');
    if (!supabase) return;
    void loadHistory();
    const actor = user?.id;
    if (user?.role === 'student' || user?.role === 'supervisor') {
      const primary =
        user.role === 'student'
          ? 'fyp_v2_core_get_student_workspace'
          : 'fyp_v2_core_get_supervisor_workspace';
      void Promise.allSettled([
        Promise.resolve(supabase.rpc(primary)),
        Promise.resolve(supabase.rpc('fyp_v2_core_get_milestone_workspace')),
      ]).then((results) => {
        if (currentActor.current !== actor) return;
        const choices = new Map<string, string>();
        for (const result of results) {
          if (result.status !== 'fulfilled' || result.value.error) continue;
          const data = result.value.data;
          if (data?.group?.id) choices.set(data.group.id, data.proposal?.title || data.group.name);
          for (const p of Array.isArray(data?.proposals) ? data.proposals : [])
            if (p.group_id) choices.set(p.group_id, p.title);
          for (const p of Array.isArray(data?.projects) ? data.projects : [])
            if (p.id) choices.set(p.id, p.title || p.name || 'Authorized project');
        }
        setProjects([...choices].map(([id, name]) => ({ id, name })));
        if (results.every((r) => r.status === 'rejected' || r.value.error))
          setError('Authorized projects are temporarily unavailable.');
      });
    }
  }, [user?.id]);
  async function run() {
    const actorAtStart = user?.id;
    if (!supabase || busy || !consent || (kind === 'support' && !question.trim())) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('fyp-assistants-v1', {
        body: {
          kind,
          project_id: ['proposal', 'document'].includes(kind) ? project : null,
          question,
          consent: true,
          ...(kind === 'proposal' && externalSources
            ? {
                external_sources: true,
                source_consent: true,
                ...(searchTerms.trim() ? { search_terms: searchTerms.trim() } : {}),
              }
            : {}),
          ...(kind === 'scheduler'
            ? {
                schedule: {
                  start: new Date(start).toISOString(),
                  rooms: rooms
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                  slots,
                  minutes,
                },
              }
            : {}),
        },
      });
      if (error) {
        let message = 'The agent is unavailable or the request limit was reached.';
        try {
          const payload = await error.context?.json();
          if (payload?.error) message = payload.error;
        } catch {
          /* No raw provider data is displayed. */
        }
        throw Error(message);
      }
      if (data.source !== 'gemini' || !data.draft || data.requires_human_approval !== true)
        throw Error('The draft could not be verified.');
      if (currentActor.current !== actorAtStart) return;
      validateDraft(data.draft);
      setResult(data);
      await loadHistory();
    } catch (cause) {
      if (currentActor.current !== actorAtStart) return;
      setError(cause instanceof Error ? cause.message : 'Draft could not be generated.');
    } finally {
      if (currentActor.current === actorAtStart) setBusy(false);
    }
  }
  return (
    <div className="engagement-page">
      <h1>AI assistants</h1>
      {kind === 'scheduler' && <AvailabilityEditor />}
      {kind === 'qa' && !qaReviewEnabled && (
        <p role="status">
          External code review is disabled pending explicit owner approval to send selected source
          and test evidence to Gemini. Local lint, unit, database and browser checks remain
          available in the project scripts.
        </p>
      )}
      <p>
        Draft from your authorized evidence, review the output and use the normal workspace controls
        to make decisions. Agents cannot change grades, health levels, allocations, notices or
        schedules. Onboarding agent preview is in Invite users for coordinators.
      </p>
      {error && <ErrorMessage message={error} />}
      {!supabase && (
        <p role="status">
          AI drafts require a connected cloud account. This local demo does not send evidence or
          fabricate AI output.
        </p>
      )}
      <section className="engagement-card">
        <label>
          Assistant
          <select
            value={kind}
            disabled={busy}
            onChange={(e) => {
              setKind(e.target.value as AgentKind);
              setExternalSources(false);
              setSearchTerms('');
              setResult(null);
              setConsent(false);
            }}
          >
            {options
              .filter((k) => agentKinds.includes(k))
              .map((k) => (
                <option key={k} value={k}>
                  {labels[k]}
                </option>
              ))}
          </select>
        </label>
        {['proposal', 'document'].includes(kind) && (
          <label>
            Authorized project
            <select
              value={project}
              disabled={busy}
              onChange={(e) => {
                setProject(e.target.value);
                setResult(null);
                setConsent(false);
                setExternalSources(false);
              }}
            >
              <option value="">Choose project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {kind === 'support' ? 'Your question' : 'Optional focus or review instructions'}
          <textarea
            maxLength={1500}
            rows={3}
            value={question}
            disabled={busy}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        {kind === 'scheduler' && (
          <>
            <label>
              Available scheduling window start
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Available rooms, separated by commas
              <input maxLength={1000} value={rooms} onChange={(e) => setRooms(e.target.value)} />
            </label>
            <label>
              Number of available slots
              <input
                type="number"
                min={1}
                max={40}
                value={slots}
                onChange={(e) => setSlots(Number(e.target.value))}
              />
            </label>
            <label>
              Minutes per defense
              <input type="number" min={60} max={60} value={minutes} readOnly />
            </label>
          </>
        )}
        {kind === 'proposal' && <ProposalEvidenceNotice />}
        {kind === 'proposal' && (
          <label className="engagement-checkbox">
            <input
              type="checkbox"
              checked={externalSources}
              disabled={busy}
              onChange={(e) => {
                setExternalSources(e.target.checked);
                setResult(null);
              }}
            />
            Add external source screening. I authorize sharing this proposal title or my optional
            public keywords as search terms with Europe PMC, Crossref and Wikipedia, and sending
            retrieved short passages with my proposal evidence to Gemini. Paper abstracts and
            Wikipedia extracts only; this does not certify plagiarism or originality.
          </label>
        )}
        {kind === 'proposal' && externalSources && (
          <label>
            Optional public search keywords
            <input
              maxLength={180}
              value={searchTerms}
              disabled={busy}
              onChange={(e) => {
                setSearchTerms(e.target.value);
                setResult(null);
              }}
              placeholder="For example, machine learning plant disease detection"
            />
            <small>
              Leave blank to search the proposal title. Do not enter personal or confidential
              information.
            </small>
          </label>
        )}
        <label className="engagement-checkbox">
          <input
            type="checkbox"
            checked={consent}
            disabled={busy}
            onChange={(e) => setConsent(e.target.checked)}
          />
          I am authorized to send this project evidence to Gemini and understand that the result is
          a draft for human review.
        </label>
        <Button
          disabled={
            !supabase ||
            busy ||
            (kind === 'qa' && !qaReviewEnabled) ||
            (kind === 'support' && !question.trim()) ||
            !consent ||
            (['proposal', 'document'].includes(kind) && !project) ||
            (kind === 'scheduler' && (!start || !rooms.trim()))
          }
          onClick={() => void run()}
        >
          {busy ? 'Generating verified draft…' : 'Generate draft'}
        </Button>
        <p>
          Assistant drafts are limited to 5 per 15 minutes, 20 per user per day and 100 shared per
          day. Health explanation requests have a separate budget. Document summarization reads up
          to two latest authorized uploads. External email, WhatsApp and Telegram delivery requires
          separately configured services and is not automatically sent.
        </p>
      </section>
      {result && (
        <section className="engagement-card">
          <h2>{labels[kind]} draft</h2>
          <p>Gemini · human review required · Reference {result.id}</p>
          <p>{readableCopy(result.draft.summary)}</p>
          <h3>Findings</h3>
          <ul>
            {result.draft.findings.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
          <h3>Suggested next actions</h3>
          <ul>
            {result.draft.actions.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
          <p>
            References:{' '}
            {result.draft.references.join(', ') ||
              'No references supplied; verify against original evidence.'}
          </p>
          {Boolean(result.evidence?.preview) && (
            <>
              {kind === 'proposal' &&
              result.evidence?.preview &&
              typeof result.evidence.preview === 'object' &&
              'sources' in result.evidence.preview ? (
                <SourceEvidencePanel
                  report={result.evidence.preview as ExternalScreening}
                  context={{
                    projectName: projects.find((p) => p.id === project)?.name,
                    reference: result.id,
                    draft: result.draft,
                  }}
                />
              ) : (
                <>
                  <h3>Rule checked preview</h3>
                  <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {JSON.stringify(result.evidence?.preview, null, 2)}
                  </pre>
                </>
              )}
            </>
          )}
        </section>
      )}
      <section className="engagement-card">
        {result && kind === 'nudge' && <EmailReminderDraft runId={result.id} />}
        <h2>Your saved drafts</h2>
        {history.length ? (
          history.map((h) => (
            <article key={h.id} className="reminder-item">
              <h3>
                {labels[h.kind]} · {h.status}
              </h3>
              <p>
                {new Date(h.created_at).toLocaleString()} · {h.source}
              </p>
              {h.draft && <p>{readableCopy(h.draft.summary)}</p>}
              {h.draft && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (busy) return;
                    setConsent(false);
                    setExternalSources(false);
                    setSearchTerms('');
                    setQuestion('');
                    setError('');
                    setStart('');
                    setRooms('');
                    setSlots(8);
                    setKind(h.kind);
                    setProject(h.project_id || '');
                    setResult({
                      id: h.id,
                      source: h.source,
                      draft: h.draft!,
                      ...(h.report ? { evidence: { preview: h.report } } : {}),
                    });
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Open saved draft{h.report ? ' and report' : ''}
                </Button>
              )}
            </article>
          ))
        ) : (
          <p>No saved agent drafts yet.</p>
        )}
      </section>
    </div>
  );
}
