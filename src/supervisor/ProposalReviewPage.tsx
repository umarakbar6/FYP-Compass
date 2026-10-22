import { DecisionAssistant } from '../operations/DecisionAssistant';
import { SimilarityPanel } from './SimilarityPanel';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { Button, DataTable, EmptyState, ErrorMessage, StatusBadge } from '../components/ui';
import { ProposalBadge } from '../student/common';
import { PrivateDocumentLink } from '../components/PrivateDocumentLink';
import { documentUrl } from '../lib/student-api';
import { demoEnabled } from '../lib/supabase';
import { useSupervisor } from './SupervisorProvider';
import { SupervisorGate, SupervisorDataMode, dateLabel } from './common';
import type { ReviewInput, SupervisedProposal } from '../types/supervisor';

export function ProposalReviewPage() {
  const { id } = useParams();
  const { workspace, loading, error } = useSupervisor();
  if (loading || error || !workspace) return <SupervisorGate />;
  const proposal = workspace.proposals.find((item) => item.id === id);
  if (!proposal)
    return (
      <section className="panel">
        <EmptyState
          title="Proposal unavailable"
          description="This proposal is not in your allocated groups."
          action={
            <Link className="button button-secondary" to="/supervisor/proposals">
              Back to proposal reviews
            </Link>
          }
        />
      </section>
    );
  return (
    <>
      <Link className="text-link back-to-reviews" to="/supervisor/proposals">
        <ArrowLeft size={16} />
        Back to proposal reviews
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{proposal.group_name.toUpperCase()} / PROPOSAL DETAIL</span>
          <h1>{proposal.title}</h1>
          <p>
            Submitted {dateLabel(proposal.submitted_at)} · {proposal.members.length} students
          </p>
        </div>
        <ProposalBadge status={proposal.status} />
      </div>
      <SupervisorDataMode />
      <div className="supervisor-detail-grid">
        <section className="panel phase-form">
          <span className="eyebrow">PROJECT PROPOSAL</span>
          <h2>Abstract and scope</h2>
          <p className="review-abstract">{proposal.abstract}</p>
          <h3 className="detail-subheading">Keywords</h3>
          <p className="review-body-text">
            {proposal.keywords.join(', ') || 'No keywords supplied.'}
          </p>
          <h3 className="detail-subheading">Controlled topics</h3>
          <div className="summary-tags">
            {proposal.topics.map((topic) => (
              <span key={topic}>{topic}</span>
            ))}
          </div>
          <h3 className="detail-subheading">Group members</h3>
          <ul className="review-members">
            {proposal.members.map((member) => (
              <li key={member.id}>{member.full_name}</li>
            ))}
          </ul>
          <ProposalDocument proposal={proposal} />
          {proposal.review && (
            <div className="review-record">
              <span className="eyebrow">RECORDED REVIEW</span>
              <ProposalBadge status={proposal.status} />
              <p>{proposal.review.comment || 'Approved without additional comments.'}</p>
              {proposal.review.justification && (
                <>
                  <strong>Reason for the flagged proposal</strong>
                  <p>{proposal.review.justification}</p>
                </>
              )}
              <small>Reviewed {dateLabel(proposal.review.reviewed_at)}</small>
            </div>
          )}
        </section>
        <aside>
          <SimilarityPanel proposal={proposal} />
          <DecisionAssistant projectId={proposal.group_id} kind="proposal" />
          {proposal.status === 'submitted' ? (
            <ReviewForm key={proposal.id} proposal={proposal} />
          ) : (
            <div className="panel phase-form review-state-note">
              <h2>
                {proposal.status === 'approved'
                  ? 'Proposal approved.'
                  : proposal.status === 'changes_requested'
                    ? 'Changes requested.'
                    : proposal.status === 'rejected'
                      ? 'Proposal rejected.'
                      : 'Review is unavailable.'}
              </h2>
              <p className="form-hint">
                {proposal.status === 'changes_requested'
                  ? 'Your feedback is recorded. A new review is available after the students revise and resubmit.'
                  : 'This decision has been saved. Submitted proposals are the only records that can receive a new review.'}
              </p>
            </div>
          )}
        </aside>
      </div>
      {proposal.project && <ProjectMilestones proposal={proposal} />}
    </>
  );
}
function ReviewForm({ proposal }: { proposal: SupervisedProposal }) {
  const { review } = useSupervisor();
  const [action, setAction] = useState<ReviewInput['action']>('approve');
  const [comment, setComment] = useState('');
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const needsJustification = action === 'approve' && proposal.similarity.status === 'flagged';
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await review(proposal.id, {
        action,
        comment,
        justification: needsJustification ? justification : '',
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save your decision.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel phase-form review-action-panel" onSubmit={submit}>
      <span className="eyebrow">YOUR REVIEW DECISION</span>
      <h2>Choose the next step</h2>
      <fieldset className="review-actions" disabled={busy}>
        <legend className="sr-only">Review action</legend>
        {[
          { value: 'approve', label: 'Approve' },
          { value: 'changes_requested', label: 'Request changes' },
          { value: 'reject', label: 'Reject' },
        ].map((item) => (
          <label key={item.value} className={action === item.value ? 'selected' : ''}>
            <input
              type="radio"
              name="review-action"
              value={item.value}
              checked={action === item.value}
              onChange={() => setAction(item.value as ReviewInput['action'])}
            />
            {item.label}
          </label>
        ))}
      </fieldset>
      <label htmlFor="review-comment">
        Review comments {action === 'approve' ? '(optional)' : '(required)'}
      </label>
      <textarea
        id="review-comment"
        rows={4}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        required={action !== 'approve'}
        disabled={busy}
        placeholder="Give clear, specific feedback to the team."
      />
      {needsJustification && (
        <>
          <label htmlFor="review-justification">Approval justification (required)</label>
          <textarea
            id="review-justification"
            rows={3}
            value={justification}
            onChange={(event) => setJustification(event.target.value)}
            required
            disabled={busy}
            placeholder="Explain why approval is appropriate despite the similarity flag."
          />
        </>
      )}
      <p className="form-hint">
        {action === 'approve'
          ? 'Approval creates the project record and its configured milestone plan.'
          : action === 'changes_requested'
            ? 'Students must revise and resubmit before you can review again.'
            : 'Rejection records your feedback and closes this proposal for review.'}
      </p>
      {error && <ErrorMessage message={error} />}
      <Button type="submit" disabled={busy}>
        {busy
          ? 'Saving decision…'
          : action === 'approve'
            ? 'Approve proposal'
            : action === 'changes_requested'
              ? 'Send change request'
              : 'Reject proposal'}
      </Button>
    </form>
  );
}
function ProposalDocument({ proposal }: { proposal: SupervisedProposal }) {
  return (
    <div className="saved-document">
      <FileText size={19} />
      <span>{proposal.document?.name || 'No optional document attached.'}</span>
      {proposal.document?.path && (
        <PrivateDocumentLink document={proposal.document} resolveUrl={documentUrl} />
      )}
    </div>
  );
}
function ProjectMilestones({ proposal }: { proposal: SupervisedProposal }) {
  const project = proposal.project!;
  return (
    <section className="panel supervisor-projects">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PROJECT CREATED AFTER APPROVAL</span>
          <h2>{project.title}</h2>
        </div>
        <StatusBadge tone="green">Project active</StatusBadge>
      </div>
      <div className="project-start-note">
        Started {dateLabel(project.started_at)} · {project.milestones.length} configured milestones{' '}
        {demoEnabled && '· sample demo template'}
      </div>
      {project.milestones.length ? (
        <DataTable
          caption="Project milestone plan"
          rows={project.milestones}
          rowKey={(item) => item.id}
          columns={[
            { key: 'name', label: 'Milestone', render: (item) => item.name },
            { key: 'deadline', label: 'Deadline', render: (item) => dateLabel(item.deadline) },
            {
              key: 'status',
              label: 'Workflow status',
              render: (item) => <StatusBadge>{item.status.replaceAll('_', ' ')}</StatusBadge>,
            },
          ]}
        />
      ) : (
        <EmptyState
          title="Milestone plan is not available yet"
          description="Ask the coordinator to check the configured session templates."
        />
      )}
    </section>
  );
}
