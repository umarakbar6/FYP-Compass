import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useWorkspace } from '../lib/use-workspace';
import { Button, EmptyState, ErrorMessage, LoadingState, StatusBadge } from '../components/ui';
import {
  loadPeerWorkspace,
  savePeerRating,
  setPeersDue,
  saveContributionPercent,
  type PeerWorkspace,
} from './api';
import './peer.css';
export function PeerPage() {
  const { user } = useAuth();
  const state = useWorkspace(user, loadPeerWorkspace, 'Unable to load peer workspace.');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const scope = useRef(user?.id);
  scope.current = user?.id;
  useEffect(() => {
    lock.current = false;
    setBusy(false);
    setError('');
  }, [user?.id]);
  async function run(operation: () => Promise<PeerWorkspace>) {
    if (lock.current) return;
    const account = user?.id;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await state.mutate(operation);
    } catch (e) {
      if (scope.current === account) setError(e instanceof Error ? e.message : 'Update failed.');
    } finally {
      if (scope.current === account) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  if (!user) return null;
  return (
    <div className="peer-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">GROUP CONTRIBUTIONS</span>
          <h1>{user.role === 'student' ? 'Peer ratings' : 'Peer evidence'}</h1>
          <p>
            {user.role === 'student'
              ? 'Rate each teammate once. Submitted ratings are confidential and cannot be edited.'
              : 'Open peer submissions and record your contribution assessment for health checks.'}
          </p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => void state.refresh()}>
          Refresh
        </Button>
      </div>
      {(error || state.error) && <ErrorMessage message={error || state.error} />}{' '}
      {state.loading ? (
        <LoadingState />
      ) : state.workspace?.projects.length ? (
        state.workspace.projects.map((p) => (
          <section className="peer-card" key={p.id}>
            <h2>{p.title}</h2>
            <StatusBadge tone={p.peers_required ? 'amber' : 'neutral'}>
              {p.peers_required ? 'Peer ratings open' : 'Peer ratings closed'}
            </StatusBadge>
            {user.role === 'supervisor' ? (
              <>
                <Button
                  disabled={busy}
                  onClick={() => void run(() => setPeersDue(user, p.id, !p.peers_required))}
                >
                  {p.peers_required ? 'Close peer submissions' : 'Open peer submissions'}
                </Button>
                {p.members.map((m) => (
                  <form
                    key={m.id}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const value = Number(new FormData(e.currentTarget).get('percent'));
                      void run(() => saveContributionPercent(user, p.id, m.id, value));
                    }}
                  >
                    <label>
                      {m.full_name}: contribution percentage
                      <input
                        name="percent"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        required
                        defaultValue={
                          p.contribution_percents.find((c) => c.student_id === m.id)?.percent ?? ''
                        }
                      />
                    </label>
                    <Button disabled={busy} type="submit">
                      Save assessment
                    </Button>
                  </form>
                ))}
              </>
            ) : p.members.filter((m) => m.id !== user.id).length ? (
              p.members
                .filter((m) => m.id !== user.id)
                .map((m) => {
                  const saved = p.my_ratings.find((r) => r.evaluated === m.id);
                  return (
                    <form
                      key={m.id}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const value = Number(new FormData(e.currentTarget).get('rating'));
                        void run(() => savePeerRating(user, p.id, m.id, value));
                      }}
                    >
                      <label>
                        {m.full_name}
                        <select
                          aria-label={'Rating for ' + m.full_name}
                          name="rating"
                          required
                          disabled={busy || !!saved || !p.peers_required}
                          defaultValue={saved?.rating ?? ''}
                        >
                          <option value="" disabled>
                            Choose rating
                          </option>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n} / 5
                            </option>
                          ))}
                        </select>
                      </label>
                      {saved ? (
                        <StatusBadge tone="green">Submitted: {saved.rating}/5</StatusBadge>
                      ) : (
                        <Button type="submit" disabled={busy || !p.peers_required}>
                          Submit confidential rating
                        </Button>
                      )}
                    </form>
                  );
                })
            ) : (
              <p>Your group has one member; there are no teammates to rate.</p>
            )}
          </section>
        ))
      ) : (
        <EmptyState
          title="No approved project yet"
          description="Peer evidence becomes available after your proposal is approved and project milestones are created."
        />
      )}
    </div>
  );
}
