import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Users, Check } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { useStudent } from './StudentProvider';
import { WorkspaceGate, DataMode } from './common';
import { Button, ErrorMessage, StatusBadge, DataTable } from '../components/ui';
export function GroupPage() {
  const { user } = useAuth();
  const { workspace, loading, error: loadError, create } = useStudent();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (loading || loadError || !workspace || !user) return <WorkspaceGate />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await create(name, selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create your group.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">STUDENT / TEAM FORMATION</span>
          <h1>Build your project team.</h1>
          <p>One shared idea. One to three students. A strong start.</p>
        </div>
        <StatusBadge>Phase 2</StatusBadge>
      </div>
      <DataMode />
      {workspace.group ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">YOUR ACTIVE GROUP</span>
              <h2>{workspace.group.name}</h2>
            </div>
            <StatusBadge tone="green">{workspace.group.members.length} / 3 members</StatusBadge>
          </div>
          <DataTable
            caption="Group members"
            rows={workspace.group.members}
            rowKey={(member) => member.id}
            columns={[
              { key: 'name', label: 'Student', render: (member) => member.full_name },
              {
                key: 'membership',
                label: 'Membership',
                render: (member) => (member.id === user.id ? 'You · group member' : 'Group member'),
              },
            ]}
          />
          <div className="form-footer">
            <p>You already have an active group for this session.</p>
            <Link className="button button-primary" to="/student/proposal">
              Prepare your proposal
              <ArrowRight size={17} />
            </Link>
          </div>
        </section>
      ) : (
        <div className="phase-columns">
          <form className="panel phase-form" onSubmit={submit}>
            <span className="eyebrow">TEAM DETAILS</span>
            <h2>Create your group</h2>
            <p className="form-hint">{workspace.session?.name || 'No active session configured'}</p>
            <label htmlFor="group-name">Group name</label>
            <input
              id="group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Team Compass"
              required
              maxLength={100}
              disabled={busy}
            />
            <div className="selection-heading">
              <strong>Choose your teammates</strong>
              <StatusBadge>{selected.length + 1} / 3 members</StatusBadge>
            </div>
            <div className="member-choice fixed-member">
              <Users size={19} />
              <div>
                <strong>{user.full_name}</strong>
                <small>You are included automatically</small>
              </div>
              <Check size={18} />
            </div>
            {workspace.eligible_members.map((member) => (
              <label className="member-choice" key={member.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(member.id)}
                  disabled={busy || (!selected.includes(member.id) && selected.length === 2)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, member.id]
                        : selected.filter((id) => id !== member.id),
                    )
                  }
                />
                <div>
                  <strong>{member.full_name}</strong>
                  <small>Available for this session</small>
                </div>
              </label>
            ))}
            <p className="form-hint">
              {selected.length === 2
                ? 'Your group is full. A fourth member cannot be added.'
                : 'You can work alone or select up to two teammates.'}
            </p>
            {error && <ErrorMessage message={error} />}
            <Button type="submit" disabled={busy || !workspace.session}>
              {busy ? 'Creating group…' : 'Create group'}
              <ArrowRight size={17} />
            </Button>
          </form>
          <aside className="panel phase-guide">
            <span className="eyebrow">TEAM CHECKLIST</span>
            <h2>Start on solid ground.</h2>
            <ol>
              <li>You can belong to one active group.</li>
              <li>Each group contains one to three students.</li>
              <li>Only available students can be selected.</li>
              <li>Your group submits one active proposal.</li>
            </ol>
            <div className="guide-accent">Next: define your idea and rank three supervisors.</div>
          </aside>
        </div>
      )}
    </>
  );
}
