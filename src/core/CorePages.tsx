import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useWorkspace } from '../lib/use-workspace';
import { Button, EmptyState, ErrorMessage, LoadingState, StatusBadge } from '../components/ui';
import {
  loadCoreConfig,
  configureCore,
  loadCoreReport,
  matchCore,
  manualAllocate,
  reportSummary,
  type CoreConfig,
} from './api';
import '../assessment/assessment.css';
function useActions<T>(
  userId: string | undefined,
  mutate: (op: () => Promise<T>) => Promise<void>,
) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const lock = useRef(false),
    scope = useRef(userId);
  scope.current = userId;
  useEffect(() => {
    lock.current = false;
    setBusy(false);
    setError('');
    setSuccess('');
  }, [userId]);
  async function run(operation: () => Promise<T>) {
    if (lock.current) return;
    const account = userId;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await mutate(operation);
      if (scope.current === account) setSuccess('Saved.');
    } catch (e) {
      if (scope.current === account) setError(e instanceof Error ? e.message : 'Update failed.');
    } finally {
      if (scope.current === account) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  return { busy, error, success, run };
}
function SessionSelect({ sessions }: { sessions: CoreConfig['sessions'] }) {
  return (
    <label>
      Session
      <select required name="session_id" defaultValue={sessions.find((s) => s.active)?.id || ''}>
        <option value="" disabled>
          Choose session
        </option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.active ? ' (active)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
export function ConfigurationPage() {
  const { user } = useAuth();
  const state = useWorkspace(user, loadCoreConfig, 'Unable to load configuration.');
  const actions = useActions(user?.id, state.mutate);
  if (!user) return null;
  const c = state.workspace;
  function submit(
    e: FormEvent<HTMLFormElement>,
    op: string,
    build: (f: FormData) => Record<string, unknown>,
  ) {
    e.preventDefault();
    const form = e.currentTarget;
    void actions.run(() => configureCore(user!, op, build(new FormData(form))));
  }
  return (
    <div className="assessment-page">
      <div className="page-heading">
        <div>
          <h1>Session configuration</h1>
          <p>
            Configure a session, enroll students, add three supervisors and prepare milestone
            templates before matching.
          </p>
        </div>
        <Button disabled={actions.busy} variant="secondary" onClick={() => void state.refresh()}>
          Refresh
        </Button>
      </div>
      {(actions.error || state.error) && <ErrorMessage message={actions.error || state.error} />}{' '}
      {actions.success && <p role="status">{actions.success}</p>}
      {state.loading ? (
        <LoadingState />
      ) : (
        c && (
          <>
            <section className="assessment-card">
              <h2>Academic sessions</h2>
              {c.sessions.map((s) => (
                <div key={s.id}>
                  {s.name}{' '}
                  <StatusBadge tone={s.active ? 'green' : 'neutral'}>
                    {s.active ? 'Active' : 'Archived'}
                  </StatusBadge>
                  {!s.active && (
                    <Button
                      disabled={actions.busy}
                      variant="secondary"
                      onClick={() =>
                        void actions.run(() =>
                          configureCore(user, 'activate_session', { id: s.id }),
                        )
                      }
                    >
                      Activate
                    </Button>
                  )}
                </div>
              ))}
              <form
                onSubmit={(e) =>
                  submit(e, 'session', (f) => ({
                    name: String(f.get('name')),
                    active: f.get('active') === 'on',
                  }))
                }
              >
                <div className="assessment-fields">
                  <label>
                    New session name
                    <input name="name" required maxLength={100} />
                  </label>
                  <label className="assessment-checkbox">
                    <input name="active" type="checkbox" />
                    Make active
                  </label>
                </div>
                <Button type="submit" disabled={actions.busy}>
                  Add session
                </Button>
              </form>
            </section>
            <section className="assessment-card">
              <h2>Controlled topics</h2>
              <p>{c.topics.map((t) => t.name).join(' · ') || 'No topics yet.'}</p>
              <form onSubmit={(e) => submit(e, 'topic', (f) => ({ name: String(f.get('name')) }))}>
                <div className="assessment-fields">
                  <label>
                    Topic name
                    <input name="name" required maxLength={80} />
                  </label>
                </div>
                <Button disabled={actions.busy} type="submit">
                  Add topic
                </Button>
              </form>
            </section>
            <section className="assessment-card">
              <h2>Enroll students</h2>
              <p>
                {
                  c.participants.filter((p) =>
                    c.people.some(
                      (person) => person.id === p.profile_id && person.role === 'student',
                    ),
                  ).length
                }{' '}
                student enrollments.
              </p>
              <form
                onSubmit={(e) =>
                  submit(e, 'enroll', (f) => ({
                    session_id: String(f.get('session_id')),
                    profile_id: String(f.get('profile_id')),
                  }))
                }
              >
                <div className="assessment-fields">
                  <SessionSelect sessions={c.sessions} />
                  <label>
                    Student
                    <select name="profile_id" required defaultValue="">
                      <option value="" disabled>
                        Choose student
                      </option>
                      {c.people
                        .filter((p) => p.role === 'student')
                        .map((p) => (
                          <option value={p.id} key={p.id}>
                            {p.full_name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <Button disabled={actions.busy} type="submit">
                  Save enrollment
                </Button>
              </form>
            </section>
            <section className="assessment-card">
              <h2>Supervisor capacity and topics</h2>
              {c.capacities.map((cap) => (
                <p key={cap.session_id + cap.supervisor_id}>
                  {c.people.find((p) => p.id === cap.supervisor_id)?.full_name}: {cap.max_groups}{' '}
                  groups ·{' '}
                  {cap.topic_ids.map((id) => c.topics.find((t) => t.id === id)?.name).join(', ')}
                </p>
              ))}
              <form
                onSubmit={(e) =>
                  submit(e, 'capacity', (f) => ({
                    session_id: String(f.get('session_id')),
                    supervisor_id: String(f.get('supervisor_id')),
                    max_groups: Number(f.get('max_groups')),
                    topic_ids: f.getAll('topic_ids').map(String),
                  }))
                }
              >
                <div className="assessment-fields">
                  <SessionSelect sessions={c.sessions} />
                  <label>
                    Supervisor
                    <select name="supervisor_id" required defaultValue="">
                      <option value="" disabled>
                        Choose supervisor
                      </option>
                      {c.people
                        .filter((p) => p.role === 'supervisor')
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.full_name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Maximum groups
                    <input name="max_groups" type="number" min="0" max="100" step="1" required />
                  </label>
                  <label>
                    Supervisor topics
                    <select name="topic_ids" multiple>
                      {c.topics.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <Button disabled={actions.busy} type="submit">
                  Save capacity and topics
                </Button>
              </form>
            </section>
            <section className="assessment-card">
              <h2>Milestone templates</h2>
              {c.templates.map((t) => (
                <p key={t.id}>
                  {t.name}: {t.days} days after proposal approval · {t.description}
                </p>
              ))}
              <form
                onSubmit={(e) =>
                  submit(e, 'template', (f) => ({
                    session_id: String(f.get('session_id')),
                    name: String(f.get('name')),
                    description: String(f.get('description')),
                    days: Number(f.get('days')),
                  }))
                }
              >
                <div className="assessment-fields">
                  <SessionSelect sessions={c.sessions} />
                  <label>
                    Milestone name
                    <input name="name" required maxLength={100} />
                  </label>
                  <label>
                    Days after approval
                    <input type="number" name="days" required min="1" max="365" step="1" />
                  </label>
                  <label>
                    Description
                    <textarea name="description" maxLength={4000} />
                  </label>
                </div>
                <Button disabled={actions.busy} type="submit">
                  Add milestone template
                </Button>
              </form>
            </section>
          </>
        )
      )}
    </div>
  );
}
export function MatchingPage() {
  const { user } = useAuth();
  const state = useWorkspace(user, loadCoreReport, 'Unable to load matching records.');
  const actions = useActions(user?.id, state.mutate);
  if (!user) return null;
  const r = state.workspace;
  const session = r?.sessions.find((s) => s.active);
  const groups =
    r?.groups.filter((g) => g.session_id === session?.id && g.proposal?.submitted_at) || [];
  return (
    <div className="assessment-page">
      <div className="page-heading">
        <div>
          <h1>Supervisor matching</h1>
          <p>
            Matching starts with each group’s first choice, then considers second and third choices.
            Up to two topic points break ties within each round. The saved seed resolves any
            remaining ties.
          </p>
        </div>
      </div>
      {(actions.error || state.error) && <ErrorMessage message={actions.error || state.error} />}{' '}
      {actions.success && <p role="status">{actions.success}</p>}
      <section className="assessment-card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const seed = String(new FormData(e.currentTarget).get('seed'));
            void actions.run(() => matchCore(user, seed));
          }}
        >
          <div className="assessment-fields">
            <label>
              Repeatable matching seed
              <input name="seed" required maxLength={100} defaultValue="fyp-compass-2026" />
            </label>
          </div>
          <Button disabled={actions.busy || state.loading || !session} type="submit">
            Run all preference rounds
          </Button>
        </form>
      </section>
      {state.loading ? (
        <LoadingState />
      ) : groups.length ? (
        groups.map((g) => (
          <section className="assessment-card" key={g.id}>
            <h2>
              {g.name}: {g.proposal?.title}
            </h2>
            <StatusBadge tone={g.allocation ? 'green' : 'amber'}>
              {g.allocation ? 'Allocated' : 'Unmatched'}
            </StatusBadge>
            <p>
              {g.allocation
                ? r?.people.find((p) => p.id === g.allocation?.supervisor_id)?.full_name
                : 'No supervisor yet'}
            </p>
            <p>{g.allocation?.explanation}</p>
            <p>
              Preferences:{' '}
              {g.proposal?.supervisor_ids
                .map((id) => r?.people.find((p) => p.id === id)?.full_name || id)
                .join(' → ')}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void actions.run(() =>
                  manualAllocate(user, g.id, String(f.get('supervisor')), String(f.get('reason'))),
                );
              }}
            >
              <div className="assessment-fields">
                <label>
                  Manual allocation / reassignment
                  <select name="supervisor" required defaultValue="">
                    <option value="" disabled>
                      Choose supervisor
                    </option>
                    {r?.capacities
                      .filter((c) => c.session_id === session?.id)
                      .map((c) => (
                        <option key={c.supervisor_id} value={c.supervisor_id}>
                          {r.people.find((p) => p.id === c.supervisor_id)?.full_name} (
                          {c.allocated ?? 0}/{c.max_groups})
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Required audit reason
                  <textarea name="reason" required maxLength={4000} />
                </label>
              </div>
              <Button variant="secondary" disabled={actions.busy} type="submit">
                Save reasoned allocation
              </Button>
            </form>
          </section>
        ))
      ) : (
        <EmptyState
          title="No submitted groups yet"
          description="Students must submit proposals with three different supervisors before matching."
        />
      )}
    </div>
  );
}
export function ReportsPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const state = useWorkspace(user, loadCoreReport, 'Unable to load accreditation report.');
  const [chosen, setChosen] = useState('');
  if (!user) return null;
  const r = state.workspace;
  const requested = params.get('session');
  const session =
    chosen ||
    (r?.sessions.some((s) => s.id === requested) ? requested! : '') ||
    r?.sessions.find((s) => s.active)?.id ||
    '';
  const summary = r ? reportSummary(r, session) : null;
  const name = (id: string) => r?.people.find((p) => p.id === id)?.full_name || id;
  return (
    <div className="assessment-page accreditation-report print-report">
      <div className="accreditation-print-heading" style={{ display: 'none' }}>
        <p>FYP Compass</p>
        <h1>Accreditation report</h1>
        <p>Academic session: {r?.sessions.find((s) => s.id === session)?.name || 'Session'}</p>
        <p>
          Generated: {new Date().toLocaleString()} · Prepared by {user.full_name}
        </p>
        <p>Private academic report. Share only with authorized reviewers.</p>
      </div>
      <div className="page-heading">
        <div>
          <h1>Accreditation report</h1>
          <p>
            Session totals, allocations, project progress and individual results from the database.
          </p>
        </div>
        <Button variant="secondary" onClick={() => window.print()} disabled={!r}>
          Print / save PDF
        </Button>
      </div>
      {params.get('view') === 'full' && (
        <Link className="accreditation-report-controls" to="/coordinator/reports">
          Back to report summary
        </Link>
      )}
      {state.error && <ErrorMessage message={state.error} />}{' '}
      {state.loading ? (
        <LoadingState />
      ) : (
        r &&
        summary && (
          <>
            <label className="accreditation-report-controls">
              Report session
              <select value={session} onChange={(e) => setChosen(e.target.value)}>
                {r.sessions.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <section className="assessment-card">
              <h2>{r.sessions.find((s) => s.id === session)?.name || 'Session'} overview</h2>
              <div className="assessment-result">
                <div>
                  Enrolled students<strong>{summary.students}</strong>
                </div>
                <div>
                  Groups<strong>{summary.groups.length}</strong>
                </div>
                <div>
                  Submitted groups<strong>{summary.submitted.length}</strong>
                </div>
                <div>
                  Matched groups<strong>{summary.matched.length}</strong>
                </div>
                <div>
                  Unmatched groups<strong>{summary.unmatched}</strong>
                </div>
                <div>
                  Released completion<strong>{summary.completion}%</strong>
                </div>
              </div>
              <p>
                First / second / third preference rates among matched groups:{' '}
                {summary.preferenceRates.join('% / ')}%
              </p>
              <p>
                Pending peer reviews: {summary.pendingPeers} · Health:{' '}
                {['green', 'amber', 'red']
                  .map(
                    (level) =>
                      level +
                      ' ' +
                      r.health.filter((h) => summary.ids.has(h.project_id) && h.level === level)
                        .length,
                  )
                  .join(' · ')}
              </p>
              <p>
                Milestones:{' '}
                {['not_started', 'submitted', 'needs_rework', 'accepted']
                  .map(
                    (status) =>
                      status.replaceAll('_', ' ') +
                      ' ' +
                      r.milestones.filter((m) => summary.ids.has(m.group_id) && m.status === status)
                        .length,
                  )
                  .join(' · ')}
              </p>
            </section>
            <section className="assessment-card">
              <h2>Project titles, topics and allocations</h2>
              {summary.groups.map((g) => (
                <div key={g.id}>
                  <h3>
                    {g.name}: {g.proposal?.title || 'Proposal pending'}
                  </h3>
                  <p>
                    {g.members.map((m) => m.full_name).join(', ')} ·{' '}
                    {g.proposal?.status.replaceAll('_', ' ')}
                  </p>
                  <p>
                    Topics:{' '}
                    {g.proposal?.topic_ids
                      .map((id) => r.topics.find((t) => t.id === id)?.name)
                      .join(', ')}
                  </p>
                  <p>Preferences: {g.proposal?.supervisor_ids.map(name).join(' → ')}</p>
                  <p>
                    Allocation: {g.allocation ? name(g.allocation.supervisor_id) : 'Unmatched'} ·{' '}
                    {g.allocation?.explanation}
                  </p>
                </div>
              ))}
            </section>
            <section className="assessment-card">
              <h2>Supervisor workloads</h2>
              {r.capacities
                .filter((c) => c.session_id === session)
                .map((c) => (
                  <p key={c.supervisor_id}>
                    {name(c.supervisor_id)}: {c.allocated ?? 0} / {c.max_groups} groups
                  </p>
                ))}
            </section>
            <section className="assessment-card">
              <h2>Defense assignments and missing assessments</h2>
              {r.defenses
                .filter((d) => summary.ids.has(d.project_id))
                .map((d) => (
                  <p key={d.id}>
                    {summary.groups.find((g) => g.id === d.project_id)?.name} ·{' '}
                    {new Date(d.scheduled_at).toLocaleString()} · {d.location} ·{' '}
                    {name(d.examiner_one)} and {name(d.examiner_two)} · {d.assessments_received}/2
                    submitted
                  </p>
                ))}
            </section>
            <section className="assessment-card">
              <h2>Marking breakdowns and distribution</h2>
              {summary.results.map((result) => (
                <p key={result.id}>
                  {name(result.student_id)}: group {result.group_mark}/55 + individual{' '}
                  {result.individual_mark}/45 = {result.total}/100 ·{' '}
                  {result.released_at ? 'Released' : 'Verified, not released'}
                </p>
              ))}
              <p>
                {[
                  [0, 39],
                  [40, 49],
                  [50, 59],
                  [60, 69],
                  [70, 79],
                  [80, 100],
                ]
                  .map(
                    ([low, high]) =>
                      low +
                      ' to ' +
                      high +
                      ': ' +
                      summary.results.filter(
                        (r) => r.total >= low && r.total < (high === 100 ? 101 : high + 1),
                      ).length,
                  )
                  .join(' · ')}
              </p>
            </section>
            <section className="assessment-card">
              <h2>Allocation audit</h2>
              {!r.audit.some(
                (a) =>
                  Boolean(a) &&
                  typeof a === 'object' &&
                  (a as { action?: string }).action === 'manual_allocation' &&
                  summary.ids.has((a as { record_id: string }).record_id),
              ) && <p>No manual allocation changes were recorded for this session.</p>}
              {r.audit
                .filter(
                  (
                    a,
                  ): a is {
                    action: string;
                    record_id: string;
                    details: { reason?: string };
                    created_at: string;
                  } =>
                    Boolean(a) &&
                    typeof a === 'object' &&
                    (a as { action?: string }).action === 'manual_allocation' &&
                    summary.ids.has((a as { record_id: string }).record_id),
                )
                .map((a, i) => (
                  <p key={i}>
                    {new Date(a.created_at).toLocaleString()} · {a.details.reason}
                  </p>
                ))}
            </section>
          </>
        )
      )}
    </div>
  );
}
