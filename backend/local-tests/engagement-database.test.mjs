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
  await db.exec('reset role');
  await db.query("select set_config('test.actor',$1,false)", [id || '']);
  await db.exec('set role ' + role);
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
  db = new PGlite();
  await db.exec(
    `create role service_role;create role anon;create role authenticated;create schema auth;create schema storage;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;grant usage on schema auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create table auth.users(id uuid primary key);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;grant select on storage.objects to anon;create policy legacy_broad_storage on storage.objects for all to anon,authenticated using(true) with check(true);`,
  );
  for (const id of [...students, ...sups, coord, ...exams])
    await db.query('insert into auth.users values($1)', [id]);
  await db.exec(fs.readFileSync(new URL('../INSTALL-ALL-V2.sql', import.meta.url), 'utf8'));
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
});
beforeEach(async () => {
  await db.exec(
    'reset role;truncate fyp_engagement_v1.enquiries,fyp_engagement_v1.onboarding,fyp_engagement_v1.preferences,fyp_engagement_v1.reminder_runs,fyp_engagement_v1.audit;truncate fyp_core_v2.sessions,fyp_core_v2.topics,fyp_core_v2.participants,fyp_core_v2.capacities,fyp_core_v2.templates,fyp_core_v2.groups,fyp_core_v2.members,fyp_core_v2.proposals,fyp_core_v2.allocations,fyp_core_v2.milestones,fyp_core_v2.submissions,fyp_core_v2.statements,fyp_core_v2.audit,fyp_health_v2.settings,fyp_health_v2.snapshots,fyp_health_v2.ratings,fyp_health_v2.contributions,fyp_health_v2.reports,fyp_health_v2.notices,fyp_health_v2.reads,fyp_health_v2.audit,fyp_assessment_v2.certifications,fyp_assessment_v2.defenses,fyp_assessment_v2.supervisor_marks,fyp_assessment_v2.assessments,fyp_assessment_v2.exclusions,fyp_assessment_v2.peer_reviews,fyp_assessment_v2.results,fyp_assessment_v2.audit,storage.objects cascade',
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
test('enquiries persist once, normalize email and reject a changed retry payload', async () => {
  await db.exec('reset role');
  const args = [
    uid(900),
    'Audit Client',
    'CLIENT@example.test',
    'Regular',
    'Build a verified academic project portal.',
    true,
    'a'.repeat(64),
  ];
  const a = await rpc('fyp_engagement_receive_enquiry', args),
    b = await rpc('fyp_engagement_receive_enquiry', args);
  assert.equal(a.reference, b.reference);
  assert.equal(a.status, 'received');
  assert.equal((await db.query('select count(*) n from fyp_engagement_v1.enquiries')).rows[0].n, 1);
  await assert.rejects(
    rpc('fyp_engagement_receive_enquiry', [
      ...args.slice(0, 4),
      'Changed requirements for a different project.',
      ...args.slice(5),
    ]),
    /different request/,
  );
});
test('enquiry limits reject fourth submission while a retry remains valid', async () => {
  await db.exec('reset role');
  const args = (n) => [
    uid(n),
    'Audit Client',
    n + '@example.test',
    'Basic',
    'Project guidance and scope requirements.',
    true,
    'b'.repeat(64),
  ];
  for (let i = 910; i < 913; i++) await rpc('fyp_engagement_receive_enquiry', args(i));
  await assert.rejects(rpc('fyp_engagement_receive_enquiry', args(914)), /Too many/);
  assert.equal((await rpc('fyp_engagement_receive_enquiry', args(910))).status, 'received');
});
test('anonymous and academic roles cannot submit via privileged RPC or read private enquiries', async () => {
  await actor(null, 'anon');
  await assert.rejects(
    rpc('fyp_engagement_receive_enquiry', [
      uid(920),
      'Audit Client',
      'client@example.test',
      'Regular',
      'Build an academic project portal.',
      true,
      'c'.repeat(64),
    ]),
    (e) => e.code === '42501',
  );
  await actor(students[0]);
  await assert.rejects(
    db.query('select * from fyp_engagement_v1.enquiries'),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    rpc('fyp_engagement_receive_enquiry', [
      uid(920),
      'Audit Client',
      'client@example.test',
      'Regular',
      'Build an academic project portal.',
      true,
      'c'.repeat(64),
    ]),
    (e) => e.code === '42501',
  );
  assert.equal((await rpc('fyp_engagement_workspace')).enquiries, undefined);
});
test('only coordinators update enquiry status and concurrent edits fail safely', async () => {
  await db.exec('reset role');
  const rec = await rpc('fyp_engagement_receive_enquiry', [
    uid(930),
    'Audit Client',
    'client@example.test',
    'Advance',
    'Build an academic project portal.',
    true,
    'd'.repeat(64),
  ]);
  await actor(students[0]);
  await assert.rejects(
    rpc('fyp_engagement_action', [
      'enquiry_status',
      { id: rec.reference, status: 'completed', version: 1 },
    ]),
    (e) => e.code === '42501',
  );
  await actor(coord);
  const w = await rpc('fyp_engagement_action', [
    'enquiry_status',
    { id: rec.reference, status: 'contacted', version: 1 },
  ]);
  assert.equal(w.enquiries[0].version, 2);
  await assert.rejects(
    rpc('fyp_engagement_action', [
      'enquiry_status',
      { id: rec.reference, status: 'completed', version: 1 },
    ]),
    (e) => e.code === '40001',
  );
});
test('onboarding belongs to the current account and rejects another role task or invalid booleans', async () => {
  await actor(students[0]);
  await rpc('fyp_engagement_action', [
    'onboarding',
    { task: 'group', completed: true, profile_id: students[1] },
  ]);
  assert.equal((await rpc('fyp_engagement_workspace')).onboarding[0].completed, true);
  await assert.rejects(
    rpc('fyp_engagement_action', ['onboarding', { task: 'configuration', completed: true }]),
  );
  await assert.rejects(
    rpc('fyp_engagement_action', ['onboarding', { task: 'group', completed: 'false' }]),
  );
  await actor(students[1]);
  assert.equal((await rpc('fyp_engagement_workspace')).onboarding.length, 0);
});
test('anonymous case feed excludes drafts and requires verification, consent and attribution for quotes', async () => {
  const content = {
    title: 'Verified academic implementation',
    challenge: 'An actual academic workflow needed a connected workspace.',
    solution: 'A connected portal with verified role permissions was built.',
    outcome: 'Academic records and assessment workflow are connected.',
    evidence: 'Implementation reviewed against actual project source.',
    image: '/previews/student-workspace.png',
    quote: '',
    attribution: '',
    consent: false,
    verified: false,
    published: false,
  };
  await actor(students[0]);
  await assert.rejects(
    rpc('fyp_engagement_save_case', [null, content, null]),
    (e) => e.code === '42501',
  );
  await actor(coord);
  let w = await rpc('fyp_engagement_save_case', [null, content, null]);
  const draft = w.cases.find((c) => c.title === content.title);
  await actor(null, 'anon');
  assert(!(await rpc('fyp_engagement_public_cases')).some((c) => c.id === draft.id));
  await actor(coord);
  await assert.rejects(
    rpc('fyp_engagement_save_case', [draft.id, { ...content, published: true }, 1]),
    (e) => e.code === '23514',
  );
  await assert.rejects(
    rpc('fyp_engagement_save_case', [
      draft.id,
      { ...content, published: true, verified: true, quote: 'A real authorized quote.' },
      1,
    ]),
    (e) => e.code === '23514',
  );
  w = await rpc('fyp_engagement_save_case', [
    draft.id,
    {
      ...content,
      published: true,
      verified: true,
      consent: true,
      quote: 'A real authorized quote.',
      attribution: 'Consenting Client',
    },
    1,
  ]);
  assert.equal(w.cases.find((c) => c.id === draft.id).version, 2);
  await assert.rejects(
    rpc('fyp_engagement_save_case', [draft.id, content, 1]),
    (e) => e.code === '40001',
  );
  await actor(null, 'anon');
  assert((await rpc('fyp_engagement_public_cases')).some((c) => c.id === draft.id && c.quote));
});
async function due(hours = 48) {
  const v = await approved();
  await db.exec('reset role');
  const m = (
    await db.query(
      "update fyp_core_v2.milestones set deadline=now()+($1||' hours')::interval where group_id=$2 returning id",
      [String(hours), v.g],
    )
  ).rows[0].id;
  return { ...v, m };
}
async function refresh() {
  await db.exec('reset role');
  return (await db.query('select fyp_engagement_v1.refresh_reminders(true) n')).rows[0].n;
}
test('deadline reminders target assigned members and supervisor and are idempotent', async () => {
  const { sup } = await due();
  assert.equal(await refresh(), 4);
  assert.equal(await refresh(), 0);
  await actor(students[0]);
  const w = await rpc('fyp_engagement_workspace');
  assert.equal(w.reminders.length, 1);
  assert.equal(w.reminders[0].stage, '72h');
  await actor(students[3]);
  assert.equal((await rpc('fyp_engagement_workspace')).reminders.length, 0);
  await actor(sup);
  assert.equal((await rpc('fyp_engagement_workspace')).reminders.length, 1);
});
test('24-hour and overdue windows use current deadlines and hide superseded reminders', async () => {
  const { m } = await due(12);
  await refresh();
  await actor(students[0]);
  assert.equal((await rpc('fyp_engagement_workspace')).reminders[0].stage, '24h');
  await db.exec('reset role');
  await db.query("update fyp_core_v2.milestones set deadline=now()-interval '1 hour' where id=$1", [
    m,
  ]);
  await refresh();
  await actor(students[0]);
  const w = await rpc('fyp_engagement_workspace');
  assert.equal(w.reminders.length, 1);
  assert.equal(w.reminders[0].stage, 'overdue');
});
test('accepted, submitted student work and archived sessions stop surfacing reminders', async () => {
  const { m } = await due(-1);
  await refresh();
  await db.exec('reset role');
  await db.query("update fyp_core_v2.milestones set status='submitted' where id=$1", [m]);
  await actor(students[0]);
  assert.equal((await rpc('fyp_engagement_workspace')).reminders.length, 0);
  await db.exec('reset role');
  await db.query("update fyp_core_v2.milestones set status='accepted' where id=$1", [m]);
  await actor(sups[0]);
  assert.equal((await rpc('fyp_engagement_workspace')).reminders.length, 0);
  await db.exec('reset role');
  await db.query("update fyp_core_v2.milestones set status='not_started' where id=$1", [m]);
  await db.query('update fyp_core_v2.sessions set active=false where id=$1', [sid]);
  await actor(students[0]);
  assert.equal((await rpc('fyp_engagement_workspace')).reminders.length, 0);
});
test('opt-out and read markers are private and assignment changes revoke old reminders', async () => {
  const { g, sup } = await due();
  await refresh();
  await actor(students[0]);
  const reminder = (await rpc('fyp_engagement_workspace')).reminders[0];
  await actor(students[1]);
  await assert.rejects(
    rpc('fyp_engagement_action', ['read_reminder', { id: reminder.id }]),
    (e) => e.code === '42501',
  );
  await actor(students[0]);
  const w = await rpc('fyp_engagement_action', ['read_reminder', { id: reminder.id }]);
  assert(w.reminders[0].read_at);
  assert.equal(
    (await rpc('fyp_engagement_action', ['reminders_enabled', { enabled: false }])).reminders
      .length,
    0,
  );
  await db.exec('reset role');
  await db.query('update fyp_core_v2.allocations set supervisor_id=$1 where group_id=$2', [
    sups.find((x) => x !== sup),
    g,
  ]);
  await actor(sup);
  assert.equal((await rpc('fyp_engagement_workspace')).reminders.length, 0);
});
