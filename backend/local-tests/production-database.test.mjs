import { vector } from '@electric-sql/pglite-pgvector';
import { installAuthSessionFixture, setTestActor } from './auth-session-fixture.mjs';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const uid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const coord = uid(200),
  sups = [uid(1), uid(2), uid(3)],
  students = [101, 102, 103, 104, 105, 106, 107].map(uid),
  exams = [uid(301), uid(302)];
let db, sid, topics;
async function actor(id, role = 'authenticated') {
  await setTestActor(db, id, role);
}
async function rpc(name, args = []) {
  return (
    await db.query(
      'select public.' + name + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') as value',
      args.map((a) => (a && typeof a === 'object' && !Array.isArray(a) ? JSON.stringify(a) : a)),
    )
  ).rows[0].value;
}
async function config(op, data) {
  await actor(coord);
  return rpc('fyp_v2_core_configure', [op, data]);
}
async function group(student = students[0], additional = []) {
  await actor(student);
  return (await rpc('fyp_v2_core_create_student_group', ['Group', sid, additional])).group.id;
}
async function proposal(
  g,
  prefs = sups,
  tags = topics.slice(0, 3),
  title = 'Academic portal',
  abstract = 'A shared portal for academic projects and assessments',
) {
  return rpc('fyp_v2_core_save_student_proposal', [
    g,
    title,
    abstract,
    ['academic'],
    tags,
    prefs,
    null,
    true,
  ]);
}
async function allocate(g) {
  await actor(coord);
  await rpc('fyp_v2_core_match', ['demo-seed']);
  await actor(students[0]);
  const w = await rpc('fyp_v2_core_get_student_workspace');
  return w.allocation.supervisor_id;
}
async function approved() {
  const g = await group(students[0], [students[1], students[2]]);
  const w = await proposal(g);
  const sup = await allocate(g);
  await actor(sup);
  await rpc('fyp_v2_core_run_similarity_screen', [w.proposal.id]);
  await rpc('fyp_v2_core_review_supervisor_proposal', [
    w.proposal.id,
    'approve',
    '',
    '',
    'submitted',
  ]);
  return { g, sup, p: w.proposal.id };
}
async function uploaded(g, student = students[0], milestone = null) {
  const path = student + '/' + g + '/' + (milestone ? milestone + '/' : '') + 'evidence.pdf';
  await actor(student);
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)', [
    'fyp-v2-submissions',
    path,
    JSON.stringify({ size: 500 }),
  ]);
  return { name: 'evidence.pdf', path, size: 500 };
}
before(async () => {
  db = new PGlite({ extensions: { vector } });
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;grant usage on schema auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create table auth.users(id uuid primary key);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;grant select on storage.objects to anon;create policy legacy_broad_storage on storage.objects for all to anon,authenticated using(true) with check(true);`,
  );
  for (const id of [...students, ...sups, coord, ...exams])
    await db.query('insert into auth.users values($1)', [id]);
  await db.exec(
    "alter table auth.users add column email text,add column email_confirmed_at timestamptz default now(),add column raw_user_meta_data jsonb default '{}'",
  );
  await installAuthSessionFixture(db);
  await db.exec(
    fs.readFileSync(
      new URL(
        process.env.FYP_TEST_FULL_SCHEMA === 'true'
          ? '../INSTALL-PRODUCTION.sql'
          : '../INSTALL-ALL-V2.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  for (const id of [...students, ...sups, coord, ...exams])
    await db.query('insert into public.fyp_profiles values($1,$2,$3)', [
      id,
      'Person ' + id.slice(-3),
      id === coord
        ? 'coordinator'
        : sups.includes(id)
          ? 'supervisor'
          : exams.includes(id)
            ? 'examiner'
            : 'student',
    ]);
  if (process.env.FYP_TEST_FULL_SCHEMA !== 'true')
    await db.exec(
      fs.readFileSync(
        new URL('../../supabase/migrations/20261010_production_guardrails.sql', import.meta.url),
        'utf8',
      ),
    );
  if (process.env.FYP_TEST_FULL_SCHEMA !== 'true')
    await db.exec(
      fs.readFileSync(
        new URL('../../supabase/migrations/20261010_coordinator_health.sql', import.meta.url),
        'utf8',
      ),
    );
});
beforeEach(async () => {
  await db.exec(
    'reset role;truncate fyp_ops_v1.ai_runs,fyp_ops_v1.documents,fyp_core_v2.sessions,fyp_core_v2.topics,fyp_core_v2.participants,fyp_core_v2.capacities,fyp_core_v2.templates,fyp_core_v2.groups,fyp_core_v2.members,fyp_core_v2.proposals,fyp_core_v2.allocations,fyp_core_v2.milestones,fyp_core_v2.submissions,fyp_core_v2.statements,fyp_core_v2.audit,fyp_health_v2.settings,fyp_health_v2.snapshots,fyp_health_v2.ratings,fyp_health_v2.contributions,fyp_health_v2.reports,fyp_health_v2.notices,fyp_health_v2.reads,fyp_health_v2.audit,fyp_assessment_v2.certifications,fyp_assessment_v2.defenses,fyp_assessment_v2.supervisor_marks,fyp_assessment_v2.assessments,fyp_assessment_v2.exclusions,fyp_assessment_v2.peer_reviews,fyp_assessment_v2.results,fyp_assessment_v2.audit,storage.objects cascade',
  );
  let w = await config('session', { name: '2026', active: true });
  sid = w.sessions[0].id;
  for (const name of ['Web', 'AI', 'Data', 'IoT']) w = await config('topic', { name });
  topics = w.topics.map((t) => t.id);
  for (const student of students) await config('enroll', { profile_id: student, session_id: sid });
  for (const sup of sups)
    await config('capacity', {
      session_id: sid,
      supervisor_id: sup,
      max_groups: 2,
      topic_ids: topics.slice(0, 3),
    });
  await config('template', {
    session_id: sid,
    name: 'Report',
    description: 'Final report',
    days: 7,
  });
});
after(async () => await db?.close());

test('production migration installs and operations remain private to coordinator', async () => {
  await actor(students[0]);
  await assert.rejects(rpc('fyp_ops_status'), (e) => e.code === '42501');
  await assert.rejects(db.query('select * from fyp_ops_v1.ai_runs'));
  await actor(coord);
  const status = await rpc('fyp_ops_status');
  assert.equal(status.limits.daily_total, 100);
  assert.equal(status.ai.total, 0);
});
test('only assigned supervisors may reserve AI and concurrent calls share a project lock', async () => {
  const { g, sup } = await approved();
  await actor(students[0]);
  await assert.rejects(rpc('fyp_ops_reserve_ai', [g]));
  await actor(sups.find((x) => x !== sup));
  await assert.rejects(rpc('fyp_ops_reserve_ai', [g]));
  await actor(sup);
  const first = await rpc('fyp_ops_reserve_ai', [g]);
  assert.equal(first.allowed, true);
  const second = await rpc('fyp_ops_reserve_ai', [g]);
  assert.equal(second.reason, 'in_progress');
});
test('quarter-hour, daily user and global budgets are enforced including failed reservations', async () => {
  const { g, sup } = await approved();
  await actor(sup);
  for (let i = 0; i < 5; i++) {
    const reservation = await rpc('fyp_ops_reserve_ai', [g]);
    assert.equal(reservation.allowed, true);
    await db.exec('reset role');
    await db.query("update fyp_ops_v1.ai_runs set status='failed' where id=$1", [reservation.id]);
    await actor(sup);
  }
  assert.equal((await rpc('fyp_ops_reserve_ai', [g])).allowed, false);
  await db.exec('reset role');
  await db.query("update fyp_ops_v1.ai_runs set created_at=now()-interval '1 hour'");
  await db.query(
    "insert into fyp_ops_v1.ai_runs(actor,project_id,status,created_at) select $1,$2,'failed',now()-interval '2 hours' from generate_series(1,15)",
    [sup, g],
  );
  await actor(sup);
  assert.equal((await rpc('fyp_ops_reserve_ai', [g])).reason, 'rate_limit');
  await db.exec('reset role;truncate fyp_ops_v1.ai_runs');
  await db.query(
    "insert into fyp_ops_v1.ai_runs(actor,project_id,status) select $1,$2,'failed' from generate_series(1,100)",
    [coord, g],
  );
  await actor(sup);
  assert.equal((await rpc('fyp_ops_reserve_ai', [g])).reason, 'daily_budget');
  await db.exec("reset role;update fyp_ops_v1.ai_runs set created_at=now()-interval '25 hours'");
  await actor(sup);
  assert.equal((await rpc('fyp_ops_reserve_ai', [g])).allowed, true);
});
test('clients cannot forge AI outcomes; service telemetry binds reservation actor and finishes once', async () => {
  const { g, sup } = await approved();
  await actor(sup);
  const r = await rpc('fyp_ops_reserve_ai', [g]);
  await assert.rejects(
    rpc('fyp_ops_finish_ai', [r.id, sup, 'gemini', 20, 'ok']),
    (e) => e.code === '42501',
  );
  await actor(null, 'service_role');
  await assert.rejects(rpc('fyp_ops_finish_ai', [r.id, coord, 'gemini', 20, 'ok']));
  await rpc('fyp_ops_finish_ai', [r.id, sup, 'gemini', 20, 'ok']);
  await assert.rejects(rpc('fyp_ops_finish_ai', [r.id, sup, 'gemini', 20, 'ok']));
});
test('direct academic RPC cannot attach unscreened files; verified ownership and bytes are required', async () => {
  const { g } = await approved();
  await actor(students[0]);
  const m = (await rpc('fyp_v2_core_get_milestone_workspace')).projects[0].milestones[0].id;
  const d = await uploaded(g, students[0], m);
  await assert.rejects(
    rpc('fyp_v2_core_submit_student_milestone', [m, d, 'Evidence.', null]),
    /verification/,
  );
  await assert.rejects(
    rpc('fyp_ops_record_document', [
      students[0],
      d.path,
      d.size,
      'a'.repeat(64),
      'application/pdf',
    ]),
    (e) => e.code === '42501',
  );
  await actor(null, 'service_role');
  await assert.rejects(
    rpc('fyp_ops_record_document', [
      students[1],
      d.path,
      d.size,
      'a'.repeat(64),
      'application/pdf',
    ]),
  );
  await assert.rejects(
    rpc('fyp_ops_record_document', [
      students[0],
      d.path,
      d.size + 1,
      'a'.repeat(64),
      'application/pdf',
    ]),
  );
  await rpc('fyp_ops_record_document', [
    students[0],
    d.path,
    d.size,
    'a'.repeat(64),
    'application/pdf',
  ]);
  await actor(students[0]);
  assert.equal(
    (await rpc('fyp_v2_core_submit_student_milestone', [m, d, 'Verified evidence.', null]))
      .projects[0].milestones[0].status,
    'submitted',
  );
});
test('institution settings are validated, persisted and coordinator-only', async () => {
  await actor(students[0]);
  await assert.rejects(
    rpc('fyp_ops_update_institution', ['School', '', 'Asia/Karachi']),
    (e) => e.code === '42501',
  );
  await actor(coord);
  for (const data of [
    ['', '', 'Asia/Karachi'],
    ['School', 'invalid', 'Asia/Karachi'],
    ['School', '', 'Unknown/Zone'],
  ])
    await assert.rejects(rpc('fyp_ops_update_institution', data));
  const status = await rpc('fyp_ops_update_institution', [
    'Actual Institution',
    'support@example.test',
    'Asia/Karachi',
  ]);
  assert.equal(status.institution.name, 'Actual Institution');
  assert.equal(status.institution.support_email, 'support@example.test');
});
test('bounded concurrent reservations do not exceed the persisted allowance', async () => {
  const { g, sup } = await approved();
  await actor(sup);
  const started = performance.now();
  const results = await Promise.all(
    Array.from({ length: 50 }, () => rpc('fyp_ops_reserve_ai', [g])),
  );
  assert.equal(results.filter((x) => x.allowed).length, 1);
  assert.equal(results.filter((x) => x.reason === 'in_progress').length, 49);
  console.log(
    JSON.stringify({
      load: '50 concurrent isolated PostgreSQL reservations',
      durationMs: Math.round(performance.now() - started),
      allowed: 1,
      denied: 49,
    }),
  );
});

test('coordinator health oversight denies anonymous, students, supervisors and examiners', async () => {
  await actor(null, 'anon');
  await assert.rejects(rpc('fyp_coordinator_health'));
  for (const id of [students[0], sups[0], exams[0]]) {
    await actor(id);
    await assert.rejects(rpc('fyp_coordinator_health'), (e) => e.code === '42501');
  }
});
test('coordinator health distinguishes sessions and denies unknown session IDs', async () => {
  await actor(coord);
  const w = await rpc('fyp_coordinator_health');
  assert.equal(w.selected_session, sid);
  assert.deepEqual(w.projects, []);
  assert.deepEqual(w.notices, []);
  await assert.rejects(rpc('fyp_coordinator_health', [uid(9999)]), (e) => e.code === '22023');
});
test('coordinator health includes actual snapshots and only approved notices with read counts', async () => {
  const { g, sup } = await approved();
  await db.exec('reset role');
  await db.query(
    "update fyp_core_v2.milestones set deadline=now()+interval '1 day' where group_id=$1",
    [g],
  );
  await actor(sup);
  await rpc('get_health_workspace');
  await rpc('create_group_health_fallback', [g]);
  await actor(coord);
  let w = await rpc('fyp_coordinator_health');
  assert.equal(w.projects[0].id, g);
  assert.equal(w.projects[0].draft_count, 1);
  assert.equal(w.notices.length, 0);
  await actor(sup);
  const h = await rpc('get_health_workspace');
  const draft = h.reports.find((r) => r.status === 'draft');
  await rpc('review_group_health', [
    draft.id,
    draft.version,
    'approve',
    draft.explanation,
    draft.action,
    draft.message,
  ]);
  await actor(students[0]);
  const n = (await rpc('get_health_workspace')).notices[0];
  await rpc('mark_health_notice_read', [n.id]);
  await actor(coord);
  w = await rpc('fyp_coordinator_health');
  assert.equal(w.notices.length, 1);
  assert.equal(w.notices[0].recipients_count, 3);
  assert.equal(w.notices[0].read_count, 1);
  assert.equal(w.projects[0].draft_count, 0);
});
