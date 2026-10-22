import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorMessage,
  LoadingState,
  StatusBadge,
} from '../components/ui';
import { useAuth } from '../auth/AuthProvider';
import { demoEnabled, supabase } from '../lib/supabase';
import { ModulePlaceholder } from './ModulePlaceholder';
import './partner.css';

type RecordRow = Record<string, unknown>;
export function isRecord(value: unknown): value is RecordRow {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
export function validateModuleData(value: unknown): RecordRow {
  if (!isRecord(value))
    throw new Error(
      'The server returned an invalid workspace. Refresh or contact the coordinator.',
    );
  for (const key of ['items', 'groups', 'sessions', 'capacities', 'health_results', 'drafts']) {
    if (
      value[key] !== undefined &&
      (!Array.isArray(value[key]) || !(value[key] as unknown[]).every(isRecord))
    )
      throw new Error('The server returned invalid ' + key.replaceAll('_', ' ') + ' records.');
  }
  for (const key of ['dashboard', 'accreditation'])
    if (value[key] !== undefined && value[key] !== null && !isRecord(value[key]))
      throw new Error('The server returned an invalid report.');
  return value;
}
function errorText(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : isRecord(cause) && typeof cause.message === 'string'
      ? cause.message
      : 'Unable to load this workspace. Please retry.';
}
function label(key: string) {
  return key.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function pretty(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  return /T\d\d:/.test(text) && Number.isFinite(Date.parse(text))
    ? new Date(text).toLocaleString()
    : text.replaceAll('_', ' ');
}
function rows(data: RecordRow | null, key: string): RecordRow[] {
  return Array.isArray(data?.[key]) ? (data[key] as RecordRow[]) : [];
}
function ModuleTable({
  items,
  caption = 'Workspace records',
}: {
  items: RecordRow[];
  caption?: string;
}) {
  const keys = useMemo(() => {
    const preferred = [
      'group_name',
      'title',
      'status',
      'health_status',
      'defense_type',
      'scheduled_at',
      'location',
      'type',
      'created_at',
      'supervisor_name',
      'allocated',
      'max_groups',
      'academic_year',
      'is_active',
    ];
    const all = Array.from(new Set(items.flatMap((item) => Object.keys(item))));
    return [
      ...preferred.filter((key) => all.includes(key)),
      ...all.filter(
        (key) =>
          !preferred.includes(key) &&
          !['id', 'group_id', 'proposal_id', 'supervisor_id', 'session_id'].includes(key),
      ),
    ].slice(0, 12);
  }, [items]);
  if (!items.length)
    return (
      <EmptyState title="No records yet" description="No records were returned for your account." />
    );
  return (
    <DataTable<RecordRow>
      rows={items}
      rowKey={(row) =>
        String(row.id || row.proposal_id || row.supervisor_id || JSON.stringify(row))
      }
      caption={caption}
      columns={keys.map((key) => ({ key, label: label(key), render: (row) => pretty(row[key]) }))}
    />
  );
}
function ReportView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (depth > 5) return <p>{pretty(value)}</p>;
  if (Array.isArray(value))
    return value.every(isRecord) ? (
      <ModuleTable items={value} />
    ) : (
      <ul>
        {value.map((item, i) => (
          <li key={i}>{pretty(item)}</li>
        ))}
      </ul>
    );
  if (!isRecord(value)) return <p>{pretty(value)}</p>;
  const entries = Object.entries(value);
  if (!entries.length)
    return (
      <EmptyState
        title="No report data yet"
        description="The report will appear when session records are available."
      />
    );
  return (
    <div className="partner-report">
      {entries.map(([key, item]) =>
        isRecord(item) || Array.isArray(item) ? (
          <section key={key}>
            <h3>{label(key)}</h3>
            <ReportView value={item} depth={depth + 1} />
          </section>
        ) : (
          <dl key={key}>
            <dt>{label(key)}</dt>
            <dd>{pretty(item)}</dd>
          </dl>
        ),
      )}
    </div>
  );
}
export function ConnectedModule({ moduleOverride }: { moduleOverride?: string }) {
  const { user } = useAuth();
  const location = useLocation();
  const module = moduleOverride || location.pathname.split('/').pop() || '';
  const scope = (user?.id || '') + ':' + (user?.role || '') + ':' + module;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const request = useRef(0);
  const mounted = useRef(true);
  const [state, setState] = useState<{
    scope: string;
    data: RecordRow | null;
    loading: boolean;
    error: string;
  }>({ scope, data: null, loading: true, error: '' });
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  async function load(expectedScope = scope) {
    if (!supabase || !user || demoEnabled || currentScope.current !== expectedScope) return;
    const revision = ++request.current;
    setState({ scope: expectedScope, data: null, loading: true, error: '' });
    try {
      const result = await supabase.rpc('fyp_role_module_data', { p_module: module });
      if (result.error) throw result.error;
      const data = validateModuleData(result.data);
      if (mounted.current && revision === request.current && currentScope.current === expectedScope)
        setState({ scope: expectedScope, data, loading: false, error: '' });
    } catch (cause) {
      if (mounted.current && revision === request.current && currentScope.current === expectedScope)
        setState({ scope: expectedScope, data: null, loading: false, error: errorText(cause) });
    }
  }
  useEffect(() => {
    actionLock.current = false;
    setBusy(false);
    void load();
    return () => {
      request.current++;
    };
  }, [scope]);
  async function action(name: string, args: RecordRow) {
    if (!supabase || !user || actionLock.current) return;
    const expectedScope = scope;
    actionLock.current = true;
    setBusy(true);
    try {
      const result = await supabase.rpc(name, args);
      if (result.error) throw result.error;
      if (mounted.current && currentScope.current === expectedScope) await load(expectedScope);
    } catch (cause) {
      if (mounted.current && currentScope.current === expectedScope)
        setState((previous) => ({ ...previous, error: errorText(cause) }));
    } finally {
      if (mounted.current && currentScope.current === expectedScope) {
        actionLock.current = false;
        setBusy(false);
      }
    }
  }
  if (!user) return null;
  if (demoEnabled || !supabase) return <ModulePlaceholder />;
  if (state.scope !== scope || state.loading)
    return <LoadingState label={'Loading ' + module + '…'} />;
  const data = state.data;
  const items = rows(data, 'items');
  const title = moduleOverride
    ? user.role === 'coordinator'
      ? 'Coordinator overview'
      : 'Examiner overview'
    : label(module);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{user.role.toUpperCase()} WORKSPACE</span>
          <h1>{title}</h1>
          <p>Current records available to your account.</p>
        </div>
        <StatusBadge tone={data ? 'green' : 'amber'}>{data ? 'Loaded' : 'Unavailable'}</StatusBadge>
      </div>
      {state.error && <ErrorMessage message={state.error} />}
      <div className="partner-actions">
        <Button variant="secondary" disabled={busy} onClick={() => void load()}>
          Refresh records
        </Button>
        {module === 'reports' && data && user.role === 'coordinator' && (
          <Button onClick={() => window.print()}>Print accreditation report</Button>
        )}
      </div>
      {data &&
        (module === 'matching' ? (
          <section className="panel">
            <h2>Submitted proposals</h2>
            {items.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Proposal</th>
                      <th>Status</th>
                      <th>Supervisor</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row, i) => (
                      <tr key={String(row.proposal_id || i)}>
                        <td>{pretty(row.group_name)}</td>
                        <td>{pretty(row.title)}</td>
                        <td>{pretty(row.status)}</td>
                        <td>{pretty(row.supervisor_name)}</td>
                        <td>
                          {row.allocated ? (
                            <StatusBadge tone="green">Allocated</StatusBadge>
                          ) : user.role === 'coordinator' &&
                            typeof row.proposal_id === 'string' &&
                            row.proposal_id ? (
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void action('fyp_auto_allocate', { p_proposal_id: row.proposal_id })
                              }
                            >
                              Auto allocate
                            </Button>
                          ) : (
                            <span>Unavailable</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="No proposals waiting"
                description="Submitted proposals will appear here for matching."
              />
            )}
          </section>
        ) : module === 'configuration' ? (
          <div className="dashboard-columns">
            <section className="panel">
              <h2>Sessions</h2>
              <ModuleTable items={rows(data, 'sessions')} />
            </section>
            <section className="panel">
              <h2>Supervisor capacity</h2>
              <ModuleTable items={rows(data, 'capacities')} />
            </section>
          </div>
        ) : module === 'reports' ? (
          <>
            <section className="panel partner-dashboard">
              <h2>Session dashboard</h2>
              <ReportView value={data.dashboard} />
            </section>
            <section className="panel print-report">
              <h2>FYP Compass · Accreditation report</h2>
              <p>Generated from current session records · {new Date().toLocaleDateString()}</p>
              <ReportView value={data.accreditation} />
            </section>
          </>
        ) : module === 'health' ? (
          <>
            <section className="panel">
              <h2>Group health snapshots</h2>
              <ModuleTable items={rows(data, 'health_results')} />
            </section>
            <section className="panel">
              <h2>Health evidence</h2>
              <ModuleTable items={items} />
            </section>
          </>
        ) : module === 'notices' ? (
          <>
            <section className="panel">
              <h2>Published notifications</h2>
              {items.length ? (
                items.map((row, i) => (
                  <article className="partner-notice" key={String(row.id || i)}>
                    <h3>{pretty(row.title)}</h3>
                    <p>{pretty(row.body)}</p>
                    <p>{pretty(row.created_at)}</p>
                    {row.read_at ? (
                      <StatusBadge tone="green">Read</StatusBadge>
                    ) : typeof row.id === 'string' && row.id ? (
                      <Button
                        disabled={busy}
                        onClick={() => void action('fyp_mark_notice_read', { p_notice_id: row.id })}
                      >
                        Mark read
                      </Button>
                    ) : null}
                  </article>
                ))
              ) : (
                <EmptyState
                  title="No notices yet"
                  description="Published notices for your account will appear here."
                />
              )}
            </section>
            {user.role === 'coordinator' && (
              <section className="panel">
                <h2>Health message drafts</h2>
                <p>Health messages are reviewed by the assigned supervisor before publication.</p>
                <ModuleTable items={rows(data, 'drafts')} />
              </section>
            )}
          </>
        ) : (
          <section className="panel">
            <h2>{moduleOverride ? 'Assigned defenses' : title}</h2>
            <ModuleTable items={items} />
          </section>
        ))}
    </>
  );
}
