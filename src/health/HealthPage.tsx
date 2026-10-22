import { formatHealthEvidence } from './format-evidence';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useHealth } from './HealthProvider';
import { Button, EmptyState, ErrorMessage, LoadingState, StatusBadge } from '../components/ui';
import { demoEnabled } from '../lib/supabase';
import type { HealthReport } from './types';
import './health.css';
function DraftReview({ report }: { report: HealthReport }) {
  const { review } = useHealth();
  const [text, setText] = useState({
    explanation: report.explanation,
    action: report.action,
    message: report.message,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function decide(action: 'approve' | 'reject') {
    setBusy(true);
    setError('');
    try {
      await review(report.id, report.version, action, text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to review draft.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="panel phase-form health-draft">
      <div className="panel-heading">
        <h3>Review student message</h3>
        <StatusBadge>{report.status}</StatusBadge>
      </div>
      <p className="form-hint">
        {report.source === 'fallback' ? 'Rule based fallback' : 'Gemini explanation'} · The risk
        level stays fixed.
      </p>
      {(['explanation', 'action', 'message'] as const).map((field) => (
        <div key={field}>
          <label htmlFor={report.id + field}>
            {field === 'action'
              ? 'Recommended action'
              : field === 'message'
                ? 'Student message'
                : 'Explanation'}
          </label>
          <textarea
            id={report.id + field}
            value={text[field]}
            maxLength={4000}
            rows={field === 'message' ? 5 : 3}
            disabled={busy || report.status !== 'draft'}
            onChange={(e) => setText({ ...text, [field]: e.target.value })}
          />
        </div>
      ))}
      {error && <ErrorMessage message={error} />}
      {report.status === 'draft' && (
        <div className="health-actions">
          <Button disabled={busy} onClick={() => void decide('approve')}>
            Approve and publish
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void decide('reject')}>
            Reject draft
          </Button>
        </div>
      )}
      {report.status === 'approved' && (
        <p role="status">Approved message published to all group members.</p>
      )}
      {report.status === 'rejected' && (
        <p role="status">
          {report.reviewer_id === null
            ? 'Evidence changed. This superseded draft was not published.'
            : 'Rejected message was not published.'}
        </p>
      )}
    </article>
  );
}
export function HealthPage() {
  const state = useHealth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Health action failed.');
    } finally {
      setBusy(false);
    }
  }
  if (state.loading) return <LoadingState label="Calculating group health…" />;
  if (state.error || !state.workspace)
    return (
      <>
        <ErrorMessage message={state.error || 'Health data unavailable.'} />
        <Button onClick={() => void state.refresh()}>Retry health</Button>
      </>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">RULES FIRST · HUMAN APPROVAL</span>
          <h1>Group health</h1>
          <p>Evidence determines the risk. Messages reach students after your review.</p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => void run(state.calculate)}>
          Recalculate health
        </Button>
      </div>
      <p className="health-mode">
        {demoEnabled
          ? 'Local demo · fallback explanations · prepared scenarios are labelled.'
          : 'Connected health workspace · server rules and approval contract required.'}
      </p>
      {error && <ErrorMessage message={error} />}
      {!state.workspace.projects.length && (
        <EmptyState
          title="No assigned projects"
          description="Health records appear for your allocated project groups."
        />
      )}
      <div className="health-grid">
        {state.workspace.projects.map((project) => (
          <section
            key={project.id}
            className={'panel phase-form health-card health-' + project.health.level}
          >
            <div className="health-title">
              <div>
                <span className="eyebrow">{project.name}</span>
                <h2>{project.title}</h2>
              </div>
              <StatusBadge tone={project.health.level}>
                {project.health.level.toUpperCase()}
              </StatusBadge>
            </div>
            <p className="form-hint">
              Calculated {new Date(project.health.calculated_at).toLocaleString()}
              {project.prepared ? ' · Prepared demo scenario' : ''}
            </p>
            {project.health.rules.length ? (
              <ul className="health-evidence">
                {project.health.rules.map((rule, index) => (
                  <li key={index}>
                    <strong>{rule.code.replaceAll('_', ' ')}</strong>
                    <p>{formatHealthEvidence(rule.evidence)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No health rules triggered. Continue the agreed project plan.</p>
            )}
            {project.health.level !== 'green' && (
              <Button
                disabled={
                  busy ||
                  state.workspace!.reports.some(
                    (r) => r.project_id === project.id && r.status === 'draft',
                  )
                }
                onClick={() => void run(() => state.draft(project.id))}
              >
                Create draft for {project.name}
              </Button>
            )}
            <Link className="text-link" to="/supervisor/milestones">
              Review milestone evidence
            </Link>
            {state
              .workspace!.reports.filter((r) => r.project_id === project.id)
              .map((report) => (
                <DraftReview key={report.id + ':' + report.version} report={report} />
              ))}
          </section>
        ))}
      </div>
    </>
  );
}
