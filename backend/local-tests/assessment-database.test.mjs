import { vector } from '@electric-sql/pglite-pgvector';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const id = {
  sup: '00000000-0000-4000-8000-000000000001',
  other: '00000000-0000-4000-8000-000000000002',
  a: '00000000-0000-4000-8000-000000000101',
  b: '00000000-0000-4000-8000-000000000102',
  c: '00000000-0000-4000-8000-000000000103',
  out: '00000000-0000-4000-8000-000000000104',
  coord: '00000000-0000-4000-8000-000000000201',
  e1: '00000000-0000-4000-8000-000000000301',
  e2: '00000000-0000-4000-8000-000000000302',
  e3: '00000000-0000-4000-8000-000000000303',
};
let db;
function project(accepted = true) {
  return {
    id: 'p',
    group_name: 'Team',
    title: 'Compass',
    supervisor_id: id.sup,
    members: [
      { id: id.a, full_name: 'A' },
      { id: id.b, full_name: 'B' },
      { id: id.c, full_name: 'C' },
    ],
    milestones: [
      {
        id: 'm',
        name: 'Final report',
        description: 'Report',
        deadline: '2026-10-01T12:00:00Z',
        status: accepted ? 'accepted' : 'submitted',
        submissions: [],
      },
    ],
  };
}
async function actor(uid, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('test.actor',$1,false)", [uid || '']);
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
  return (
    await db.query(
      'select public.' + name + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') as value',
      args.map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : a)),
    )
  ).rows[0].value;
}
const individual = (marks) =>
  [id.a, id.b, id.c].map((student_id, i) => ({ student_id, mark: marks[i] }));
async function ready() {
  await actor(id.sup);
  await rpc('fyp_v2_certify_defense', ['p']);
  await actor(id.coord);
  return (
    await rpc('fyp_v2_schedule_defense', [
      'p',
      new Date(Date.now() + 3600000).toISOString(),
      'Room One',
      true,
      id.e1,
      id.e2,
    ])
  ).id;
}
async function peerRatings() {
  await actor(id.sup);
  await rpc('fyp_v2_set_peer_due', ['p', true]);
  for (const a of [id.a, id.b, id.c]) {
    await actor(a);
    for (const b of [id.a, id.b, id.c].filter((b) => a !== b))
      await rpc('fyp_v2_save_peer_rating', ['p', b, 4]);
  }
}
async function marks(defense) {
  await actor(id.sup);
  await rpc('fyp_v2_save_supervisor_marks', ['p', 8, 12, individual([15, 12, 10])]);
  await actor(id.e1);
  await rpc('fyp_v2_submit_examiner_marks', [
    defense,
    12,
    13,
    individual([20, 18, 14]),
    'Evidence reviewed.',
  ]);
  await actor(id.e2);
  await rpc('fyp_v2_submit_examiner_marks', [
    defense,
    14,
    15,
    individual([20, 14, 10]),
    'Independent assessment.',
  ]);
}
before(async () => {
  db = new PGlite({ extensions: { vector } });
  await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
create table public.fyp_profiles(id uuid primary key,role text,full_name text);create table public.test_projects(id text primary key,data jsonb);
create function public.get_milestone_workspace() returns jsonb language plpgsql security definer set search_path='' as $$declare r text;begin select role into r from public.fyp_profiles where id=auth.uid();if r not in ('student','supervisor') or r is null then raise exception 'Denied' using errcode='42501';end if;return jsonb_build_object('actor_id',auth.uid(),'projects',(select coalesce(jsonb_agg(data),'[]') from public.test_projects where (r='supervisor' and data->>'supervisor_id'=auth.uid()::text) or (r='student' and exists(select 1 from jsonb_array_elements(data->'members') where value->>'id'=auth.uid()::text))));end$$;revoke execute on function public.get_milestone_workspace() from public;grant execute on function public.get_milestone_workspace() to authenticated;`);
  for (const [name, uid] of Object.entries(id))
    await db.query('insert into public.fyp_profiles values($1,$2,$3)', [
      uid,
      ['sup', 'other'].includes(name)
        ? 'supervisor'
        : name === 'coord'
          ? 'coordinator'
          : name.startsWith('e')
            ? 'examiner'
            : 'student',
      name,
    ]);
  for (const file of ['20261008_health_v2.sql', '20261008_assessment_v2.sql'])
    await db.exec(fs.readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
});
beforeEach(async () => {
  await db.exec(
    'reset role;truncate fyp_assessment_v2.certifications,fyp_assessment_v2.defenses,fyp_assessment_v2.supervisor_marks,fyp_assessment_v2.assessments,fyp_assessment_v2.exclusions,fyp_assessment_v2.peer_reviews,fyp_assessment_v2.results,fyp_assessment_v2.audit,fyp_health_v2.reads,fyp_health_v2.notices,fyp_health_v2.reports,fyp_health_v2.snapshots,fyp_health_v2.settings,fyp_health_v2.ratings,fyp_health_v2.contributions,fyp_health_v2.audit,public.test_projects cascade',
  );
  await fixture(project());
  await actor(id.sup);
  await rpc('get_health_workspace');
});
after(async () => await db?.close());
test('defense gate requires accepted milestones, fee and distinct examiner-role accounts', async () => {
  await fixture(project(false));
  await actor(id.sup);
  await assert.rejects(rpc('fyp_v2_certify_defense', ['p']), /milestones/);
  await fixture(project());
  await actor(id.sup);
  await rpc('fyp_v2_certify_defense', ['p']);
  await actor(id.coord);
  const args = ['p', new Date(Date.now() + 3600000).toISOString(), 'Room', true, id.e1, id.e2];
  await assert.rejects(
    rpc(
      'fyp_v2_schedule_defense',
      args.map((v, i) => (i === 3 ? false : v)),
    ),
    /Fee Paid/,
  );
  await assert.rejects(
    rpc(
      'fyp_v2_schedule_defense',
      args.map((v, i) => (i === 5 ? id.e1 : v)),
    ),
    /different/,
  );
  await assert.rejects(
    rpc(
      'fyp_v2_schedule_defense',
      args.map((v, i) => (i === 5 ? id.sup : v)),
    ),
    /examiner/,
  );
  await rpc('fyp_v2_schedule_defense', args);
});
test('unassigned examiners cannot view or submit; assessments stay independent and immutable', async () => {
  const d = await ready();
  await actor(id.e3);
  assert.equal((await rpc('fyp_v2_assessment_workspace')).defenses.length, 0);
  await assert.rejects(
    rpc('fyp_v2_submit_examiner_marks', [d, 12, 12, individual([15, 15, 15]), 'Notes']),
    (e) => e.code === '42501',
  );
  await actor(id.e1);
  await rpc('fyp_v2_submit_examiner_marks', [d, 12, 13, individual([15, 16, 17]), 'Notes']);
  await assert.rejects(
    rpc('fyp_v2_submit_examiner_marks', [d, 1, 1, individual([1, 1, 1]), 'Changed']),
    (e) => e.code === '23505',
  );
  await actor(id.e2);
  const w = await rpc('fyp_v2_assessment_workspace');
  assert.equal(w.defenses[0].my_assessment, null);
  assert.deepEqual(w.defenses[0].submitted_examiners, []);
});
test('supervisor and examiner component ranges and member completeness are checked server-side', async () => {
  const d = await ready();
  await actor(id.sup);
  await assert.rejects(
    rpc('fyp_v2_save_supervisor_marks', ['p', 11, 12, individual([15, 12, 10])]),
  );
  await assert.rejects(rpc('fyp_v2_save_supervisor_marks', ['p', 8, 16, individual([15, 12, 10])]));
  await assert.rejects(rpc('fyp_v2_save_supervisor_marks', ['p', 8, 12, individual([16, 12, 10])]));
  await assert.rejects(
    rpc('fyp_v2_save_supervisor_marks', ['p', 8, 12, individual([15, 12, 10]).slice(0, 2)]),
  );
  await actor(id.e1);
  await assert.rejects(
    rpc('fyp_v2_submit_examiner_marks', [d, 16, 12, individual([15, 15, 15]), 'Notes']),
  );
  await assert.rejects(
    rpc('fyp_v2_submit_examiner_marks', [d, 12, 12, individual([21, 15, 15]), 'Notes']),
  );
});
test('finalization blocks incomplete staff and pending peer marks', async () => {
  const d = await ready();
  await actor(id.coord);
  await assert.rejects(rpc('fyp_v2_finalize_results', [d]), /Supervisor/);
  await actor(id.sup);
  await rpc('fyp_v2_save_supervisor_marks', ['p', 8, 12, individual([15, 12, 10])]);
  await actor(id.coord);
  await assert.rejects(rpc('fyp_v2_finalize_results', [d]), /Both examiners/);
  await marks(d);
  await actor(id.coord);
  await assert.rejects(rpc('fyp_v2_finalize_results', [d]), /pending review/);
});
test('55/45 results differ per student and remain private until coordinator release', async () => {
  const d = await ready();
  await peerRatings();
  await marks(d);
  await actor(id.coord);
  await rpc('fyp_v2_finalize_results', [d]);
  let w = await rpc('fyp_v2_assessment_workspace');
  assert.deepEqual(
    w.results.map((r) => Number(r.group_mark)),
    [47, 47, 47],
  );
  assert.deepEqual(
    w.results.map((r) => Number(r.individual_mark)),
    [43, 36, 30],
  );
  assert.deepEqual(
    w.results.map((r) => Number(r.total)),
    [90, 83, 77],
  );
  await actor(id.a);
  assert.deepEqual((await rpc('fyp_v2_assessment_workspace')).results, []);
  await assert.rejects(rpc('fyp_v2_release_results', [d]), (e) => e.code === '42501');
  await actor(id.coord);
  await rpc('fyp_v2_release_results', [d]);
  await actor(id.a);
  w = await rpc('fyp_v2_assessment_workspace');
  assert.equal(w.results.length, 1);
  assert.equal(w.results[0].student_id, id.a);
  assert.equal(Number(w.results[0].total), 90);
  await actor(id.out);
  assert.equal((await rpc('fyp_v2_assessment_workspace')).results.length, 0);
});
test('reviewed peer mark requires a reason, preserves original and invalidates on new evidence', async () => {
  await peerRatings();
  await actor(id.coord);
  let w = await rpc('fyp_v2_assessment_workspace');
  let p = w.projects[0].peer_marks.find((x) => x.student_id === id.a);
  await assert.rejects(
    rpc('fyp_v2_review_peer_mark', ['p', id.a, p.signature, 'assign', 9, null, '']),
  );
  await rpc('fyp_v2_review_peer_mark', [
    'p',
    id.a,
    p.signature,
    'assign',
    9,
    null,
    'Evidence checked.',
  ]);
  w = await rpc('fyp_v2_assessment_workspace');
  p = w.projects[0].peer_marks.find((x) => x.student_id === id.a);
  assert.equal(p.original_mark, 8);
  assert.equal(p.mark, 9);
  assert.equal(p.status, 'reviewed');
  await actor(id.sup);
  await rpc('fyp_v2_set_contribution_percent', ['p', id.a, 0]);
  await actor(id.coord);
  w = await rpc('fyp_v2_assessment_workspace');
  p = w.projects[0].peer_marks.find((x) => x.student_id === id.a);
  assert.equal(p.status, 'pending_review');
  assert.equal(p.mark, 8);
});
test('exclusion preserves original rating and records human-reviewed recalculation', async () => {
  await peerRatings();
  await actor(id.coord);
  let p = (await rpc('fyp_v2_assessment_workspace')).projects[0].peer_marks.find(
    (x) => x.student_id === id.a,
  );
  await rpc('fyp_v2_review_peer_mark', [
    'p',
    id.a,
    p.signature,
    'exclude',
    null,
    id.b,
    'Invalid evidence documented.',
  ]);
  p = (await rpc('fyp_v2_assessment_workspace')).projects[0].peer_marks.find(
    (x) => x.student_id === id.a,
  );
  assert.equal(p.status, 'reviewed');
  assert.equal(p.original_mark, 8);
  assert.equal(p.ratings.length, 2);
  assert.equal(p.ratings.filter((x) => x.excluded).length, 1);
});
test('released correction requires a reason/version and keeps the shared group component identical', async () => {
  const d = await ready();
  await peerRatings();
  await marks(d);
  await actor(id.coord);
  await rpc('fyp_v2_finalize_results', [d]);
  await rpc('fyp_v2_release_results', [d]);
  let w = await rpc('fyp_v2_assessment_workspace');
  const r = w.results[0];
  const g = { proposal: 9, progress: 12, report: 13, implementation: 14 },
    i = { contribution: 15, viva: 19, peer: 8 };
  await assert.rejects(rpc('fyp_v2_correct_result', [r.id, 1, g, i, '']));
  await rpc('fyp_v2_correct_result', [r.id, 1, g, i, 'Clerical evidence correction.']);
  w = await rpc('fyp_v2_assessment_workspace');
  assert.deepEqual(
    w.results.map((r) => Number(r.group_mark)),
    [48, 48, 48],
  );
  assert.equal(Number(w.results[0].total), 90);
  await assert.rejects(
    rpc('fyp_v2_correct_result', [r.id, 1, g, i, 'Again']),
    (e) => e.code === '40001',
  );
  await db.exec('reset role');
  const logs = (
    await db.query(
      "select details from fyp_assessment_v2.audit where action='released_result_corrected'",
    )
  ).rows;
  assert.equal(logs[0].details.previous_results.length, 3);
  assert.equal(Number(logs[0].details.previous_results[0].group_mark), 47);
});
test('changed project evidence prevents assessment on an earlier certification', async () => {
  const d = await ready();
  const p = project();
  p.members[2] = { id: id.out, full_name: 'New member' };
  await fixture(p);
  await actor(id.sup);
  await rpc('get_health_workspace');
  await actor(id.e1);
  await assert.rejects(
    rpc('fyp_v2_submit_examiner_marks', [d, 12, 12, individual([15, 15, 15]), 'Notes']),
    /evidence changed/,
  );
});
test('anonymous/direct table writes and cross-role grading are denied', async () => {
  await actor(null, 'anon');
  await assert.rejects(rpc('fyp_v2_assessment_workspace'), (e) => e.code === '42501');
  await actor(id.a);
  await assert.rejects(
    db.query('select * from fyp_assessment_v2.results'),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    rpc('fyp_v2_save_supervisor_marks', ['p', 8, 12, individual([15, 12, 10])]),
    (e) => e.code === '42501',
  );
  await actor(id.e1);
  await assert.rejects(
    rpc('fyp_v2_review_peer_mark', ['p', id.a, 'wrong', 'assign', 10, null, 'Forged']),
    (e) => e.code === '42501',
  );
});
