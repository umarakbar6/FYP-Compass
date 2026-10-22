import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { calculateHealth } from '../../src/health/rules.ts';
const ids = {
  supervisor: '00000000-0000-4000-8000-000000000001',
  other: '00000000-0000-4000-8000-000000000002',
  student: '00000000-0000-4000-8000-000000000101',
  second: '00000000-0000-4000-8000-000000000102',
  third: '00000000-0000-4000-8000-000000000103',
  outsider: '00000000-0000-4000-8000-000000000104',
  coordinator: '00000000-0000-4000-8000-000000000201',
  examiner: '00000000-0000-4000-8000-000000000301',
};
let db;
const text = {
  explanation: 'Outstanding project evidence needs attention.',
  action: 'Arrange a supervisor meeting.',
  message: 'Please meet your supervisor and agree the next steps.',
};
function project(offset = -10) {
  return {
    id: 'project-one',
    group_name: 'Group One',
    title: 'FYP Compass',
    supervisor_id: ids.supervisor,
    members: [
      { id: ids.student, full_name: 'One' },
      { id: ids.second, full_name: 'Two' },
      { id: ids.third, full_name: 'Three' },
    ],
    milestones: [
      {
        id: 'milestone-one',
        name: 'Report',
        description: 'Report evidence',
        deadline: new Date(Date.now() + offset * 86400000).toISOString(),
        status: 'not_started',
        submissions: [],
      },
    ],
  };
}
async function actor(id, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('test.actor',$1,false)", [id || '']);
  await db.exec('set role ' + role);
}
async function fixture(p) {
  await db.exec('reset role');
  await db.query(
    'insert into public.test_projects values($1,$2::jsonb) on conflict(id) do update set data=excluded.data',
    [p.id, JSON.stringify(p)],
  );
}
async function rpc(name, args = []) {
  const params = args.map((_, i) => '$' + (i + 1)).join(',');
  return (
    await db.query(
      'select public.' + name + '(' + params + ') as value',
      args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)),
    )
  ).rows[0].value;
}
async function draft() {
  const snap = await rpc('prepare_group_health_draft', ['project-one']);
  const health = calculateHealth(snap.project, snap.input);
  return rpc('save_group_health_draft', ['project-one', snap.version, health, text, 'fallback']);
}
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
  grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
  create table public.fyp_profiles(id uuid primary key,role text,full_name text);
  create table public.test_projects(id text primary key,data jsonb);
  create function public.get_milestone_workspace() returns jsonb language plpgsql security definer set search_path='' as $$declare r text;begin
    select role into r from public.fyp_profiles where id=auth.uid();
    if r not in ('student','supervisor') or r is null then raise exception 'Denied' using errcode='42501';end if;
    return jsonb_build_object('actor_id',auth.uid(),'projects',(select coalesce(jsonb_agg(data order by id),'[]') from public.test_projects where (r='supervisor' and data->>'supervisor_id'=auth.uid()::text) or (r='student' and exists(select 1 from jsonb_array_elements(data->'members') m where m.value->>'id'=auth.uid()::text))));end$$;
  revoke execute on function public.get_milestone_workspace() from public;grant execute on function public.get_milestone_workspace() to authenticated;`);
  for (const [name, id] of Object.entries(ids))
    await db.query('insert into public.fyp_profiles values($1,$2,$3)', [
      id,
      ['supervisor', 'other'].includes(name)
        ? 'supervisor'
        : name === 'coordinator'
          ? 'coordinator'
          : name === 'examiner'
            ? 'examiner'
            : 'student',
      name,
    ]);
  await db.exec(
    fs.readFileSync(new URL('../migrations/20261008_health_v2.sql', import.meta.url), 'utf8'),
  );
  await db.exec(
    fs.readFileSync(
      new URL('../../supabase/migrations/20261011_peer_scale.sql', import.meta.url),
      'utf8',
    ),
  );
});
beforeEach(async () => {
  await db.exec(
    'reset role;truncate fyp_health_v2.reads,fyp_health_v2.notices,fyp_health_v2.reports,fyp_health_v2.snapshots,fyp_health_v2.settings,fyp_health_v2.ratings,fyp_health_v2.contributions,fyp_health_v2.audit,public.test_projects cascade',
  );
  await fixture(project());
  await actor(ids.supervisor);
});
after(async () => {
  await db?.close();
});
test('migration installs actual PostgreSQL RPCs and blocks anonymous/direct private-table access', async () => {
  await actor(null, 'anon');
  await assert.rejects(rpc('get_health_workspace'), (e) => e.code === '42501');
  await actor(ids.student);
  await assert.rejects(db.query('select * from fyp_health_v2.reports'), (e) => e.code === '42501');
  await actor(ids.supervisor);
  const w = await rpc('get_health_workspace');
  assert.equal(w.actor_id, ids.supervisor);
  assert.equal(w.projects[0].health.level, 'red');
});
test('SQL deterministic rules agree with the shared TypeScript engine including exact thresholds', async () => {
  await db.exec('reset role');
  const t = Date.parse('2026-10-08T12:00:00.000Z');
  const base = project();
  base.milestones[0].deadline = '2026-10-10T12:00:00.000Z';
  const cases = [];
  for (const ratings of [[1, 1], [2, 3], [1, 3], [3, 5], [5, 5], []])
    for (const percent of [null, 0, 30, 70, 100])
      cases.push({
        project_id: base.id,
        peers_required: true,
        peers: base.members.map((m) => ({ member_id: m.id, ratings, supervisor_percent: percent })),
      });
  for (const i of cases) {
    const sql = (
      await db.query('select fyp_health_v2.rules($1::jsonb,$2::jsonb,$3::timestamptz) as value', [
        JSON.stringify(base),
        JSON.stringify(i),
        new Date(t).toISOString(),
      ])
    ).rows[0].value;
    const ts = calculateHealth(base, i, t);
    assert.equal(sql.level, ts.level);
    assert.deepEqual(
      [...sql.rules].sort(
        (a, b) => a.code.localeCompare(b.code) || a.evidence.localeCompare(b.evidence),
      ),
      ts.rules,
    );
  }
  const p = structuredClone(base);
  p.milestones[0].deadline = '2026-10-01T12:00:00.000Z';
  p.milestones[0].status = 'needs_rework';
  p.milestones[0].submissions = [1, 2].map((n) => ({
    id: 's' + n,
    submitted_at: '2026-10-02T12:00:00.000Z',
    contributions: [
      { student_id: ids.student, statement: 'Worked', updated_at: '2026-10-02T12:00:00.000Z' },
    ],
    review: { action: 'needs_rework' },
  }));
  const i = { project_id: p.id, peers_required: false, peers: [] };
  const sql = (
    await db.query('select fyp_health_v2.rules($1::jsonb,$2::jsonb,$3::timestamptz) as value', [
      JSON.stringify(p),
      JSON.stringify(i),
      new Date(t).toISOString(),
    ])
  ).rows[0].value;
  assert.deepEqual(sql.rules, calculateHealth(p, i, t).rules);
});
test('a browser cannot forge risk or AI extra fields and active drafts are unique', async () => {
  const s = await rpc('prepare_group_health_draft', ['project-one']);
  const risk = calculateHealth(s.project, s.input);
  await assert.rejects(
    rpc('save_group_health_draft', [
      'project-one',
      s.version,
      { ...risk, level: 'green' },
      text,
      'fallback',
    ]),
    (e) => e.code === '22023',
  );
  await assert.rejects(
    rpc('save_group_health_draft', [
      'project-one',
      s.version,
      risk,
      { ...text, risk: 'green' },
      'gemini',
    ]),
  );
  await draft();
  await assert.rejects(draft(), (e) => e.code === '23505');
});
test('stale evidence blocks draft saving and review without publishing', async () => {
  const s = await rpc('prepare_group_health_draft', ['project-one']);
  const old = calculateHealth(s.project, s.input);
  const changed = project();
  changed.title = 'Edited title';
  await fixture(changed);
  await actor(ids.supervisor);
  await assert.rejects(
    rpc('save_group_health_draft', ['project-one', s.version, old, text, 'fallback']),
    (e) => e.code === '40001',
  );
  const saved = await draft();
  changed.title = 'Another edit';
  await fixture(changed);
  await actor(ids.supervisor);
  await assert.rejects(
    rpc('review_group_health', [
      saved.id,
      1,
      'approve',
      text.explanation,
      text.action,
      text.message,
    ]),
    (e) => e.code === '40001',
  );
  await db.exec('reset role');
  assert.equal(
    (await db.query('select count(*)::int as n from fyp_health_v2.notices')).rows[0].n,
    0,
  );
});
test('approval creates one notice atomically, hides student drafts and preserves independent read states', async () => {
  const saved = await draft();
  const approved = await rpc('review_group_health', [
    saved.id,
    1,
    'approve',
    text.explanation,
    text.action,
    'Edited approved message',
  ]);
  assert.equal(approved.notices.length, 1);
  assert.equal(approved.reports[0].version, 2);
  await assert.rejects(
    rpc('review_group_health', [
      saved.id,
      1,
      'approve',
      text.explanation,
      text.action,
      text.message,
    ]),
    (e) => e.code === '40001',
  );
  await actor(ids.student);
  let w = await rpc('get_health_workspace');
  assert.deepEqual(w.reports, []);
  assert.deepEqual(w.projects[0].health.rules, []);
  assert.equal(w.projects[0].health.fingerprint, '');
  assert.equal(w.notices[0].body, 'Edited approved message');
  await rpc('mark_health_notice_read', [w.notices[0].id]);
  w = await rpc('mark_health_notice_read', [w.notices[0].id]);
  assert.deepEqual(w.notices[0].read_by, [ids.student]);
  await actor(ids.second);
  const second = await rpc('get_health_workspace');
  assert.deepEqual(second.notices[0].read_by, []);
  await actor(ids.outsider);
  const other = await rpc('get_health_workspace');
  assert.equal(other.notices.length, 0);
  await assert.rejects(
    rpc('mark_health_notice_read', [w.notices[0].id]),
    (e) => e.code === '42501',
  );
});
test('rejection creates no notice; coordinator/examiner/other supervisor cannot approve', async () => {
  const saved = await draft();
  for (const id of [ids.coordinator, ids.examiner, ids.other, ids.student]) {
    await actor(id);
    await assert.rejects(
      rpc('review_group_health', [
        saved.id,
        1,
        'approve',
        text.explanation,
        text.action,
        text.message,
      ]),
      (e) => e.code === '42501',
    );
  }
  await actor(ids.supervisor);
  const w = await rpc('review_group_health', [
    saved.id,
    1,
    'reject',
    text.explanation,
    text.action,
    text.message,
  ]);
  assert.equal(w.notices.length, 0);
  assert.equal(w.reports[0].status, 'rejected');
});
test('peer ratings prevent self/other-group ratings, duplicates, invalid marks and disclosure', async () => {
  await rpc('fyp_v2_set_peer_due', ['project-one', true]);
  await actor(ids.student);
  await assert.rejects(
    rpc('fyp_v2_save_peer_rating', ['project-one', ids.student, 3]),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    rpc('fyp_v2_save_peer_rating', ['project-one', ids.outsider, 3]),
    (e) => e.code === '42501',
  );
  await assert.rejects(rpc('fyp_v2_save_peer_rating', ['project-one', ids.second, 6]));
  let w = await rpc('fyp_v2_save_peer_rating', ['project-one', ids.second, 4]);
  assert.equal(w.projects[0].my_ratings[0].rating, 4);
  await assert.rejects(
    rpc('fyp_v2_save_peer_rating', ['project-one', ids.second, 1]),
    (e) => e.code === '23505',
  );
  await actor(ids.second);
  w = await rpc('fyp_v2_peer_workspace');
  assert.deepEqual(w.projects[0].my_ratings, []);
  assert.deepEqual(w.projects[0].contribution_percents, []);
  await actor(ids.supervisor);
  w = await rpc('fyp_v2_peer_workspace');
  assert.deepEqual(w.projects[0].my_ratings, []);
});
test('supervisor contribution evidence and peer due edits invalidate earlier drafts', async () => {
  const saved = await draft();
  await rpc('fyp_v2_set_peer_due', ['project-one', true]);
  await rpc('fyp_v2_set_contribution_percent', ['project-one', ids.student, 70]);
  await assert.rejects(rpc('fyp_v2_set_contribution_percent', ['project-one', ids.student, 101]));
  await assert.rejects(
    rpc('review_group_health', [
      saved.id,
      1,
      'approve',
      text.explanation,
      text.action,
      text.message,
    ]),
    (e) => e.code === '40001',
  );
  await actor(ids.student);
  await assert.rejects(
    rpc('fyp_v2_set_peer_due', ['project-one', true]),
    (e) => e.code === '42501',
  );
});
test('green projects cannot receive intervention drafts', async () => {
  await fixture(project(20));
  await actor(ids.supervisor);
  await assert.rejects(draft(), (e) => e.code === '40001');
});
test('microsecond timestamps match JavaScript millisecond deadline/late boundaries', async () => {
  await db.exec('reset role');
  const p = project();
  p.milestones[0].deadline = '2026-10-08T12:00:00.001200Z';
  p.milestones[0].status = 'accepted';
  p.milestones[0].submissions = [
    {
      submitted_at: '2026-10-08T12:00:00.001900Z',
      contributions: p.members.map((m) => ({ student_id: m.id, statement: 'Evidence' })),
      review: { action: 'accepted' },
    },
  ];
  const i = { project_id: p.id, peers_required: false, peers: [] };
  const t = '2026-10-08T12:00:00.001900Z';
  const sql = (
    await db.query('select fyp_health_v2.rules($1::jsonb,$2::jsonb,$3::timestamptz) as value', [
      JSON.stringify(p),
      JSON.stringify(i),
      t,
    ])
  ).rows[0].value;
  assert.deepEqual(sql.rules, calculateHealth(p, i, Date.parse(t)).rules);
  assert.equal(sql.level, 'green');
});
test('database fallback works without Edge/Gemini, is idempotent and cannot publish', async () => {
  let w = await rpc('create_group_health_fallback', ['project-one']);
  assert.equal(w.reports.length, 1);
  assert.equal(w.reports[0].source, 'fallback');
  assert.equal(w.notices.length, 0);
  w = await rpc('create_group_health_fallback', ['project-one']);
  assert.equal(w.reports.length, 1);
  await actor(ids.student);
  await assert.rejects(
    rpc('create_group_health_fallback', ['project-one']),
    (e) => e.code === '42501',
  );
});
test('metadata-only changes supersede stale drafts even if the risk fingerprint stays the same', async () => {
  let w = await rpc('create_group_health_fallback', ['project-one']);
  const first = w.reports[0];
  const p = project();
  p.milestones[0].deadline = (
    await rpc('prepare_group_health_draft', ['project-one'])
  ).project.milestones[0].deadline;
  p.title = 'New title';
  await fixture(p);
  await actor(ids.supervisor);
  w = await rpc('create_group_health_fallback', ['project-one']);
  assert.equal(w.reports.length, 2);
  assert.equal(w.reports.find((r) => r.id === first.id).status, 'rejected');
  assert.equal(w.reports.filter((r) => r.status === 'draft').length, 1);
});
test('ownership change removes historical drafts and notices from the previous supervisor', async () => {
  const saved = await draft();
  await rpc('review_group_health', [
    saved.id,
    1,
    'approve',
    text.explanation,
    text.action,
    text.message,
  ]);
  const changed = project();
  changed.supervisor_id = ids.other;
  await fixture(changed);
  await actor(ids.supervisor);
  const old = await rpc('get_health_workspace');
  assert.equal(old.projects.length, 0);
  assert.equal(old.reports.length, 0);
  assert.equal(old.notices.length, 0);
  await actor(ids.other);
  const next = await rpc('get_health_workspace');
  assert.equal(next.notices.length, 1);
});
