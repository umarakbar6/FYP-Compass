import { DecisionAssistant } from '../operations/DecisionAssistant';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Button, EmptyState, ErrorMessage, FileUploader, StatusBadge } from '../components/ui';
import { demoEnabled } from '../lib/supabase';
import { latestSubmission, milestoneDocumentUrl } from '../lib/milestone-api';
import type { Milestone, MilestoneProject, MilestoneSubmission } from '../types/milestone';
import { useMilestones } from './MilestoneProvider';
import { dateLabel, MilestoneBadge, TimingBadge, MilestoneDataMode, MilestoneGate } from './common';
function StudentEvidenceForm({ item }: { item: Milestone }) {
  const { user } = useAuth();
  const { submit, contribute } = useMilestones();
  const latest = latestSubmission(item);
  const upload = item.status === 'not_started' || item.status === 'needs_rework';
  const [statement, setStatement] = useState(
    upload ? '' : latest?.contributions.find((c) => c.student_id === user!.id)?.statement || '',
  );
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      if (upload) await submit(item.id, file, statement, latest?.id || null);
      else await contribute(item.id, latest!.id, statement);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save evidence.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel phase-form">
      <span className="eyebrow">YOUR INDIVIDUAL EVIDENCE</span>
      <h2>
        {upload
          ? item.status === 'needs_rework'
            ? 'Revise and resubmit'
            : 'Submit this milestone'
          : 'Your contribution statement'}
      </h2>
      <p className="form-hint">
        Describe your own work and evidence. Each teammate records their statement through their own
        account. A new attempt needs fresh statements.
      </p>
      <form onSubmit={(e) => void save(e)} className="milestone-form">
        {upload && (
          <>
            <FileUploader onSelect={setFile} disabled={busy} />
            <p className="form-hint">
              A milestone document is required.
              {demoEnabled && ' This demo saves the filename and size only.'}
            </p>
          </>
        )}
        <label htmlFor="contribution-statement">Your contribution statement (required)</label>
        <textarea
          id="contribution-statement"
          required
          maxLength={4000}
          rows={6}
          value={statement}
          disabled={busy}
          onChange={(e) => {
            setStatement(e.target.value);
            setSaved(false);
          }}
          placeholder="Explain what you completed and where the evidence can be found…"
        />
        <span className="form-hint">{statement.length} / 4,000 characters</span>
        {error && <ErrorMessage message={error} />}
        {saved && (
          <p className="milestone-success" role="status">
            Your contribution statement was saved.
          </p>
        )}
        <Button disabled={busy || (upload && !file)} type="submit">
          {busy ? 'Saving evidence…' : upload ? 'Submit milestone' : 'Save my contribution'}
        </Button>
      </form>
    </section>
  );
}
function ReviewForm({ item, entry }: { item: Milestone; entry: MilestoneSubmission }) {
  const { review } = useMilestones();
  const [action, setAction] = useState<'accepted' | 'needs_rework'>('accepted');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await review(item.id, entry.id, action, feedback);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save review.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel phase-form">
      <span className="eyebrow">SUPERVISOR DECISION</span>
      <h2>Review the current attempt</h2>
      <form className="milestone-form" onSubmit={(e) => void save(e)}>
        <fieldset disabled={busy} className="milestone-actions">
          <legend>Review decision</legend>
          <label>
            <input
              type="radio"
              name="milestone-action"
              checked={action === 'accepted'}
              onChange={() => setAction('accepted')}
            />{' '}
            Accept milestone
          </label>
          <label>
            <input
              type="radio"
              name="milestone-action"
              checked={action === 'needs_rework'}
              onChange={() => setAction('needs_rework')}
            />{' '}
            Request rework
          </label>
        </fieldset>
        <label htmlFor="milestone-feedback">
          {action === 'needs_rework' ? 'Feedback (required)' : 'Feedback (optional)'}
        </label>
        <textarea
          id="milestone-feedback"
          required={action === 'needs_rework'}
          maxLength={4000}
          rows={5}
          disabled={busy}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Explain what is strong and what needs to change…"
        />
        {error && <ErrorMessage message={error} />}
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving review…' : action === 'accepted' ? 'Accept milestone' : 'Request rework'}
        </Button>
      </form>
    </section>
  );
}
function Contributions({
  project,
  entry,
}: {
  project: MilestoneProject;
  entry: MilestoneSubmission;
}) {
  const missing = project.members.filter(
    (member) => !entry.contributions.some((c) => c.student_id === member.id),
  );
  return (
    <section className="panel phase-form">
      <div className="panel-heading">
        <h2>Individual contributions</h2>
        <StatusBadge tone={missing.length ? 'amber' : 'green'}>
          {entry.contributions.length} / {project.members.length} recorded
        </StatusBadge>
      </div>
      {missing.length > 0 && (
        <div className="guide-accent">
          Missing this attempt: {missing.map((m) => m.full_name).join(', ')}. Review the available
          evidence before deciding.
        </div>
      )}
      <div className="contribution-cards">
        {project.members.map((member) => {
          const c = entry.contributions.find((c) => c.student_id === member.id);
          return (
            <article key={member.id}>
              <strong>{member.full_name}</strong>
              {c ? (
                <>
                  <p className="preserve-lines">{c.statement}</p>
                  <small>Updated {dateLabel(c.updated_at)}</small>
                </>
              ) : (
                <p className="form-hint">No statement for this attempt.</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
function DocumentLink({ entry }: { entry: MilestoneSubmission }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="milestone-file">
      <strong>{entry.document.name}</strong>
      <span>{(entry.document.size / 1024).toFixed(1)} KB</span>
      {entry.document.path ? (
        <>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                setUrl(await milestoneDocumentUrl(entry.document));
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Could not open the document.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Preparing link…' : 'Prepare private download'}
          </Button>
          {url && (
            <a className="text-link" href={url} target="_blank" rel="noopener noreferrer">
              Open document (link valid for 60 seconds) →
            </a>
          )}
        </>
      ) : (
        <span className="form-hint">Demo metadata · contents unavailable</span>
      )}
      {error && <ErrorMessage message={error} />}
    </div>
  );
}
export function MilestoneDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { workspace, loading, error, refresh } = useMilestones();
  if (loading || error || !workspace) return <MilestoneGate />;
  const project = workspace.projects.find((p) => p.milestones.some((m) => m.id === id));
  const item = project?.milestones.find((m) => m.id === id);
  if (!project || !item)
    return (
      <EmptyState
        title="Milestone unavailable"
        description="This milestone is outside your assigned projects or does not exist."
        action={
          <Link className="text-link" to={`/${user?.role}/milestones`}>
            Back to milestones
          </Link>
        }
      />
    );
  const entry = latestSubmission(item);
  return (
    <>
      <Link className="text-link" to={`/${user?.role}/milestones`}>
        ← Back to milestones
      </Link>
      <div className="page-heading milestone-detail-heading">
        <div>
          <span className="eyebrow">{project.group_name}</span>
          <h1>{item.name}</h1>
          <p>{project.title}</p>
        </div>
        <Button variant="secondary" onClick={() => void refresh()}>
          Refresh milestone
        </Button>
      </div>
      <MilestoneDataMode />
      <div className="milestone-deadline-strip">
        <div>
          <span className="eyebrow">DEADLINE · PKT</span>
          <strong>{dateLabel(item.deadline)}</strong>
        </div>
        <div>
          <span className="eyebrow">WORKFLOW</span>
          <MilestoneBadge item={item} />
        </div>
        <div>
          <span className="eyebrow">TIMING</span>
          <TimingBadge item={item} />
        </div>
        <div>
          <span className="eyebrow">ATTEMPTS</span>
          <strong>{item.submissions.length}</strong>
        </div>
      </div>
      <div className="milestone-detail-grid">
        <div className="milestone-stack">
          <section className="panel phase-form">
            <span className="eyebrow">DELIVERABLE</span>
            <h2>What to submit</h2>
            <p>{item.description}</p>
            {entry ? (
              <>
                <p className="form-hint">
                  Latest attempt submitted {dateLabel(entry.submitted_at)} by{' '}
                  {project.members.find((m) => m.id === entry.submitted_by)?.full_name}
                </p>
                <DocumentLink key={entry.id} entry={entry} />
              </>
            ) : (
              <p className="form-hint">No submission has been recorded.</p>
            )}
          </section>
          {entry && <Contributions project={project} entry={entry} />}
        </div>
        <div className="milestone-stack">
          {entry && <DecisionAssistant projectId={project.id} kind="document" />}
          {entry?.review && (
            <section className="panel phase-form milestone-feedback-panel">
              <span className="eyebrow">SUPERVISOR FEEDBACK</span>
              <h2>{item.status === 'accepted' ? 'Milestone accepted.' : 'Rework requested.'}</h2>
              <p className="preserve-lines">
                {entry.review.feedback || 'Your supervisor accepted this milestone.'}
              </p>
              <small>{dateLabel(entry.review.reviewed_at)}</small>
            </section>
          )}
          {user?.role === 'student' && item.status !== 'accepted' && (
            <StudentEvidenceForm
              key={`${item.id}-${entry?.id || 'new'}-${item.status}`}
              item={item}
            />
          )}
          {user?.role === 'supervisor' && item.status === 'submitted' && entry && (
            <ReviewForm key={entry.id} item={item} entry={entry} />
          )}
          {user?.role === 'supervisor' && item.status !== 'submitted' && (
            <section className="panel">
              <EmptyState
                title={
                  item.status === 'needs_rework'
                    ? 'Waiting for revised evidence'
                    : item.status === 'accepted'
                      ? 'Review complete'
                      : 'Waiting for a submission'
                }
                description="Only the current submitted attempt can receive a review."
              />
            </section>
          )}
          {user?.role === 'student' && item.status === 'accepted' && (
            <div className="guide-accent">
              Accepted evidence is locked. Your supervisor’s feedback appears on your dashboard.
            </div>
          )}
        </div>
      </div>
      {item.submissions.length > 1 && (
        <section className="panel milestone-history">
          <h2>Previous attempts</h2>
          {item.submissions
            .slice(0, -1)
            .reverse()
            .map((s) => (
              <details key={s.id}>
                <summary>
                  {dateLabel(s.submitted_at)} ·{' '}
                  {s.review?.action === 'needs_rework'
                    ? 'Rework requested'
                    : s.review?.action === 'accepted'
                      ? 'Accepted'
                      : 'Submitted'}{' '}
                  · {s.document.name}
                </summary>
                <p className="preserve-lines">{s.review?.feedback || 'No feedback recorded.'}</p>
                <DocumentLink entry={s} />
                <Contributions project={project} entry={s} />
              </details>
            ))}
        </section>
      )}
    </>
  );
}
