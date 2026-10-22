import { vector } from '@electric-sql/pglite-pgvector';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { test as runTest, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const test = (name, body) =>
  runTest(name, async () => {
    const trace = process.env.FYP_TEST_TRACE_FILE;
    const mark = (value) => {
      if (trace)
        fs.appendFileSync(trace, new Date().toISOString() + ' ' + value + ' ' + name + '\n');
    };
    mark('START');
    try {
      await body();
      mark('PASS');
    } catch (error) {
      mark('FAIL');
      throw error;
    }
  });
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
  db = new PGlite({ extensions: { vector } });
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;grant usage on schema auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create table auth.users(id uuid primary key);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;grant select on storage.objects to anon;create policy legacy_broad_storage on storage.objects for all to anon,authenticated using(true) with check(true);`,
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
  await db.exec(
    fs.readFileSync(
      new URL('../../supabase/migrations/20261010_production_guardrails.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(
    fs.readFileSync(
      new URL('../../supabase/migrations/20261010_coordinator_health.sql', import.meta.url),
      'utf8',
    ),
  );
  for (const name of [
    '20261011_review_hardening.sql',
    '20261011_peer_scale.sql',
    '20261011_roster.sql',
    '20261011_agents.sql',
    '20261011_pagination_calendar.sql',
    '20261011_group_locks.sql',
    '20261011_semantic.sql',
    '20261011_reminder_delivery.sql',
    '20261012_agent_context_aliases.sql',
    '20261012_agent_role_matrix.sql',
    '20261012_smtp_delivery.sql',
  ])
    await db.exec(
      fs.readFileSync(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8'),
    );
});
beforeEach(async () => {
  await db.exec(
    'reset role;truncate fyp_ops_v1.email_tests,fyp_agents_v1.runs,fyp_ops_v1.invites,fyp_ops_v1.client_events,fyp_ops_v1.ai_runs,fyp_ops_v1.documents,fyp_core_v2.sessions,fyp_core_v2.topics,fyp_core_v2.participants,fyp_core_v2.capacities,fyp_core_v2.templates,fyp_core_v2.groups,fyp_core_v2.members,fyp_core_v2.proposals,fyp_core_v2.allocations,fyp_core_v2.milestones,fyp_core_v2.submissions,fyp_core_v2.statements,fyp_core_v2.audit,fyp_health_v2.settings,fyp_health_v2.snapshots,fyp_health_v2.ratings,fyp_health_v2.contributions,fyp_health_v2.reports,fyp_health_v2.notices,fyp_health_v2.reads,fyp_health_v2.audit,fyp_assessment_v2.certifications,fyp_assessment_v2.defenses,fyp_assessment_v2.supervisor_marks,fyp_assessment_v2.assessments,fyp_assessment_v2.exclusions,fyp_assessment_v2.peer_reviews,fyp_assessment_v2.results,fyp_assessment_v2.audit,storage.objects cascade',
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

test('review migrations compile; agent and roster data remain private', async () => {
  await actor(students[0]);
  await assert.rejects(rpc('fyp_admin_roster'), (e) => e.code === '42501');
  await assert.rejects(rpc('fyp_agents_context', ['report', null]), (e) => e.code === '42501');
  await assert.rejects(db.query('select * from fyp_agents_v1.runs'));
  await actor(coord);
  assert.equal((await rpc('fyp_admin_roster')).actor_id, coord);
});
test('roster rejects coordinator roles, duplicate emails and altered retry batches', async () => {
  await actor(coord);
  const row = { email: 'new@example.test', full_name: 'New Student', role: 'student' },
    request = uid(800);
  await assert.rejects(
    rpc('fyp_admin_invite_reserve', [request, sid, [{ ...row, role: 'coordinator' }]]),
  );
  await assert.rejects(rpc('fyp_admin_invite_reserve', [request, sid, [row, row]]));
  const reserved = await rpc('fyp_admin_invite_reserve', [request, sid, [row]]);
  assert.equal(reserved.length, 1);
  assert.equal(
    (await rpc('fyp_admin_invite_reserve', [request, sid, [row]]))[0].id,
    reserved[0].id,
  );
  await assert.rejects(
    rpc('fyp_admin_invite_reserve', [request, sid, [{ ...row, role: 'examiner' }]]),
  );
});
test('service invitation completion binds actor and never overwrites existing profiles', async () => {
  await actor(coord);
  const [row] = await rpc('fyp_admin_invite_reserve', [
    uid(801),
    sid,
    [{ email: 'new@example.test', full_name: 'New Student', role: 'student' }],
  ]);
  await assert.rejects(rpc('fyp_admin_invite_finish', [row.id, coord, students[0], 'sent']));
  await actor(null, 'service_role');
  await assert.rejects(rpc('fyp_admin_invite_finish', [row.id, coord, students[0], 'sent']));
  await db.exec('reset role');
  const newId = uid(899);
  await db.query('insert into auth.users(id) values($1) on conflict do nothing', [newId]);
  await actor(null, 'service_role');
  await rpc('fyp_admin_invite_finish', [row.id, coord, newId, 'sent']);
  await db.exec('reset role');
  assert.equal(
    (await db.query('select role from public.fyp_profiles where id=$1', [newId])).rows[0].role,
    'student',
  );
  assert.equal(
    (
      await db.query(
        'select count(*)::int n from fyp_core_v2.participants where profile_id=$1 and session_id=$2',
        [newId, sid],
      )
    ).rows[0].n,
    1,
  );
});
test('agent evidence restricts cross-group access and support sees only documented knowledge', async () => {
  const { g, sup } = await approved();
  await actor(students[0]);
  const v = await rpc('fyp_agents_context', ['proposal', g]);
  assert.equal(v.evidence.project_id, g);
  await actor(students[3]);
  await assert.rejects(rpc('fyp_agents_context', ['proposal', g]), (e) => e.code === '42501');
  await actor(sups.find((x) => x !== sup));
  await assert.rejects(rpc('fyp_agents_context', ['document', g]), (e) => e.code === '42501');
  const support = await rpc('fyp_agents_context', ['support', null]);
  assert(support.evidence.knowledge.length);
  assert.equal(support.evidence.proposal, undefined);
});
test('agent reservations enforce budgets, private history and service-only completion', async () => {
  await actor(coord);
  const id = await rpc('fyp_agents_reserve', ['support', null, 'a'.repeat(64)]);
  await assert.rejects(rpc('fyp_agents_finish', [id, coord, { summary: 'draft' }, 'gemini']));
  await actor(null, 'service_role');
  await rpc('fyp_agents_finish', [id, coord, { summary: 'draft' }, 'gemini']);
  await actor(coord);
  assert.equal((await rpc('fyp_agents_history'))[0].source, 'gemini');
  for (let i = 0; i < 4; i++) await rpc('fyp_agents_reserve', ['qa', null, 'b'.repeat(64)]);
  await assert.rejects(
    rpc('fyp_agents_reserve', ['qa', null, 'b'.repeat(64)]),
    (e) => e.code === 'P0429',
  );
  await actor(students[0]);
  assert.deepEqual(await rpc('fyp_agents_history'), []);
});
test('safe browser event monitoring is bounded, deduplicated and coordinator-only', async () => {
  await actor(students[0]);
  await rpc('fyp_ops_record_client_error', ['browser_render_failure', uid(950)]);
  await rpc('fyp_ops_record_client_error', ['browser_render_failure', uid(950)]);
  await assert.rejects(rpc('fyp_ops_record_client_error', ['password_text', uid(951)]));
  await assert.rejects(rpc('fyp_ops_client_events'), (e) => e.code === '42501');
  await actor(coord);
  const events = await rpc('fyp_ops_client_events');
  assert.equal(events.length, 1);
  assert.equal(events[0].actor, undefined);
});
test('peer scale version maps the lowest rating to zero percent without altering marks', async () => {
  await actor(coord);
  const project = {
    id: uid(980),
    members: [{ id: students[0] }, { id: students[1] }],
    milestones: [],
  };
  const input = {
    project_id: project.id,
    peers_required: true,
    peers: [
      { member_id: students[0], ratings: [1], supervisor_percent: 40 },
      { member_id: students[1], ratings: [5], supervisor_percent: 100 },
    ],
  };
  await db.exec('reset role');
  const h = (
    await db.query('select fyp_health_v2.rules($1::jsonb,$2::jsonb,now()) value', [
      JSON.stringify(project),
      JSON.stringify(input),
    ])
  ).rows[0].value;
  assert(h.rules.some((r) => r.code === 'CONTRIBUTION_DIFFERENCE' && r.evidence.includes('0.00%')));
  assert.equal(JSON.parse(h.fingerprint).version, '2');
});

test('group writes use scoped locks and coordinator matching retains the global barrier', async () => {
  await db.exec('reset role');
  const rows = (
    await db.query(
      "select proname,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('fyp_v2_core_save_student_proposal','fyp_v2_core_match','fyp_v2_core_create_student_group')",
    )
  ).rows;
  assert(
    rows
      .find((r) => r.proname === 'fyp_v2_core_save_student_proposal')
      .definition.includes('lock_scope'),
  );
  assert(
    rows
      .find((r) => r.proname === 'fyp_v2_core_create_student_group')
      .definition.includes('lock_members'),
  );
  assert(
    rows.find((r) => r.proname === 'fyp_v2_core_match').definition.includes('fyp_core_v2.lock()'),
  );
});
test('paged enquiries search the complete inbox and deny students', async () => {
  await actor(students[0]);
  await assert.rejects(rpc('fyp_enquiries_page'), (e) => e.code === '42501');
  await db.exec('reset role');
  for (let i = 0; i < 45; i++)
    await db.query(
      "insert into fyp_engagement_v1.enquiries(request_id,full_name,email,plan,brief,consent,abuse_hash,created_at) values($1,$2,$3,'Basic','Synthetic paginated test enquiry.',true,$4,now()-($5||' minutes')::interval)",
      [uid(1000 + i), 'Person ' + i, 'p' + i + '@example.test', 'a'.repeat(64), i],
    );
  await actor(coord);
  const first = await rpc('fyp_enquiries_page');
  assert.equal(first.rows.length, 20);
  assert.equal(first.total, 45);
  assert.equal(first.has_more, true);
  const cursor = first.rows.at(-1);
  const second = await rpc('fyp_enquiries_page', [cursor.created_at, cursor.id, '', 'all', 20]);
  assert.equal(second.rows.length, 20);
  assert(!second.rows.some((r) => first.rows.some((a) => a.id === r.id)));
  assert.equal(
    (await rpc('fyp_enquiries_page', [null, null, 'Person 44', 'all', 20])).rows.length,
    1,
  );
});

test('SQL and TypeScript health rules stay aligned across peer scale edge cases', async () => {
  const { calculateHealth } = await import('../../src/health/rules.ts');
  const project = {
    id: uid(981),
    members: [
      { id: students[0], full_name: 'One' },
      { id: students[1], full_name: 'Two' },
    ],
    milestones: [],
  };
  await db.exec('reset role');
  for (const rating of [1, 2.5, 3, 4, 5])
    for (const percent of [0, 30, 50, 100]) {
      const input = {
        project_id: project.id,
        peers_required: true,
        peers: [
          { member_id: students[0], ratings: [rating], supervisor_percent: percent },
          { member_id: students[1], ratings: [5], supervisor_percent: 100 },
        ],
      };
      const now = Date.parse('2030-01-01T00:00:00Z');
      const ts = calculateHealth(project, input, now);
      const sql = (
        await db.query('select fyp_health_v2.rules($1::jsonb,$2::jsonb,$3::timestamptz) value', [
          JSON.stringify(project),
          JSON.stringify(input),
          new Date(now).toISOString(),
        ])
      ).rows[0].value;
      assert.equal(sql.level, ts.level);
      assert.deepEqual(sql.rules, ts.rules);
    }
});

test('semantic vectors remain service-only and student searches cannot expose other proposals', async () => {
  const { g, p } = await approved();
  const vector = '[' + [1, ...Array(767).fill(0)].join(',') + ']';
  await db.exec('reset role');
  const version = (
    await db.query(
      'select md5(title||chr(10)||abstract)as value from fyp_core_v2.proposals where id=$1',
      [p],
    )
  ).rows[0].value;
  await actor(students[0]);
  await assert.rejects(rpc('fyp_agents_cache_embedding', [students[0], p, vector, version]));
  await actor(null, 'service_role');
  await assert.rejects(rpc('fyp_agents_cache_embedding', [students[3], p, vector, version]));
  await rpc('fyp_agents_cache_embedding', [students[0], p, vector, version]);
  await actor(students[0]);
  assert.deepEqual(await rpc('fyp_agents_semantic_matches', [g, vector]), []);
  await assert.rejects(db.query('select * from fyp_agents_v1.proposal_embeddings'));
  await assert.rejects(rpc('fyp_agents_semantic_matches', [g, '[1,0]']));
});

test('availability is coordinator-controlled and rejects unknown participants and invalid windows', async () => {
  const start = new Date(Date.now() + 86400000).toISOString(),
    end = new Date(Date.now() + 90000000).toISOString();
  await actor(students[0]);
  await assert.rejects(rpc('fyp_schedule_availability', [sups[0], start, end]));
  await actor(coord);
  await assert.rejects(rpc('fyp_schedule_availability', [students[0], start, end]));
  const saved = await rpc('fyp_schedule_availability', [sups[0], start, end]);
  assert.equal(saved.windows.length, 1);
  assert.equal((await rpc('fyp_schedule_availability', [sups[0], start, end])).windows.length, 1);
  await rpc('fyp_schedule_remove_availability', [saved.windows[0].id]);
});
test('SQL reports paginate one session and students cannot access coordinator totals', async () => {
  await group();
  if (process.env.FYP_TEST_TRACE_FILE)
    fs.appendFileSync(process.env.FYP_TEST_TRACE_FILE, 'REPORT group ready\n');
  await actor(students[0]);
  await assert.rejects(rpc('fyp_reports_page', [sid, null, 20]));
  if (process.env.FYP_TEST_TRACE_FILE)
    fs.appendFileSync(process.env.FYP_TEST_TRACE_FILE, 'REPORT student denied\n');
  await actor(coord);
  const page = await rpc('fyp_reports_page', [sid, null, 1]);
  assert.equal(page.sql_totals.groups, 1);
  assert.equal(page.rows.length, 1);
  assert.equal((await rpc('fyp_reports_page', [sid, page.rows[0].id, 1])).rows.length, 0);
  await assert.rejects(rpc('fyp_reports_page', [sid, null, null]));
});
test('reminder delivery rechecks eligibility, opt-out and ownership of the approved AI draft', async () => {
  const { g } = await approved();
  await db.exec('reset role');
  await db.query(
    "update fyp_core_v2.milestones set deadline=now()+interval '1 hour'where group_id=$1",
    [g],
  );
  await db.query('select fyp_engagement_v1.refresh_reminders(true)');
  await actor(students[0]);
  const page = await rpc('fyp_reminders_page', [null, null, 25]);
  assert.equal(page.rows.length, 1);
  const reminder = page.rows[0].id;
  const run = await rpc('fyp_agents_reserve', ['nudge', null, 'f'.repeat(64)]);
  await actor(null, 'service_role');
  await rpc('fyp_agents_finish', [
    run,
    students[0],
    { summary: 'Review your current milestone', findings: [], actions: [], references: [] },
    'gemini',
  ]);
  await actor(students[1]);
  await assert.rejects(rpc('fyp_reminder_delivery_prepare', [reminder, run]));
  await actor(students[0]);
  const delivery = await rpc('fyp_reminder_delivery_prepare', [reminder, run]);
  assert.equal(delivery.status, 'reserved');
  assert.equal((await rpc('fyp_reminder_delivery_prepare', [reminder, run])).id, delivery.id);
  await rpc('fyp_engagement_action', ['reminders_enabled', { enabled: false }]);
  assert.equal((await rpc('fyp_reminders_page', [null, null, 25])).total, 0);
  await assert.rejects(rpc('fyp_reminder_delivery_prepare', [reminder, run]));
});

test('reallocation hides old actor drafts and prevents finishing a revoked project review', async () => {
  const { g, sup } = await approved();
  await actor(sup);
  const saved = await rpc('fyp_agents_reserve', ['proposal', g, 'a'.repeat(64)]);
  await actor(null, 'service_role');
  await rpc('fyp_agents_finish', [
    saved,
    sup,
    { summary: 'Private review', findings: [], actions: [], references: [] },
    'gemini',
  ]);
  await actor(sup);
  assert.equal((await rpc('fyp_agents_history')).length, 1);
  const pending = await rpc('fyp_agents_reserve', ['proposal', g, 'b'.repeat(64)]);
  await db.exec('reset role');
  await db.query('update fyp_core_v2.allocations set supervisor_id=$1 where group_id=$2', [
    sups.find((s) => s !== sup),
    g,
  ]);
  await actor(sup);
  assert.deepEqual(await rpc('fyp_agents_history'), []);
  await actor(null, 'service_role');
  await assert.rejects(
    rpc('fyp_agents_finish', [
      pending,
      sup,
      { summary: 'Revoked', findings: [], actions: [], references: [] },
      'gemini',
    ]),
    (e) => e.code === '42501',
  );
  await rpc('fyp_agents_finish', [pending, sup, null, 'failed']);
});

test('matching and scheduler contexts resolve SQL aliases and return bounded arrays', async () => {
  await approved();
  await actor(coord);
  for (const kind of ['matching', 'scheduler']) {
    const context = await rpc('fyp_agents_context', [kind, null]);
    assert.equal(context.kind, kind);
    for (const key of ['groups', 'capacities', 'sessions'])
      assert(Array.isArray(context.evidence[key]), key);
    if (kind === 'matching') assert(context.evidence.proposal_text.length <= 20);
    else assert(Array.isArray(context.evidence.readiness));
  }
});

// Role checks must precede budget consumption and any external provider request.
test('every assistant role boundary rejects contexts and reservations before export', async () => {
  const kinds = [
    'matching',
    'proposal',
    'document',
    'nudge',
    'digest',
    'scheduler',
    'report',
    'support',
    'qa',
  ];
  const allowed = {
    student: ['proposal', 'document', 'nudge', 'support'],
    supervisor: ['proposal', 'document', 'nudge', 'digest', 'support'],
    examiner: ['support'],
    coordinator: ['matching', 'scheduler', 'report', 'support', 'qa'],
  };
  for (const [role, id] of [
    ['student', students[0]],
    ['supervisor', sups[0]],
    ['examiner', exams[0]],
    ['coordinator', coord],
  ]) {
    await actor(id);
    for (const kind of kinds.filter((k) => !allowed[role].includes(k))) {
      await assert.rejects(rpc('fyp_agents_context', [kind, null]), (e) => e.code === '42501');
      await assert.rejects(
        rpc('fyp_agents_reserve', [kind, null, 'a'.repeat(64)]),
        (e) => e.code === '42501',
      );
    }
  }
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from fyp_agents_v1.runs')).rows[0].n, 0);
});

test('SMTP claim is service-only, rechecks eligibility and cannot repeat an attempted delivery', async () => {
  const { g } = await approved();
  await db.exec('reset role');
  await db.query("update fyp_core_v2.milestones set deadline=now()+interval '1 hour' where group_id=$1",[g]);
  await db.query('select fyp_engagement_v1.refresh_reminders(true)');
  await actor(students[0]);
  await rpc('fyp_engagement_action',['reminders_enabled',{enabled:true}]);
  await db.exec('reset role');
  await db.query('select fyp_engagement_v1.refresh_reminders(true)');
  await actor(students[0]);
  const reminder=(await rpc('fyp_reminders_page',[null,null,25])).rows[0].id;
  const run=await rpc('fyp_agents_reserve',['nudge',null,'f'.repeat(64)]);
  await actor(null,'service_role');
  await rpc('fyp_agents_finish',[run,students[0],{summary:'Review your current milestone',findings:[],actions:[],references:[]},'gemini']);
  await actor(students[0]);
  const delivery=await rpc('fyp_reminder_delivery_prepare',[reminder,run]);
  await assert.rejects(rpc('fyp_reminder_smtp_claim',[delivery.id,students[0]]));
  await actor(null,'service_role');
  await assert.rejects(rpc('fyp_reminder_smtp_claim',[delivery.id,students[1]]));
  assert.equal(await rpc('fyp_reminder_smtp_claim',[delivery.id,students[0]]),true);
  assert.equal(await rpc('fyp_reminder_smtp_claim',[delivery.id,students[0]]),false);
  await rpc('fyp_reminder_delivery_finish',[delivery.id,students[0],'failed']);
  assert.equal(await rpc('fyp_reminder_smtp_claim',[delivery.id,students[0]]),false);
  await actor(students[0]);
  await rpc('fyp_engagement_action',['reminders_enabled',{enabled:false}]);
  await actor(null,'service_role');
  await assert.rejects(rpc('fyp_reminder_smtp_claim',[delivery.id,students[0]]));
});
test('email diagnostics require server coordinator authorization, unique attempts and daily limits', async () => {
  await actor(coord);await assert.rejects(rpc('fyp_email_test_prepare',[uid(900),coord]));
  await actor(null,'service_role');await assert.rejects(rpc('fyp_email_test_prepare',[uid(900),students[0]]));
  const first=await rpc('fyp_email_test_prepare',[uid(900),coord]);assert.equal(first.claimed,true);
  assert.equal((await rpc('fyp_email_test_prepare',[uid(900),coord])).claimed,false);
  await rpc('fyp_email_test_finish',[uid(900),coord,'sent']);
  assert.equal((await rpc('fyp_email_test_prepare',[uid(900),coord])).status,'sent');
  for(const n of [901,902]) assert.equal((await rpc('fyp_email_test_prepare',[uid(n),coord])).claimed,true);
  await assert.rejects(rpc('fyp_email_test_prepare',[uid(903),coord]));
});
