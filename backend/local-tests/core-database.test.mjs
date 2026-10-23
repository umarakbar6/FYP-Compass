import { vector } from '@electric-sql/pglite-pgvector';
import { installAuthSessionFixture, setTestActor } from './auth-session-fixture.mjs';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
async function attest(student, path) {
  if (process.env.FYP_TEST_FULL_SCHEMA !== 'true') return;
  await actor(null, 'service_role');
  await rpc('fyp_ops_record_document', [student, path, 500, 'a'.repeat(64), 'application/pdf']);
  await actor(student);
}
async function uploaded(g, student = students[0], milestone = null) {
  const path = student + '/' + g + '/' + (milestone ? milestone + '/' : '') + 'evidence.pdf';
  await actor(student);
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)', [
    'fyp-v2-submissions',
    path,
    JSON.stringify({ size: 500 }),
  ]);
  await attest(student, path);
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
});
beforeEach(async () => {
  await db.exec(
    'reset role;truncate fyp_core_v2.sessions,fyp_core_v2.topics,fyp_core_v2.participants,fyp_core_v2.capacities,fyp_core_v2.templates,fyp_core_v2.groups,fyp_core_v2.members,fyp_core_v2.proposals,fyp_core_v2.allocations,fyp_core_v2.milestones,fyp_core_v2.submissions,fyp_core_v2.statements,fyp_core_v2.audit,fyp_health_v2.settings,fyp_health_v2.snapshots,fyp_health_v2.ratings,fyp_health_v2.contributions,fyp_health_v2.reports,fyp_health_v2.notices,fyp_health_v2.reads,fyp_health_v2.audit,fyp_assessment_v2.certifications,fyp_assessment_v2.defenses,fyp_assessment_v2.supervisor_marks,fyp_assessment_v2.assessments,fyp_assessment_v2.exclusions,fyp_assessment_v2.peer_reviews,fyp_assessment_v2.results,fyp_assessment_v2.audit,storage.objects cascade',
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
test('all migrations compile, profile roles cannot be elevated and anonymous core access is denied', async () => {
  await actor(students[0]);
  await assert.rejects(
    db.query("update public.fyp_profiles set role='coordinator' where id=$1", [students[0]]),
    (e) => e.code === '42501',
  );
  await assert.rejects(db.query('select * from fyp_core_v2.groups'), (e) => e.code === '42501');
  await actor(null, 'anon');
  await assert.rejects(rpc('fyp_v2_core_report'), (e) => e.code === '42501');
});
test('group limits, duplicate membership and session enrollment are enforced by the RPC', async () => {
  await actor(students[0]);
  await assert.rejects(
    rpc('fyp_v2_core_create_student_group', ['Four', sid, students.slice(1, 4)]),
  );
  await assert.rejects(rpc('fyp_v2_core_create_student_group', ['Self', sid, [students[0]]]));
  await group(students[0], [students[1], students[2]]);
  await actor(students[1]);
  await assert.rejects(rpc('fyp_v2_core_create_student_group', ['Duplicate', sid, []]));
  await actor(sups[0]);
  await assert.rejects(
    rpc('fyp_v2_core_create_student_group', ['Wrong role', sid, []]),
    (e) => e.code === '42501',
  );
});
test('proposal requires three distinct supervisors and at most three controlled tags', async () => {
  const g = await group();
  await assert.rejects(proposal(g, [sups[0], sups[0], sups[2]]));
  await assert.rejects(proposal(g, sups, topics));
  await assert.rejects(proposal(g, sups, [uid(999)]));
  await proposal(g);
  await assert.rejects(proposal(g));
  await actor(students[1]);
  await assert.rejects(proposal(g), (e) => e.code === '42501');
});
test('preference-first rounds prevent stronger-topic second choices displacing first choices', async () => {
  await config('capacity', {
    session_id: sid,
    supervisor_id: sups[0],
    max_groups: 1,
    topic_ids: topics.slice(0, 3),
  });
  for (const sup of sups.slice(1))
    await config('capacity', { session_id: sid, supervisor_id: sup, max_groups: 0, topic_ids: [] });
  const a = await group(students[0]);
  await proposal(a, sups, []);
  const b = await group(students[1]);
  await proposal(b, [sups[1], sups[0], sups[2]], topics.slice(0, 3));
  await actor(coord);
  await rpc('fyp_v2_core_match', ['stable']);
  const report = await rpc('fyp_v2_core_report');
  assert.equal(report.groups.find((g) => g.id === a).allocation.preference_rank, 1);
  assert.equal(report.groups.find((g) => g.id === b).allocation, null);
  assert.equal(report.capacities.find((c) => c.supervisor_id === sups[0]).allocated, 1);
});
test('original PRD first preference with zero tags defeats third preference with three tags', async () => {
  for (const sup of sups)
    await config('capacity', {
      session_id: sid,
      supervisor_id: sup,
      max_groups: sup === sups[0] ? 1 : 0,
      topic_ids: topics.slice(0, 3),
    });
  const first = await group(students[0]);
  await proposal(first, sups, []);
  const third = await group(students[1]);
  await proposal(third, [sups[1], sups[2], sups[0]], topics.slice(0, 3));
  await actor(coord);
  await rpc('fyp_v2_core_match', ['original-prd-preference']);
  const report = await rpc('fyp_v2_core_report');
  const winner = report.groups.find((g) => g.id === first).allocation;
  assert.equal(winner.preference_rank, 1);
  assert.equal(winner.topic_points, 0);
  assert.equal(winner.capacity_before, 1);
  assert.equal(report.groups.find((g) => g.id === third).allocation, null);
});

test('original PRD caps three shared tags at two points and records the repeatable seeded lottery', async () => {
  for (const sup of sups)
    await config('capacity', {
      session_id: sid,
      supervisor_id: sup,
      max_groups: sup === sups[0] ? 1 : 0,
      topic_ids: topics.slice(0, 3),
    });
  const two = await group(students[0]);
  const twoProposal = (await proposal(two, sups, topics.slice(0, 2))).proposal.id;
  const three = await group(students[1]);
  const threeProposal = (await proposal(three, sups, topics.slice(0, 3))).proposal.id;
  const hash = (s) => createHash('md5').update(s).digest('hex');
  let seed;
  for (let i = 0; i < 1000; i++) {
    const candidate = 'prd-cap-' + i;
    if (hash(candidate + ':' + twoProposal) < hash(candidate + ':' + threeProposal)) {
      seed = candidate;
      break;
    }
  }
  assert(seed);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await db.exec('reset role;delete from fyp_core_v2.allocations');
    await actor(coord);
    await rpc('fyp_v2_core_match', [seed]);
    const report = await rpc('fyp_v2_core_report');
    const winner = report.groups.find((g) => g.id === two).allocation;
    assert(winner, 'Two tags and three tags must tie at the cap; seed chooses two-tag proposal');
    assert.equal(winner.topic_points, 2);
    assert.equal(winner.shared_topic_count, 2);
    assert.equal(winner.capacity_before, 1);
    assert.equal(winner.lottery_used, true);
    assert.equal(winner.seed, seed);
    assert.match(winner.explanation, /topic tie points 2\/2/);
    assert.equal(report.groups.find((g) => g.id === three).allocation, null);
  }
});

test('stored seed repeats exact ties, capacities never overflow and manual changes need a reason', async () => {
  for (const sup of sups)
    await config('capacity', {
      session_id: sid,
      supervisor_id: sup,
      max_groups: 1,
      topic_ids: topics.slice(0, 3),
    });
  for (const student of students.slice(0, 5)) {
    const g = await group(student);
    await proposal(g);
  }
  await actor(coord);
  await rpc('fyp_v2_core_match', ['lottery']);
  const first = await rpc('fyp_v2_core_report');
  assert.equal(first.groups.filter((g) => g.allocation).length, 3);
  assert(first.capacities.every((c) => c.allocated <= c.max_groups));
  const expected = first.groups.map((g) => [g.id, g.allocation?.supervisor_id || null]).sort();
  await db.exec('reset role;delete from fyp_core_v2.allocations');
  await actor(coord);
  await rpc('fyp_v2_core_match', ['lottery']);
  const second = await rpc('fyp_v2_core_report');
  assert.deepEqual(
    second.groups.map((g) => [g.id, g.allocation?.supervisor_id || null]).sort(),
    expected,
  );
  const unmatched = second.groups.find((g) => !g.allocation);
  await assert.rejects(rpc('fyp_v2_core_manual_allocate', [unmatched.id, sups[0], '']));
  await assert.rejects(
    rpc('fyp_v2_core_manual_allocate', [unmatched.id, sups[0], 'Capacity exception']),
  );
  await assert.rejects(
    rpc('fyp_v2_core_configure', [
      'capacity',
      { session_id: sid, supervisor_id: sups[0], max_groups: 0, topic_ids: [] },
    ]),
  );
});
test('similarity requires human justification and approval creates one milestone plan', async () => {
  const a = await group(students[0]);
  const wa = await proposal(a);
  const b = await group(students[1]);
  const wb = await proposal(b);
  await actor(coord);
  await rpc('fyp_v2_core_match', ['seed']);
  await actor(students[1]);
  const alloc = (await rpc('fyp_v2_core_get_student_workspace')).allocation;
  await actor(alloc.supervisor_id);
  await rpc('fyp_v2_core_run_similarity_screen', [wb.proposal.id]);
  const w = await rpc('fyp_v2_core_get_supervisor_workspace');
  assert.equal(w.proposals.find((p) => p.id === wb.proposal.id).similarity.status, 'flagged');
  await assert.rejects(
    rpc('fyp_v2_core_review_supervisor_proposal', [wb.proposal.id, 'approve', '', '', 'submitted']),
  );
  await rpc('fyp_v2_core_review_supervisor_proposal', [
    wb.proposal.id,
    'approve',
    '',
    'Reviewed independent scope.',
    'submitted',
  ]);
  await assert.rejects(
    rpc('fyp_v2_core_review_supervisor_proposal', [
      wb.proposal.id,
      'approve',
      '',
      'Again',
      'submitted',
    ]),
  );
  const ms = await rpc('fyp_v2_core_get_milestone_workspace');
  assert.equal(ms.projects.find((p) => p.id === b).milestones.length, 1);
  assert(wa.proposal.id);
});
test('original PRD late submitted evidence and a separate overdue milestone remain distinct', async () => {
  await config('template', {
    session_id: sid,
    name: 'Implementation',
    description: 'Build evidence',
    days: 14,
  });
  const { g, sup } = await approved();
  await db.exec('reset role');
  await db.query(
    "update fyp_core_v2.milestones set deadline=now()-interval '1 day' where group_id=$1",
    [g],
  );
  await actor(students[0]);
  let workspace = await rpc('fyp_v2_core_get_milestone_workspace');
  const milestones = workspace.projects.find((p) => p.id === g).milestones;
  assert.equal(milestones.length, 2);
  const late = milestones[0],
    overdue = milestones[1];
  const doc = await uploaded(g, students[0], late.id);
  workspace = await rpc('fyp_v2_core_submit_student_milestone', [
    late.id,
    doc,
    'Late but genuine submitted evidence.',
    null,
  ]);
  assert.equal(
    workspace.projects.find((p) => p.id === g).milestones.find((m) => m.id === late.id).status,
    'submitted',
  );
  await actor(sup);
  const health = (await rpc('get_health_workspace')).projects.find((p) => p.id === g).health;
  assert.equal(health.level, 'red');
  assert(health.rules.some((r) => r.code === 'MILESTONE_LATE' && r.evidence.includes(late.name)));
  assert(
    health.rules.some((r) => r.code === 'MILESTONE_OVERDUE' && r.evidence.includes(overdue.name)),
  );
  assert(
    !health.rules.some((r) => r.code === 'MILESTONE_OVERDUE' && r.evidence.includes(late.name)),
  );
});

test('full group/proposal/matching/rework/contribution/health/assessment/result workflow works in PostgreSQL', async () => {
  const { g, sup } = await approved();
  let ms = await rpc('fyp_v2_core_get_milestone_workspace');
  const milestone = ms.projects[0].milestones[0].id;
  const doc = await uploaded(g, students[0], milestone);
  ms = await rpc('fyp_v2_core_submit_student_milestone', [milestone, doc, 'Original work.', null]);
  let submission = ms.projects[0].milestones[0].submissions[0].id;
  await actor(sup);
  await rpc('fyp_v2_core_review_supervisor_milestone', [
    milestone,
    submission,
    'needs_rework',
    'Add missing evidence.',
    'submitted',
  ]);
  const doc2 = { ...doc, path: students[0] + '/' + g + '/' + milestone + '/revision.pdf' };
  await actor(students[0]);
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)', [
    'fyp-v2-submissions',
    doc2.path,
    '{"size":500}',
  ]);
  await attest(students[0], doc2.path);
  ms = await rpc('fyp_v2_core_submit_student_milestone', [
    milestone,
    doc2,
    'Revised evidence.',
    submission,
  ]);
  submission = ms.projects[0].milestones[0].submissions.at(-1).id;
  for (const member of students.slice(1, 3)) {
    await actor(member);
    await rpc('fyp_v2_core_save_milestone_contribution', [
      milestone,
      submission,
      'My individual evidence.',
    ]);
  }
  await actor(sup);
  await rpc('fyp_v2_core_review_supervisor_milestone', [
    milestone,
    submission,
    'accepted',
    'Accepted.',
    'submitted',
  ]);
  const health = await rpc('get_health_workspace');
  assert.equal(health.projects.length, 1);
  assert.equal(health.projects[0].health.level, 'green');
  await rpc('fyp_v2_set_peer_due', [g, true]);
  for (const member of students.slice(0, 3)) {
    await actor(member);
    for (const other of students.slice(0, 3).filter((s) => s !== member))
      await rpc('fyp_v2_save_peer_rating', [g, other, 4]);
  }
  await actor(sup);
  const individual = [15, 12, 10].map((mark, i) => ({ student_id: students[i], mark }));
  await rpc('fyp_v2_save_supervisor_marks', [g, 8, 12, individual]);
  await rpc('fyp_v2_certify_defense', [g]);
  await actor(coord);
  const defense = await rpc('fyp_v2_schedule_defense', [
    g,
    new Date(Date.now() + 3600000).toISOString(),
    'Lab',
    true,
    ...exams,
  ]);
  for (const examiner of exams) {
    await actor(examiner);
    await rpc('fyp_v2_submit_examiner_marks', [
      defense.id,
      14,
      14,
      students.slice(0, 3).map((student_id, i) => ({ student_id, mark: 20 - i * 2 })),
      'Examined independently.',
    ]);
  }
  await actor(coord);
  await rpc('fyp_v2_finalize_results', [defense.id]);
  await rpc('fyp_v2_release_results', [defense.id]);
  await actor(students[0]);
  const result = await rpc('fyp_v2_assessment_workspace');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].total, 91);
  assert.equal(result.results[0].group_mark, 48);
});
test('new bucket resists broad legacy read/update/delete policies and file ownership spoofing', async () => {
  const { g, sup } = await approved();
  const doc = await uploaded(g);
  await actor(students[3]);
  const hidden = await db.query('select * from storage.objects');
  assert.equal(hidden.rows.length, 0);
  await assert.rejects(
    db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)', [
      'fyp-v2-submissions',
      students[0] + '/' + g + '/spoof.pdf',
      '{"size":500}',
    ]),
    (e) => e.code === '42501',
  );
  await actor(students[0]);
  assert.equal(
    (await db.query('update storage.objects set metadata=\'{"size":1}\'::jsonb returning *')).rows
      .length,
    0,
  );
  assert.equal((await db.query('delete from storage.objects returning *')).rows.length, 0);
  await actor(sup);
  assert.equal((await db.query('select * from storage.objects')).rows.length, 1);
  await actor(null, 'anon');
  assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
  assert(doc.path);
});
test('archived session membership does not prevent a new active-session group', async () => {
  await group();
  await config('session', { name: '2027', active: true });
  await actor(coord);
  const c = await rpc('fyp_v2_core_configuration');
  sid = c.sessions.find((s) => s.active).id;
  await config('enroll', { profile_id: students[0], session_id: sid });
  const newGroup = await group();
  assert(newGroup);
  await actor(coord);
  assert.equal((await rpc('fyp_v2_core_report')).groups.length, 2);
});
test('saving requested changes as a draft preserves the allocated supervisor workspace', async () => {
  const g = await group();
  const w = await proposal(g);
  const sup = await allocate(g);
  await actor(sup);
  await rpc('fyp_v2_core_review_supervisor_proposal', [
    w.proposal.id,
    'changes_requested',
    'Clarify scope.',
    '',
    'submitted',
  ]);
  await actor(students[0]);
  const edited = await rpc('fyp_v2_core_save_student_proposal', [
    g,
    'Updated scope',
    'Working revision',
    ['academic'],
    topics.slice(0, 3),
    sups,
    null,
    false,
  ]);
  assert.equal(edited.proposal.status, 'changes_requested');
  await actor(sup);
  const view = await rpc('fyp_v2_core_get_supervisor_workspace');
  assert.equal(view.proposals.length, 1);
  assert.equal(view.proposals[0].status, 'changes_requested');
  assert.equal(typeof view.proposals[0].submitted_at, 'string');
});

test('initial null upload metadata permits owned upload but cannot attach evidence until storage records actual size', async () => {
  const { g } = await approved();
  await actor(students[0]);
  const w = await rpc('fyp_v2_core_get_milestone_workspace');
  const milestone = w.projects[0].milestones[0].id;
  const name = students[0] + '/' + g + '/' + milestone + '/metadata-transition.pdf';
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,null)', [
    'fyp-v2-submissions',
    name,
  ]);
  const document = { name: 'metadata-transition.pdf', path: name, size: 500 };
  await assert.rejects(
    rpc('fyp_v2_core_submit_student_milestone', [milestone, document, 'Evidence.', null]),
    /missing or size differs/,
  );
  await db.exec('reset role');
  await db.query('update storage.objects set metadata=$1::jsonb where name=$2', [
    JSON.stringify({ size: 500 }),
    name,
  ]);
  await attest(students[0], name);
  await actor(students[0]);
  const submitted = await rpc('fyp_v2_core_submit_student_milestone', [
    milestone,
    document,
    'Evidence.',
    null,
  ]);
  assert.equal(submitted.projects[0].milestones[0].status, 'submitted');
});

// Report acceptance case compares RPC results with base PostgreSQL rows, not mocked totals.
test('accreditation aggregates match actual database rows and current health evidence', async () => {
  const { g } = await approved();
  await actor(coord);
  const report = await rpc('fyp_v2_core_accreditation');
  await db.exec('reset role');
  for (const [field, table] of [
    ['groups', 'groups'],
    ['milestones', 'milestones'],
    ['participants', 'participants'],
    ['capacities', 'capacities'],
    ['topics', 'topics'],
  ])
    assert.equal(
      report[field].length,
      Number((await db.query('select count(*) n from fyp_core_v2.' + table)).rows[0].n),
      field,
    );
  assert.equal(report.groups.find((x) => x.id === g).members.length, 3);
  assert.equal(report.health.length, 1);
  assert.equal(report.health[0].project_id, g);
  assert.equal(report.health[0].level, 'green');
  await db.query(
    "update fyp_core_v2.milestones set deadline=now()-interval '1 day' where group_id=$1",
    [g],
  );
  await actor(coord);
  const refreshed = await rpc('fyp_v2_core_accreditation');
  assert.equal(refreshed.health[0].level, 'red');
  assert.equal(refreshed.groups.filter((x) => x.allocation).length, 1);
});
