import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { Button, ErrorMessage } from '../components/ui';
import { ReportsPage as DemoReports } from '../core/CorePages';
type Row = {
  id: string;
  name: string;
  title: string | null;
  proposal_status: string | null;
  supervisor: string | null;
  milestones: number;
  accepted: number;
};
type Page = {
  session_id: string | null;
  sessions: { id: string; name: string }[];
  rows: Row[];
  total: number;
  has_more: boolean;
  sql_totals: Record<string, number>;
};
export function ReportExplorer() {
  return supabase ? <ConnectedReport /> : <DemoReports />;
}
function ConnectedReport() {
  const { user } = useAuth(),
    actor = useRef(user?.id);
  actor.current = user?.id;
  const [page, setPage] = useState<Page | null>(null),
    [session, setSession] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function load(chosen = session, after: string | null = null) {
    if (!supabase) return;
    const owner = actor.current;
    setBusy(true);
    setError('');
    try {
      const { data, error } = await supabase.rpc('fyp_reports_page', {
        p_session_id: chosen || null,
        p_after_id: after,
        p_limit: 20,
      });
      if (error || !Array.isArray(data?.rows)) throw Error('Unable to load the report page.');
      if (actor.current === owner) {
        setPage(data);
        setSession(data.session_id || '');
      }
    } catch (cause) {
      if (actor.current === owner)
        setError(cause instanceof Error ? cause.message : 'Report unavailable.');
    } finally {
      if (actor.current === owner) setBusy(false);
    }
  }
  useEffect(() => {
    setPage(null);
    void load('', null);
  }, [user?.id]);
  async function exportFull() {
    if (!supabase) return;
    setBusy(true);
    setError('');
    try {
      const { data, error } = await supabase.rpc('fyp_v2_core_accreditation');
      if (error || !data) throw Error('Unable to export accreditation evidence.');
      const blob = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = blob;
      a.download = 'fyp-compass-private-accreditation.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(blob), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export unavailable.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="engagement-page">
      <h1>Accreditation report</h1>
      <p>Session totals come directly from SQL. Project records load twenty at a time.</p>
      {error && <ErrorMessage message={error} />}
      <label>
        Academic session
        <select
          value={session}
          disabled={busy}
          onChange={(e) => {
            setSession(e.target.value);
            void load(e.target.value);
          }}
        >
          {page?.sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="engagement-grid">
        {Object.entries(page?.sql_totals || {}).map(([key, value]) => (
          <section className="engagement-card" key={key}>
            <h2>{key.replaceAll('_', ' ')}</h2>
            <strong>{value}</strong>
          </section>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <caption>Project records: {page?.total || 0} in this session</caption>
          <thead>
            <tr>
              <th>Group</th>
              <th>Proposal</th>
              <th>Supervisor</th>
              <th>Accepted milestones</th>
            </tr>
          </thead>
          <tbody>
            {page?.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>
                  {row.title || 'No proposal'} ({row.proposal_status || 'not submitted'})
                </td>
                <td>{row.supervisor || 'Unallocated'}</td>
                <td>
                  {row.accepted} / {row.milestones}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button disabled={busy} onClick={() => void load()}>
        First page
      </Button>
      <Button
        disabled={busy || !page?.has_more}
        onClick={() => void load(session, page?.rows.at(-1)?.id)}
      >
        Next page
      </Button>
      <Button disabled={busy} onClick={() => window.print()}>
        Print this page
      </Button>
      <Button disabled={busy || !page} onClick={() => void exportFull()}>
        Download private full evidence
      </Button>
      <p>
        The full export contains private academic records. Share it only with authorized reviewers.
      </p>
    </div>
  );
}
