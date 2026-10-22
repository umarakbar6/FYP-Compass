import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { useEngagement } from './EngagementProvider';
import { Button, EmptyState, ErrorMessage } from '../components/ui';
import type { Reminder } from './api';
type Row = Reminder & { created_at: string };
export function ReminderPager({ enabled }: { enabled: boolean }) {
  const { user } = useAuth(),
    { action, workspace } = useEngagement(),
    owner = useRef(user?.id);
  owner.current = user?.id;
  const [rows, setRows] = useState<Row[]>([]),
    [total, setTotal] = useState(0),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function load(cursor?: Row) {
    if (!supabase) return;
    const actor = owner.current;
    setBusy(true);
    setError('');
    try {
      const { data, error } = await supabase.rpc('fyp_reminders_page', {
        p_before_time: cursor?.created_at || null,
        p_before_id: cursor?.id || null,
        p_limit: 25,
      });
      if (error || !Array.isArray(data?.rows)) throw Error('Unable to load reminder page.');
      if (owner.current === actor) {
        setRows(data.rows);
        setTotal(data.total);
        setMore(data.has_more);
      }
    } catch (cause) {
      if (owner.current === actor)
        setError(cause instanceof Error ? cause.message : 'Reminders unavailable.');
    } finally {
      if (owner.current === actor) setBusy(false);
    }
  }
  useEffect(() => {
    setRows([]);
    void load();
  }, [user?.id, enabled, workspace]);
  return (
    <div>
      {error && <ErrorMessage message={error} />}
      <p>{total} eligible reminders. This page loads up to 25.</p>
      {rows.map((row) => (
        <article className={`reminder-item ${row.read_at ? 'reminder-read' : ''}`} key={row.id}>
          <h3>{row.name}</h3>
          <p>
            {row.group_name} · due {new Date(row.deadline).toLocaleString()} ·{' '}
            {row.stage === 'overdue'
              ? 'Overdue'
              : row.stage === '24h'
                ? 'Due within 24 hours'
                : 'Due within 72 hours'}
          </p>
          <Link to={`/${user?.role}/milestones`}>Open milestones</Link>
          {!row.read_at && (
            <Button disabled={busy} onClick={() => void action('read_reminder', { id: row.id })}>
              Mark as read
            </Button>
          )}
        </article>
      ))}
      {!rows.length && !busy && (
        <EmptyState
          title={enabled ? 'No current deadline reminders' : 'Reminders are turned off'}
          description="Check your milestone list for the full schedule."
        />
      )}
      <Button disabled={busy} onClick={() => void load()}>
        Newest reminders
      </Button>
      <Button disabled={busy || !more} onClick={() => void load(rows.at(-1))}>
        Older reminders
      </Button>
    </div>
  );
}
