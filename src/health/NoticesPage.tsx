import { readableCopy } from '../lib/readable-copy';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useHealth } from './HealthProvider';
import { Button, EmptyState, ErrorMessage, LoadingState, StatusBadge } from '../components/ui';
import './health.css';
export function NoticesPage() {
  const { user } = useAuth();
  const state = useHealth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function read(id: string) {
    setBusy(id);
    setError('');
    try {
      await state.read(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update notice.');
    } finally {
      setBusy(null);
    }
  }
  if (state.loading) return <LoadingState label="Loading approved notices…" />;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MESSAGES APPROVED BY YOUR SUPERVISOR</span>
          <h1>{user?.role === 'student' ? 'My notices' : 'Published health notices'}</h1>
          <p>Only approved health messages appear here.</p>
        </div>
        <Button variant="secondary" onClick={() => void state.refresh()}>
          Refresh notices
        </Button>
      </div>
      {(error || state.error) && <ErrorMessage message={error || state.error} />}
      {!state.workspace?.notices.length ? (
        <EmptyState
          title="No approved notices yet"
          description="Draft and rejected messages stay with your supervisor."
        />
      ) : (
        <div className="health-grid">
          {state.workspace.notices.map((notice) => (
            <article key={notice.id} className="panel phase-form health-notice">
              <div className="health-title">
                <h2>{state.workspace!.projects.find((p) => p.id === notice.project_id)?.name}</h2>
                <StatusBadge tone={notice.level}>{notice.level.toUpperCase()}</StatusBadge>
              </div>
              <p className="notice-body">{readableCopy(notice.body)}</p>
              <p className="form-hint">Published {new Date(notice.created_at).toLocaleString()}</p>
              {user?.role === 'student' &&
                (notice.read_by.includes(user.id) ? (
                  <StatusBadge tone="green">Read</StatusBadge>
                ) : (
                  <Button disabled={busy !== null} onClick={() => void read(notice.id)}>
                    Mark as read
                  </Button>
                ))}
            </article>
          ))}
        </div>
      )}
      <Link className="button button-secondary" to={'/' + user?.role + '/dashboard'}>
        Back to overview
      </Link>
    </>
  );
}
export function HealthDashboardSummary() {
  const { user } = useAuth();
  const { workspace, loading, error } = useHealth();
  return (
    <section className="panel phase-form health-summary">
      <div className="panel-heading">
        <h2>Project health and notices</h2>
        <Link
          className="text-link"
          to={'/' + user?.role + (user?.role === 'supervisor' ? '/health' : '/notices')}
        >
          View details
        </Link>
      </div>
      {loading ? (
        <p role="status">Loading project health…</p>
      ) : error ? (
        <p role="status">{error}</p>
      ) : (
        <>
          <div className="health-actions">
            {workspace?.projects.map((p) => (
              <StatusBadge key={p.id} tone={p.health.level}>
                {p.name}: {p.health.level.toUpperCase()}
              </StatusBadge>
            ))}
          </div>
          {workspace?.notices
            .slice(-3)
            .reverse()
            .map((n) => (
              <p key={n.id} className="notice-body">
                {readableCopy(n.body)}
                {user?.role === 'student' && !n.read_by.includes(user.id) && (
                  <strong> · Unread</strong>
                )}
              </p>
            ))}
          {!workspace?.notices.length && <p>No approved health messages yet.</p>}
        </>
      )}
    </section>
  );
}
