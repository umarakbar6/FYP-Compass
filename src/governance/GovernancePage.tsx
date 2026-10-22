import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, ClipboardList, Scale } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { Button, EmptyState, ErrorMessage, LoadingState, StatusBadge } from '../components/ui';
import { useWorkspace } from '../lib/use-workspace';
import {
  componentCaps,
  loadGovernanceWorkspace,
  updateGovernance,
  type Rubric,
  type RubricComponent,
  type RubricCriterion,
  type SupervisionMeeting,
} from './api';
import './governance.css';

const componentLabels: Record<RubricComponent, string> = {
  proposal: 'Proposal',
  progress: 'Progress and documentation',
  contribution: 'Individual contribution',
  report: 'Final report',
  implementation: 'Implementation and demonstration',
  viva: 'Viva',
};
const lineItems = (value: FormDataEntryValue | null) =>
  String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
function localDateInput(date: Date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
}

export function GovernancePage() {
  const { user } = useAuth();
  const state = useWorkspace(user, loadGovernanceWorkspace, 'Unable to load project governance.');
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const actor = useRef(user?.id);
  actor.current = user?.id;
  useEffect(() => {
    const first = state.workspace?.projects[0]?.id || '';
    if (!project || !state.workspace?.projects.some((item) => item.id === project))
      setProject(first);
  }, [state.workspace, project]);
  async function run(operation: string, args: Record<string, unknown>, message: string) {
    if (!user || busy) return;
    const current = user.id;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await state.mutate(() => updateGovernance(user, operation, args));
      if (actor.current === current) setSuccess(message);
    } catch (cause) {
      if (actor.current === current)
        setError(cause instanceof Error ? cause.message : 'The update could not be saved.');
    } finally {
      if (actor.current === current) setBusy(false);
    }
  }
  if (!user) return null;
  if (state.loading) return <LoadingState label="Loading project governance…" />;
  const workspace = state.workspace;
  if (!workspace)
    return <ErrorMessage message={state.error || 'Project governance is unavailable.'} />;
  const chosen = workspace.projects.find((item) => item.id === project);
  const meetings = workspace.meetings.filter((item) => item.group_id === project);
  const feedback = workspace.feedback.filter((item) => item.group_id === project);
  return (
    <div className="governance-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">PROJECT GOVERNANCE</span>
          <h1>Meetings, feedback and marking standards</h1>
          <p>
            Keep supervision decisions, student responses and assessment expectations in one
            auditable workspace.
          </p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => void state.refresh()}>
          Refresh
        </Button>
      </div>
      {(error || state.error) && <ErrorMessage message={error || state.error} />}
      {success && (
        <p className="governance-success" role="status">
          {success}
        </p>
      )}
      {workspace.projects.length > 0 && (
        <label className="governance-project-picker">
          Project
          <select value={project} onChange={(event) => setProject(event.target.value)}>
            {workspace.projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {user.role === 'coordinator' && (
        <RubricEditor
          rubric={workspace.active_rubric}
          busy={busy}
          save={(name, description, criteria) =>
            run(
              'fyp_governance_save_rubric',
              { p_name: name, p_description: description, p_criteria: criteria },
              'A new rubric version is active for future assessments.',
            )
          }
        />
      )}
      {workspace.active_rubric && <RubricSummary rubric={workspace.active_rubric} />}
      {chosen ? (
        <>
          <section className="governance-card">
            <div className="governance-section-title">
              <CalendarDays />
              <div>
                <h2>Supervision meetings</h2>
                <p>
                  Students request a meeting. The assigned supervisor confirms it and records formal
                  minutes.
                </p>
              </div>
            </div>
            {user.role !== 'coordinator' && (
              <MeetingForm
                project={project}
                busy={busy}
                submit={(args) =>
                  run(
                    'fyp_governance_book_meeting',
                    args,
                    user.role === 'student'
                      ? 'Meeting request sent to your supervisor.'
                      : 'Meeting scheduled.',
                  )
                }
              />
            )}
            <div className="governance-list">
              {meetings.map((meeting) => (
                <article key={meeting.id} className="governance-record">
                  <div className="governance-record-heading">
                    <h3>{new Date(meeting.starts_at).toLocaleString()}</h3>
                    <StatusBadge
                      tone={
                        meeting.status === 'completed'
                          ? 'green'
                          : meeting.status === 'cancelled'
                            ? 'red'
                            : 'amber'
                      }
                    >
                      {meeting.status}
                    </StatusBadge>
                  </div>
                  <p>
                    {meeting.duration_minutes} minutes · {meeting.location}
                  </p>
                  <p>
                    <strong>Agenda:</strong> {meeting.agenda}
                  </p>
                  {meeting.minutes && (
                    <p>
                      <strong>Minutes:</strong> {meeting.minutes}
                    </p>
                  )}
                  {meeting.decisions.length > 0 && (
                    <>
                      <strong>Decisions</strong>
                      <ul>
                        {meeting.decisions.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {meeting.action_items.length > 0 && (
                    <>
                      <strong>Action items</strong>
                      <ul>
                        {meeting.action_items.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {user.role === 'supervisor' &&
                    ['requested', 'scheduled'].includes(meeting.status) && (
                      <MeetingActions meeting={meeting} busy={busy} run={run} />
                    )}
                  {user.role === 'student' &&
                    meeting.status === 'requested' &&
                    meeting.created_by === user.id && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            'fyp_governance_update_meeting',
                            {
                              p_id: meeting.id,
                              p_expected_version: meeting.version,
                              p_action: 'cancel',
                            },
                            'Meeting request cancelled.',
                          )
                        }
                      >
                        Cancel request
                      </Button>
                    )}
                </article>
              ))}
            </div>
            {!meetings.length && (
              <EmptyState
                title="No supervision meetings yet"
                description="Book the first meeting to establish an agenda and a traceable supervision record."
              />
            )}
          </section>
          <section className="governance-card">
            <div className="governance-section-title">
              <CheckCircle2 />
              <div>
                <h2>Feedback resolution tracker</h2>
                <p>
                  Review comments stay open until the team responds and the supervisor verifies the
                  resolution.
                </p>
              </div>
            </div>
            {user.role === 'supervisor' && (
              <FeedbackForm
                project={project}
                busy={busy}
                submit={(args) =>
                  run(
                    'fyp_governance_create_feedback',
                    args,
                    'Feedback item added to the project tracker.',
                  )
                }
              />
            )}
            <div className="governance-list">
              {feedback.map((item) => (
                <article key={item.id} className="governance-record">
                  <div className="governance-record-heading">
                    <h3>{item.title}</h3>
                    <StatusBadge
                      tone={
                        item.status === 'verified'
                          ? 'green'
                          : item.status === 'addressed'
                            ? 'amber'
                            : item.status === 'reopened'
                              ? 'red'
                              : 'neutral'
                      }
                    >
                      {item.status}
                    </StatusBadge>
                  </div>
                  <p className="governance-meta">
                    {item.source_type} feedback · {new Date(item.created_at).toLocaleString()}
                  </p>
                  <p>{item.details}</p>
                  {item.student_response && (
                    <p>
                      <strong>Student response:</strong> {item.student_response}
                    </p>
                  )}
                  {user.role === 'student' && ['open', 'reopened'].includes(item.status) && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        void run(
                          'fyp_governance_respond_feedback',
                          {
                            p_id: item.id,
                            p_expected_version: item.version,
                            p_response: String(form.get('response')),
                          },
                          'Response submitted for supervisor verification.',
                        );
                      }}
                    >
                      <label>
                        How this feedback was addressed
                        <textarea name="response" minLength={3} maxLength={6000} required />
                      </label>
                      <Button disabled={busy} type="submit">
                        Mark as addressed
                      </Button>
                    </form>
                  )}
                  {user.role === 'supervisor' &&
                    ['addressed', 'verified'].includes(item.status) && (
                      <div className="governance-actions">
                        {item.status === 'addressed' && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void run(
                                'fyp_governance_review_feedback',
                                {
                                  p_id: item.id,
                                  p_expected_version: item.version,
                                  p_action: 'verify',
                                },
                                'Feedback resolution verified.',
                              )
                            }
                          >
                            Verify resolution
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              'fyp_governance_review_feedback',
                              {
                                p_id: item.id,
                                p_expected_version: item.version,
                                p_action: 'reopen',
                              },
                              'Feedback item reopened for further work.',
                            )
                          }
                        >
                          Reopen
                        </Button>
                      </div>
                    )}
                </article>
              ))}
            </div>
            {!feedback.length && (
              <EmptyState
                title="No tracked feedback"
                description="Proposal and milestone rework comments appear automatically; supervisors can also add meeting or general feedback."
              />
            )}
          </section>
        </>
      ) : (
        <EmptyState
          title="No governed projects"
          description="An active project allocation is required before meetings or feedback can be managed."
        />
      )}
    </div>
  );
}

function MeetingForm({
  project,
  busy,
  submit,
}: {
  project: string;
  busy: boolean;
  submit: (args: Record<string, unknown>) => void;
}) {
  return (
    <form
      className="governance-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        submit({
          p_group_id: project,
          p_starts_at: new Date(String(form.get('starts'))).toISOString(),
          p_duration: Number(form.get('duration')),
          p_location: String(form.get('location')),
          p_agenda: String(form.get('agenda')),
        });
      }}
    >
      <div className="governance-grid">
        <label>
          Date and time
          <input
            name="starts"
            type="datetime-local"
            min={localDateInput(new Date(Date.now() + 5 * 60_000))}
            required
          />
        </label>
        <label>
          Duration
          <select name="duration" defaultValue="45">
            <option value="30">30 minutes</option>
            <option value="45">45 minutes</option>
            <option value="60">60 minutes</option>
            <option value="90">90 minutes</option>
          </select>
        </label>
        <label>
          Room or meeting link
          <input name="location" minLength={2} maxLength={240} required />
        </label>
        <label>
          Agenda
          <textarea name="agenda" minLength={3} maxLength={4000} required />
        </label>
      </div>
      <Button disabled={busy || !project} type="submit">
        Book supervision meeting
      </Button>
    </form>
  );
}

function MeetingActions({
  meeting,
  busy,
  run,
}: {
  meeting: SupervisionMeeting;
  busy: boolean;
  run: (operation: string, args: Record<string, unknown>, message: string) => Promise<void>;
}) {
  return (
    <details>
      <summary>Manage meeting</summary>
      <form
        className="governance-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const action = String(form.get('action'));
          void run(
            'fyp_governance_update_meeting',
            {
              p_id: meeting.id,
              p_expected_version: meeting.version,
              p_action: action,
              p_starts_at: form.get('starts')
                ? new Date(String(form.get('starts'))).toISOString()
                : null,
              p_location: String(form.get('location') || ''),
              p_minutes: String(form.get('minutes') || ''),
              p_decisions: lineItems(form.get('decisions')),
              p_action_items: lineItems(form.get('actions')),
            },
            action === 'complete' ? 'Meeting minutes saved.' : 'Meeting updated.',
          );
        }}
      >
        <div className="governance-grid">
          <label>
            Action
            <select
              name="action"
              defaultValue={meeting.status === 'requested' ? 'confirm' : 'complete'}
            >
              <option value="confirm">Confirm request</option>
              <option value="reschedule">Reschedule</option>
              <option value="complete">Complete with minutes</option>
              <option value="cancel">Cancel</option>
            </select>
          </label>
          <label>
            New date and time, if rescheduling
            <input name="starts" type="datetime-local" />
          </label>
          <label>
            New location, if needed
            <input name="location" maxLength={240} />
          </label>
          <label>
            Meeting minutes
            <textarea name="minutes" maxLength={12000} />
          </label>
          <label>
            Decisions, one per line
            <textarea name="decisions" maxLength={6000} />
          </label>
          <label>
            Action items, one per line
            <textarea name="actions" maxLength={6000} />
          </label>
        </div>
        <Button disabled={busy} type="submit">
          Save meeting update
        </Button>
      </form>
    </details>
  );
}

function FeedbackForm({
  project,
  busy,
  submit,
}: {
  project: string;
  busy: boolean;
  submit: (args: Record<string, unknown>) => void;
}) {
  return (
    <form
      className="governance-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        submit({
          p_group_id: project,
          p_source_type: String(form.get('source')),
          p_source_id: crypto.randomUUID(),
          p_title: String(form.get('title')),
          p_details: String(form.get('details')),
        });
        event.currentTarget.reset();
      }}
    >
      <div className="governance-grid">
        <label>
          Source
          <select name="source">
            <option value="general">General supervision</option>
            <option value="meeting">Meeting follow up</option>
          </select>
        </label>
        <label>
          Feedback title
          <input name="title" minLength={3} maxLength={180} required />
        </label>
        <label className="governance-wide">
          Required change or evidence
          <textarea name="details" minLength={3} maxLength={6000} required />
        </label>
      </div>
      <Button disabled={busy} type="submit">
        Add tracked feedback
      </Button>
    </form>
  );
}

function RubricSummary({ rubric }: { rubric: Rubric }) {
  return (
    <section className="governance-card">
      <div className="governance-section-title">
        <Scale />
        <div>
          <h2>Active marking rubric · version {rubric.version}</h2>
          <p>
            {rubric.name}: {rubric.description}
          </p>
        </div>
      </div>
      <div className="rubric-summary">
        {(Object.keys(componentLabels) as RubricComponent[]).map((component) => (
          <article key={component}>
            <h3>
              {componentLabels[component]} / {componentCaps[component]}
            </h3>
            <ul>
              {rubric.criteria
                .filter((criterion) => criterion.component === component)
                .map((criterion) => (
                  <li key={criterion.id}>
                    <strong>
                      {criterion.label} ({criterion.points})
                    </strong>
                    {criterion.guidance && <span>{criterion.guidance}</span>}
                  </li>
                ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

function RubricEditor({
  rubric,
  busy,
  save,
}: {
  rubric: Rubric | null;
  busy: boolean;
  save: (name: string, description: string, criteria: RubricCriterion[]) => void;
}) {
  const [name, setName] = useState(rubric?.name || '');
  const [description, setDescription] = useState(rubric?.description || '');
  const [criteria, setCriteria] = useState<RubricCriterion[]>(rubric?.criteria || []);
  useEffect(() => {
    if (rubric) {
      setName(rubric.name);
      setDescription(rubric.description);
      setCriteria(rubric.criteria);
    }
  }, [rubric?.id]);
  const totals = useMemo(
    () =>
      Object.fromEntries(
        Object.keys(componentCaps).map((component) => [
          component,
          criteria
            .filter((criterion) => criterion.component === component)
            .reduce((sum, criterion) => sum + Number(criterion.points || 0), 0),
        ]),
      ),
    [criteria],
  );
  function change(id: string, field: keyof RubricCriterion, value: string | number) {
    setCriteria((current) =>
      current.map((criterion) =>
        criterion.id === id ? { ...criterion, [field]: value } : criterion,
      ),
    );
  }
  return (
    <section className="governance-card">
      <div className="governance-section-title">
        <ClipboardList />
        <div>
          <h2>Custom marking rubric</h2>
          <p>
            Saving creates a new immutable version for future marks. Existing submitted assessments
            keep their original rubric snapshot.
          </p>
        </div>
      </div>
      <div className="governance-grid">
        <label>
          Rubric name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
          />
        </label>
      </div>
      {(Object.keys(componentCaps) as RubricComponent[]).map((component) => (
        <div className="rubric-editor" key={component}>
          <div className="rubric-component-heading">
            <h3>{componentLabels[component]}</h3>
            <StatusBadge tone={totals[component] === componentCaps[component] ? 'green' : 'red'}>
              {totals[component]} / {componentCaps[component]}
            </StatusBadge>
          </div>
          {criteria
            .filter((criterion) => criterion.component === component)
            .map((criterion) => (
              <div className="rubric-row" key={criterion.id}>
                <label>
                  Criterion
                  <input
                    value={criterion.label}
                    maxLength={120}
                    onChange={(event) => change(criterion.id, 'label', event.target.value)}
                  />
                </label>
                <label>
                  Points
                  <input
                    type="number"
                    min="0.01"
                    max={componentCaps[component]}
                    step="0.01"
                    value={criterion.points}
                    onChange={(event) => change(criterion.id, 'points', Number(event.target.value))}
                  />
                </label>
                <label>
                  Guidance
                  <input
                    value={criterion.guidance}
                    maxLength={1000}
                    onChange={(event) => change(criterion.id, 'guidance', event.target.value)}
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={criteria.filter((item) => item.component === component).length === 1}
                  onClick={() =>
                    setCriteria((current) => current.filter((item) => item.id !== criterion.id))
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setCriteria((current) => [
                ...current,
                {
                  id: `${component}_${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`,
                  component,
                  label: 'New criterion',
                  guidance: '',
                  points: 0,
                },
              ])
            }
          >
            Add criterion
          </Button>
        </div>
      ))}
      <Button
        disabled={
          busy ||
          !name.trim() ||
          Object.entries(componentCaps).some(
            ([component, cap]) => Math.abs(totals[component] - cap) > 0.001,
          )
        }
        onClick={() => save(name, description, criteria)}
      >
        Activate new rubric version
      </Button>
    </section>
  );
}
