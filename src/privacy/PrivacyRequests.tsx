import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { privacyRequest } from './api';
import { Button, ErrorMessage, LoadingState } from '../components/ui';
type DataRequest = {
  id: string;
  kind: 'export' | 'correction' | 'deletion';
  detail: string;
  status: 'requested' | 'responded';
  response: string;
  version: number;
  created_at: string;
  requester_name: string;
};
function validRequests(value: unknown): value is DataRequest[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (r) =>
        r &&
        typeof r.id === 'string' &&
        ['export', 'correction', 'deletion'].includes(r.kind) &&
        ['requested', 'responded'].includes(r.status) &&
        typeof r.detail === 'string' &&
        typeof r.response === 'string' &&
        Number.isInteger(r.version) &&
        typeof r.requester_name === 'string' &&
        typeof r.created_at === 'string',
    )
  );
}
export function PrivacyRequests() {
  const { user } = useAuth();
  const actor = user?.id;
  const revision = useRef(0);
  const [rows, setRows] = useState<DataRequest[]>([]);
  const [kind, setKind] = useState('export');
  const [detail, setDetail] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const current = ++revision.current;
    setRows([]);
    setResponses({});
    setDetail('');
    setConfirm(false);
    setMessage('');
    setError('');
    if (!supabase || !actor) {
      setError('Data requests require the connected portal.');
      setBusy(false);
      return;
    }
    setBusy(true);
    void privacyRequest('fyp_privacy_requests', {}, actor, () => current === revision.current)
      .then((data) => {
        if (current !== revision.current) return;
        if (!validRequests(data)) throw Error('Data requests could not be loaded.');
        setRows(data);
      })
      .catch(() => {
        if (current === revision.current) setError('Data requests are temporarily unavailable.');
      })
      .finally(() => {
        if (current === revision.current) setBusy(false);
      });
    return () => {
      revision.current++;
    };
  }, [actor]);
  async function run(name: string, args: Record<string, unknown>, success: string) {
    if (!supabase || busy || !actor) return;
    const current = ++revision.current;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = await privacyRequest(name, args, actor, () => current === revision.current);
      if (current !== revision.current) return;
      if (!validRequests(data)) throw Error('The server did not return a valid request receipt.');
      setRows(data);
      setMessage(success);
      setDetail('');
      setConfirm(false);
      setResponses({});
    } catch (cause) {
      if (current === revision.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'The request could not be confirmed. Reload before retrying.',
        );
    } finally {
      if (current === revision.current) setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(
      'fyp_privacy_submit',
      { p_kind: kind, p_detail: detail.trim(), p_confirm: confirm },
      'Your request is saved for coordinator review. No records have been deleted.',
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR INFORMATION</span>
          <h1>Data requests</h1>
          <p>Request an export, correction or deletion review for your own account.</p>
        </div>
      </div>
      <section className="panel phase-form">
        <h2>Submit a request</h2>
        <p>
          Academic records can have retention requirements. Deletion is reviewed by the coordinator;
          this form does not erase records or send your information to AI.
        </p>
        <form onSubmit={submit}>
          <label>
            Request type
            <select value={kind} disabled={busy} onChange={(e) => setKind(e.target.value)}>
              <option value="export">Export my data</option>
              <option value="correction">Correct my data</option>
              <option value="deletion">Review deletion of my data</option>
            </select>
          </label>
          <label>
            Request details
            <textarea
              required
              minLength={10}
              maxLength={2000}
              value={detail}
              disabled={busy}
              onChange={(e) => setDetail(e.target.value)}
            />
          </label>
          <p className="form-hint">
            Describe the records involved. Do not include passwords, tokens or another person's
            private information.
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirm}
              disabled={busy}
              onChange={(e) => setConfirm(e.target.checked)}
            />{' '}
            I confirm this request concerns my own information and understand that retention
            requirements may apply.
          </label>
          <Button disabled={busy || !confirm || detail.trim().length < 10 || !supabase}>
            Save data request
          </Button>
        </form>
      </section>
      {error && <ErrorMessage message={error} />}
      {message && <p role="status">{message}</p>}
      {busy && <LoadingState label="Checking data requests…" />}
      <section className="panel phase-form">
        <h2>{user?.role === 'coordinator' ? 'Requests for review' : 'Your saved requests'}</h2>
        {!busy && !rows.length && <p>No requests are saved yet.</p>}
        {rows.map((row) => (
          <article key={row.id} className="engagement-card">
            <h3>
              {row.kind === 'deletion'
                ? 'Deletion review'
                : row.kind === 'correction'
                  ? 'Data correction'
                  : 'Data export'}{' '}
              · {row.status === 'requested' ? 'Awaiting review' : 'Response recorded'}
            </h3>
            <p>
              {row.requester_name} · {new Date(row.created_at).toLocaleString()}
            </p>
            <p>{row.detail}</p>
            {row.response && (
              <p>
                <strong>Coordinator response: </strong>
                {row.response}
              </p>
            )}
            {user?.role === 'coordinator' && row.status === 'requested' && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    'fyp_privacy_respond',
                    {
                      p_id: row.id,
                      p_expected_version: row.version,
                      p_response: responses[row.id]?.trim(),
                    },
                    'Coordinator response recorded. Record changes must be verified separately.',
                  );
                }}
              >
                <label>
                  Response for request {row.id}
                  <textarea
                    minLength={10}
                    maxLength={2000}
                    required
                    value={responses[row.id] || ''}
                    disabled={busy}
                    onChange={(e) => setResponses({ ...responses, [row.id]: e.target.value })}
                  />
                </label>
                <p className="form-hint">
                  Document the action taken, secure delivery route or retention reason. Recording a
                  response does not perform an export or delete an account.
                </p>
                <Button disabled={busy || (responses[row.id]?.trim().length || 0) < 10}>
                  Record response
                </Button>
              </form>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
