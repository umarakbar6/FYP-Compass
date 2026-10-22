import { useState } from 'react';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { Button, ErrorMessage, StatusBadge } from '../components/ui';
import { SIMILARITY_DISCLAIMER, SIMILARITY_THRESHOLD } from '../lib/similarity';
import { demoEnabled } from '../lib/supabase';
import type { SupervisedProposal } from '../types/supervisor';
import { useSupervisor } from './SupervisorProvider';
export function SimilarityPanel({ proposal }: { proposal: SupervisedProposal }) {
  const { screen } = useSupervisor();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const result = proposal.similarity;
  const flagged = result.status === 'flagged';
  async function rerun() {
    setBusy(true);
    setError('');
    try {
      await screen(proposal.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to screen this proposal.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={'panel similarity-panel ' + (flagged ? 'similarity-flagged' : '')}>
      <div className="similarity-heading">
        {flagged ? <ShieldAlert size={23} /> : <CheckCircle2 size={23} />}
        <div>
          <span className="eyebrow">INTERNAL SIMILARITY SCREENING</span>
          <h2>
            {flagged
              ? 'Requires closer review'
              : result.status === 'pending'
                ? 'Screening pending'
                : 'Screening result available'}
          </h2>
        </div>
      </div>
      <div className="similarity-score">
        {result.percentage === null ? '—' : result.percentage}
        <span>{result.percentage === null ? '' : '%'}</span>
        <StatusBadge tone={flagged ? 'amber' : 'neutral'}>
          {flagged ? 'Flagged' : result.status === 'pending' ? 'Pending' : 'Below flag threshold'}
        </StatusBadge>
      </div>
      {result.percentage !== null && (
        <div className="similarity-bar" aria-hidden="true">
          <span style={{ width: result.percentage + '%' }} />
        </div>
      )}
      <p className="form-hint">
        <strong>Closest stored proposal:</strong>{' '}
        {result.closest_title || 'No matching proposal available.'}
      </p>
      <p className="form-hint">
        Comparison text: proposal title and abstract. Flag threshold:{' '}
        {result.threshold ?? SIMILARITY_THRESHOLD}%.
      </p>
      {result.screened_at && (
        <p className="form-hint">Screened {new Date(result.screened_at).toLocaleString()}</p>
      )}
      {flagged && (
        <p className="flagged-guidance">
          Approval is allowed, but you must record why it is justified.
        </p>
      )}
      <p className="similarity-disclaimer">{SIMILARITY_DISCLAIMER}</p>
      {proposal.status === 'submitted' && (
        <Button variant="secondary" disabled={busy} onClick={() => void rerun()}>
          {busy ? 'Screening…' : 'Run similarity screening again'}
        </Button>
      )}
      {error && <ErrorMessage message={error} />}
      <small className="fixture-label">
        {demoEnabled
          ? 'Computed demo screening · stored demo proposal corpus.'
          : 'Screening runs on the server. The live integration requires verification.'}
      </small>
    </section>
  );
}
