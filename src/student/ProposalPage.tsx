import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileText } from 'lucide-react';
import { useStudent } from './StudentProvider';
import { WorkspaceGate, DataMode, ProposalBadge } from './common';
import { Button, EmptyState, ErrorMessage, FileUploader } from '../components/ui';
import { PrivateDocumentLink } from '../components/PrivateDocumentLink';
import { canEditProposal, documentUrl } from '../lib/student-api';
import { demoEnabled } from '../lib/supabase';
import type { ProposalInput, StudentWorkspace } from '../types/student';
export function ProposalPage() {
  const { workspace, loading, error } = useStudent();
  if (loading || error || !workspace) return <WorkspaceGate />;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">STUDENT / PROJECT PROPOSAL</span>
          <h1>Give your idea a direction.</h1>
          <p>Define your project, choose its topics, and rank your supervisors.</p>
          {!demoEnabled && (
            <p>
              Submit your own work here. Your proposal is saved privately in your project group and
              routed through coordinator matching for supervisor review.
            </p>
          )}
        </div>
        {workspace.proposal && <ProposalBadge status={workspace.proposal.status} />}
      </div>
      <DataMode />
      {!workspace.group ? (
        <section className="panel">
          <EmptyState
            title="Create your group first"
            description="Your proposal belongs to your project group. You can also create a group with just yourself."
            action={
              <Link className="button button-primary" to="/student/group">
                Create your group
                <ArrowRight size={17} />
              </Link>
            }
          />
        </section>
      ) : canEditProposal(workspace.proposal) ? (
        <ProposalForm key={workspace.group.id} workspace={workspace} />
      ) : (
        <ProposalSummary workspace={workspace} />
      )}
    </>
  );
}
function ProposalForm({ workspace }: { workspace: StudentWorkspace }) {
  const { save } = useStudent();
  const proposal = workspace.proposal;
  const [title, setTitle] = useState(proposal?.title || '');
  const [abstract, setAbstract] = useState(proposal?.abstract || '');
  const [keywords, setKeywords] = useState(proposal?.keywords.join(', ') || '');
  const [topics, setTopics] = useState<string[]>(proposal?.topic_ids || []);
  const [preferences, setPreferences] = useState<string[]>(
    proposal?.supervisor_ids || ['', '', ''],
  );
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function persist(submit: boolean) {
    setBusy(true);
    setError('');
    setSuccess('');
    const input: ProposalInput = {
      title,
      abstract,
      keywords: [
        ...new Set(
          keywords
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ],
      topic_ids: topics,
      supervisor_ids: preferences,
    };
    try {
      await save(input, file, submit);
      setFile(null);
      setSuccess(
        submit ? 'Proposal submitted.' : 'Draft saved. You can return and finish it later.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your proposal.');
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void persist(true);
  }
  return (
    <form className="phase-columns proposal-columns" onSubmit={submit}>
      <section className="panel phase-form">
        <span className="eyebrow">{workspace.group!.name.toUpperCase()}</span>
        <h2>Project details</h2>
        {proposal?.feedback && (
          <div className="feedback-box">
            <strong>Supervisor feedback</strong>
            <p>{proposal.feedback}</p>
          </div>
        )}
        <label htmlFor="proposal-title">Project title</label>
        <input
          id="proposal-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What are you building?"
          required
          disabled={busy}
          maxLength={250}
        />
        <label htmlFor="proposal-abstract">Abstract</label>
        <textarea
          id="proposal-abstract"
          value={abstract}
          onChange={(event) => setAbstract(event.target.value)}
          placeholder="Describe the problem, your approach, and the expected outcome."
          required
          disabled={busy}
          rows={7}
          maxLength={10000}
        />
        <label htmlFor="proposal-keywords">Keywords</label>
        <input
          id="proposal-keywords"
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
          placeholder="e.g. supervision, project tracking, web portal"
          required
          disabled={busy}
          maxLength={2000}
        />
        <p className="form-hint">Separate keywords with commas.</p>
        <div className="selection-heading">
          <strong>Controlled topic tags</strong>
          <span>{topics.length} / 3 selected</span>
        </div>
        <div className="topic-choices">
          {workspace.topics.map((topic) => (
            <label
              key={topic.id}
              className={`topic-choice ${topics.includes(topic.id) ? 'selected' : ''}`}
            >
              <input
                type="checkbox"
                checked={topics.includes(topic.id)}
                disabled={busy || (!topics.includes(topic.id) && topics.length === 3)}
                onChange={(event) =>
                  setTopics(
                    event.target.checked
                      ? [...topics, topic.id]
                      : topics.filter((id) => id !== topic.id),
                  )
                }
              />
              {topic.name}
            </label>
          ))}
        </div>
        <p className="form-hint">Choose up to three topics from the coordinator’s list.</p>
        <label className="document-label">
          Proposal document <span>Optional</span>
        </label>
        <FileUploader onSelect={setFile} disabled={busy} />
        {proposal?.document && !file && (
          <p className="form-hint">Saved document: {proposal.document.name}</p>
        )}
        <p className="form-hint">
          {demoEnabled
            ? 'Demo stores file details only; actual uploads are available with Supabase Storage.'
            : 'PDF or DOCX · maximum 10 MB · private storage with content verification.'}
        </p>
      </section>
      <aside className="panel phase-form preference-panel">
        <span className="eyebrow">SUPERVISOR PREFERENCES</span>
        <h2>Your ranked choices</h2>
        <p className="form-hint">
          Select three different supervisors. Your partner’s matching module determines the final
          allocation.
        </p>
        {['First choice', 'Second choice', 'Third choice'].map((label, index) => (
          <div className="preference-field" key={label}>
            <label htmlFor={`preference-${index}`}>
              <span className="rank-number">0{index + 1}</span>
              {label}
            </label>
            <select
              id={`preference-${index}`}
              value={preferences[index] || ''}
              required
              disabled={busy}
              onChange={(event) =>
                setPreferences(
                  preferences.map((id, rank) => (rank === index ? event.target.value : id)),
                )
              }
            >
              <option value="">Choose a supervisor</option>
              {workspace.supervisors.map((supervisor) => (
                <option
                  key={supervisor.id}
                  value={supervisor.id}
                  disabled={preferences.some((id, rank) => rank !== index && id === supervisor.id)}
                >
                  {supervisor.full_name}
                </option>
              ))}
            </select>
            {preferences[index] && (
              <p className="form-hint">
                {workspace.supervisors
                  .find((supervisor) => supervisor.id === preferences[index])
                  ?.topics.join(' · ')}
              </p>
            )}
          </div>
        ))}
        {workspace.supervisors.length < 3 && (
          <ErrorMessage message="The coordinator must configure at least three supervisors before submission." />
        )}
        <div className="proposal-submit-note">
          <FileText size={20} />
          <p>
            Once submitted, your proposal stays locked until a supervisor requests changes or closes
            it.
          </p>
        </div>
        {error && <ErrorMessage message={error} />}
        {success && (
          <p className="success-message" role="status">
            {success}
          </p>
        )}
        <div className="proposal-actions">
          <Button
            variant="secondary"
            type="button"
            disabled={busy}
            onClick={() => void persist(false)}
          >
            Save draft
          </Button>
          <Button type="submit" disabled={busy || workspace.supervisors.length < 3}>
            {busy ? 'Saving…' : 'Submit proposal'}
            <ArrowRight size={16} />
          </Button>
        </div>
      </aside>
    </form>
  );
}
export function AllocationView({ workspace }: { workspace: StudentWorkspace }) {
  const allocation = workspace.allocation;
  const { refresh } = useStudent();
  return (
    <div className="allocation-box">
      <span className="eyebrow">SUPERVISOR ALLOCATION</span>
      <h3>{allocation ? allocation.supervisor_name : 'Awaiting supervisor matching'}</h3>
      <p>
        {allocation
          ? allocation.explanation
          : 'Your ranked preferences will be used by the coordinator’s matching module. No supervisor has been allocated yet.'}
      </p>
      {allocation?.preference_rank && (
        <span>Allocated preference: choice {allocation.preference_rank}</span>
      )}
      {workspace.proposal && (
        <div style={{ marginTop: 14 }}>
          <Button type="button" variant="secondary" onClick={() => void refresh()}>
            Check allocation
          </Button>
        </div>
      )}
    </div>
  );
}
function ProposalSummary({ workspace }: { workspace: StudentWorkspace }) {
  const proposal = workspace.proposal!;
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{workspace.group!.name.toUpperCase()}</span>
          <h2>{proposal.title}</h2>
        </div>
        <ProposalBadge status={proposal.status} />
      </div>
      <div className="proposal-summary">
        <p className="success-message" role="status">
          {proposal.status === 'approved'
            ? 'Your proposal has been approved.'
            : 'Your proposal has been submitted and saved.'}
        </p>
        {proposal.feedback && (
          <div className="feedback-box">
            <strong>Supervisor feedback</strong>
            <p>{proposal.feedback}</p>
          </div>
        )}
        <h3>Abstract</h3>
        <p className="abstract-text">{proposal.abstract}</p>
        <h3>Keywords</h3>
        <p>{proposal.keywords.join(', ')}</p>
        <h3>Topic tags</h3>
        <div className="summary-tags">
          {proposal.topic_ids.length ? (
            proposal.topic_ids.map((id) => (
              <span key={id}>{workspace.topics.find((topic) => topic.id === id)?.name || id}</span>
            ))
          ) : (
            <p>No topic tags selected.</p>
          )}
        </div>
        <h3>Ranked supervisor preferences</h3>
        <ol className="ranked-summary">
          {proposal.supervisor_ids.map((id, index) => (
            <li key={index}>
              <span className="rank-number">0{index + 1}</span>
              {workspace.supervisors.find((supervisor) => supervisor.id === id)?.full_name ||
                'Unavailable supervisor'}
            </li>
          ))}
        </ol>
        {proposal.document && (
          <div className="saved-document">
            <FileText size={20} />
            <span>
              {proposal.document.name} · {(proposal.document.size / 1024).toFixed(1)} KB
            </span>
            {proposal.document.path ? (
              <PrivateDocumentLink document={proposal.document} resolveUrl={documentUrl} />
            ) : (
              <small>Demo file details only</small>
            )}
          </div>
        )}
        <AllocationView workspace={workspace} />
      </div>
    </section>
  );
}
