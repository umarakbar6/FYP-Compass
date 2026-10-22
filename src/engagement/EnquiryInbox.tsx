import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useEngagement } from './EngagementProvider';
import type { Enquiry } from './api';
import { Button, ErrorMessage, EmptyState } from '../components/ui';
export function EnquiryInbox() {
  const { action, error: actionError } = useEngagement();
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [rows, setRows] = useState<Enquiry[]>([]),
    [total, setTotal] = useState(0),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function load(cursor: Enquiry | null = null) {
    if (!supabase) return;
    setBusy(true);
    setError('');
    try {
      const { data, error } = await supabase.rpc('fyp_enquiries_page', {
        p_before_time: cursor?.created_at || null,
        p_before_id: cursor?.id || null,
        p_search: query.trim(),
        p_status: filter,
        p_limit: 20,
      });
      if (error || !Array.isArray(data?.rows)) throw Error('Could not load this enquiry page.');
      setRows(data.rows);
      setTotal(data.total);
      setMore(data.has_more);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inbox unavailable.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function update(row: Enquiry, status: string) {
    setBusy(true);
    try {
      await action('enquiry_status', { id: row.id, status, version: row.version });
      await load();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="engagement-page">
      <div className="engagement-heading">
        <div>
          <span className="eyebrow">CLIENT REQUESTS</span>
          <h1>Enquiry inbox</h1>
          <p>
            Private requests received from the website. Changing status does not send email or
            collect payment.
          </p>
        </div>
        <Button disabled={busy} onClick={() => void load()}>
          Refresh inbox
        </Button>
      </div>
      {(error || actionError) && <ErrorMessage message={error || actionError} />}
      <form
        className="engagement-card engagement-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          Search requests
          <input maxLength={200} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>
          Filter status
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {['all', 'new', 'contacted', 'in_progress', 'completed', 'spam'].map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={busy}>Search all requests</Button>
      </form>
      <p role="status">
        {busy
          ? 'Loading requests…'
          : total + ' matching requests. Showing ' + rows.length + ' on this page.'}
      </p>
      {rows.length
        ? rows.map((row) => (
            <article className="engagement-card" key={row.id}>
              <h2>{row.full_name}</h2>
              <a href={'mailto:' + encodeURIComponent(row.email)}>{row.email}</a>
              <p>{row.plan}</p>
              <p className="enquiry-brief">{row.brief}</p>
              <p>
                Reference: {row.id} · received {new Date(row.created_at).toLocaleString()}
              </p>
              <label>
                Request status
                <select
                  disabled={busy}
                  value={row.status}
                  onChange={(e) => void update(row, e.target.value)}
                >
                  {['new', 'contacted', 'in_progress', 'completed', 'spam'].map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
            </article>
          ))
        : !busy && (
            <EmptyState
              title="No matching enquiries"
              description="Search the complete inbox or change the status filter."
            />
          )}
      <div className="engagement-actions">
        <Button disabled={busy} onClick={() => void load()}>
          Newest page
        </Button>
        <Button disabled={busy || !more} onClick={() => void load(rows.at(-1) || null)}>
          Older requests
        </Button>
      </div>
      <p>
        Contact details are visible only to coordinators. Search covers the whole inbox, including
        older requests.
      </p>
    </div>
  );
}
