import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

const ids = {
  coordinator: '00000000-0000-4000-8000-000000000001',
  supervisor: '00000000-0000-4000-8000-000000000002',
  student: '00000000-0000-4000-8000-000000000003',
  outsider: '00000000-0000-4000-8000-000000000004',
  examiner: '00000000-0000-4000-8000-000000000005',
  examinerTwo: '00000000-0000-4000-8000-000000000006',
  group: '10000000-0000-4000-8000-000000000001',
  proposal: '20000000-0000-4000-8000-000000000001',
  defense: '30000000-0000-4000-8000-000000000001',
};
let db;
async function actor(id, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('test.actor',$1,false)", [id || '']);
  await db.exec('set role ' + role);
}
async function rpc(name, args = []) {
  const values = args.map((value) =>
    typeof value === 'object' && value !== null ? JSON.stringify(value) : value,
  );
  return (
    await db.query(
      `select public.${name}(${args.map((_, index) => '$' + (index + 1)).join(',')}) value`,
      values,
    )
  ).rows[0].value;
}
const criteria = [
  ['proposal_method', 'proposal', 'Research method', 4],
  ['proposal_scope', 'proposal', 'Scope and feasibility', 6],
  ['progress_evidence', 'progress', 'Progress evidence', 15],
  ['contribution_evidence', 'contribution', 'Contribution evidence', 15],
  ['report_quality', 'report', 'Report quality', 15],
  ['implementation_quality', 'implementation', 'Implementation quality', 15],
  ['viva_quality', 'viva', 'Viva quality', 20],
].map(([id, component, label, points]) => ({ id, component, label, guidance: '', points }));

before(async () => {
  db = new PGlite();
  await db.exec(`
create role anon;create role authenticated;create role service_role;
create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
create table public.fyp_profiles(id uuid primary key,role text not null,full_name text not null);
create schema fyp_core_v2;
create table fyp_core_v2.groups(id uuid primary key,name text not null);
create table fyp_core_v2.members(group_id uuid,student_id uuid,primary key(group_id,student_id));
create table fyp_core_v2.allocations(group_id uuid primary key,supervisor_id uuid);
create table fyp_core_v2.proposals(id uuid primary key,group_id uuid,title text,feedback text,review jsonb);
create table fyp_core_v2.milestones(id uuid primary key,group_id uuid);
create table fyp_core_v2.submissions(id uuid primary key,milestone_id uuid,review jsonb);
create function fyp_core_v2.role(expected text default null) returns text language plpgsql stable security definer set search_path='' as $$declare r text;begin select role into r from public.fyp_profiles where id=auth.uid();if r is null or(expected is not null and r<>expected)then raise exception 'Denied' using errcode='42501';end if;return r;end$$;
create function fyp_core_v2.proposal(g uuid) returns fyp_core_v2.proposals language sql stable security definer set search_path='' as $$select p from fyp_core_v2.proposals p where group_id=g limit 1$$;
create function fyp_core_v2.members(g uuid) returns jsonb language sql stable security definer set search_path='' as $$select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name)),'[]')from fyp_core_v2.members m join public.fyp_profiles p on p.id=m.student_id where group_id=g$$;
create schema fyp_health_v2;create function fyp_health_v2.role()returns text language sql stable security definer set search_path='' as $$select fyp_core_v2.role()$$;
create function fyp_health_v2.project(pid text,refresh boolean)returns jsonb language plpgsql security definer set search_path='' as $$declare g uuid:=pid::uuid;r text;begin r:=fyp_core_v2.role();if r='supervisor' and not exists(select 1 from fyp_core_v2.allocations where group_id=g and supervisor_id=auth.uid())then raise exception 'Denied' using errcode='42501';end if;return jsonb_build_object('id',g,'title',(select title from fyp_core_v2.proposals where group_id=g),'members',fyp_core_v2.members(g));end$$;
create schema fyp_assessment_v2;
create table fyp_assessment_v2.supervisor_marks(project_id text primary key,proposal numeric,progress numeric,individual jsonb,updated_at timestamptz default now());
create table fyp_assessment_v2.defenses(id uuid primary key,project_id text,project jsonb,examiner_one uuid,examiner_two uuid);
create table fyp_assessment_v2.assessments(defense_id uuid,examiner uuid,report numeric,implementation numeric,viva jsonb,comments text,submitted_at timestamptz,primary key(defense_id,examiner));
create function fyp_assessment_v2.cached(pid text)returns jsonb language sql security definer set search_path='' as $$select jsonb_build_object('id',pid)$$;
create function public.fyp_v2_save_supervisor_marks(pid text,proposal numeric,progress numeric,individual jsonb)returns jsonb language plpgsql security definer set search_path='' as $$begin perform fyp_core_v2.role('supervisor');insert into fyp_assessment_v2.supervisor_marks(project_id,proposal,progress,individual)values(pid,proposal,progress,individual)on conflict(project_id)do update set proposal=excluded.proposal,progress=excluded.progress,individual=excluded.individual;return '{}'::jsonb;end$$;
create function public.fyp_v2_submit_examiner_marks(did uuid,report numeric,implementation numeric,viva jsonb,comments text)returns jsonb language plpgsql security definer set search_path='' as $$declare d fyp_assessment_v2.defenses;begin perform fyp_core_v2.role('examiner');select*into d from fyp_assessment_v2.defenses where id=did;if auth.uid() not in(d.examiner_one,d.examiner_two)then raise exception 'Denied' using errcode='42501';end if;insert into fyp_assessment_v2.assessments values(did,auth.uid(),report,implementation,viva,comments,now());return '{}'::jsonb;end$$;
create function public.fyp_v2_assessment_workspace()returns jsonb language sql security definer set search_path='' as $$select jsonb_build_object('actor_id',auth.uid(),'projects','[]'::jsonb,'defenses','[]'::jsonb,'results','[]'::jsonb,'examiners','[]'::jsonb)$$;
`);
  for (const [name, id] of Object.entries(ids).filter(
    ([name]) => !['group', 'proposal', 'defense'].includes(name),
  ))
    await db.query('insert into public.fyp_profiles values($1,$2,$3)', [
      id,
      name === 'coordinator'
        ? 'coordinator'
        : name === 'supervisor'
          ? 'supervisor'
          : name.startsWith('examiner')
            ? 'examiner'
            : 'student',
      name,
    ]);
  await db.query('insert into fyp_core_v2.groups values($1,$2)', [ids.group, 'Team Compass']);
  await db.query('insert into fyp_core_v2.members values($1,$2)', [ids.group, ids.student]);
  await db.query('insert into fyp_core_v2.allocations values($1,$2)', [ids.group, ids.supervisor]);
  await db.query('insert into fyp_core_v2.proposals values($1,$2,$3,null,null)', [
    ids.proposal,
    ids.group,
    'FYP Compass',
  ]);
  await db.exec(
    fs.readFileSync(
      new URL('../../supabase/migrations/20261014_governance_v1.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.query('insert into fyp_assessment_v2.defenses values($1,$2,$3::jsonb,$4,$5)', [
    ids.defense,
    ids.group,
    JSON.stringify({ id: ids.group, members: [{ id: ids.student, full_name: 'student' }] }),
    ids.examiner,
    ids.examinerTwo,
  ]);
});
after(async () => db?.close());

test('coordinator versions a valid rubric while other roles cannot', async () => {
  await actor(ids.coordinator);
  let workspace = await rpc('fyp_governance_save_rubric', [
    'Evidence rubric',
    'Auditable criteria',
    criteria,
  ]);
  assert.equal(workspace.active_rubric.version, 2);
  assert.equal(workspace.active_rubric.criteria.length, 7);
  await actor(ids.student);
  await assert.rejects(
    rpc('fyp_governance_save_rubric', ['Forged', 'No access', criteria]),
    (error) => error.code === '42501',
  );
});

test('meeting request, confirmation and minutes preserve role boundaries and versions', async () => {
  await actor(ids.student);
  let workspace = await rpc('fyp_governance_book_meeting', [
    ids.group,
    new Date(Date.now() + 3600000).toISOString(),
    45,
    'Room One',
    'Review evaluation plan',
  ]);
  const meeting = workspace.meetings[0];
  assert.equal(meeting.status, 'requested');
  await actor(ids.outsider);
  await assert.rejects(
    rpc('fyp_governance_update_meeting', [meeting.id, 1, 'cancel', null, null, null, [], []]),
    (error) => error.code === '42501',
  );
  await actor(ids.supervisor);
  workspace = await rpc('fyp_governance_update_meeting', [
    meeting.id,
    1,
    'confirm',
    null,
    null,
    null,
    [],
    [],
  ]);
  assert.equal(workspace.meetings[0].status, 'scheduled');
  workspace = await rpc('fyp_governance_update_meeting', [
    meeting.id,
    2,
    'complete',
    null,
    null,
    'Reviewed the evaluation plan.',
    ['Use held out data.'],
    ['Student will add evaluation evidence.'],
  ]);
  assert.equal(workspace.meetings[0].status, 'completed');
  assert.deepEqual(workspace.meetings[0].action_items, ['Student will add evaluation evidence.']);
});

test('feedback requires a student response and supervisor verification', async () => {
  await actor(ids.supervisor);
  let workspace = await rpc('fyp_governance_create_feedback', [
    ids.group,
    'general',
    'manual-one',
    'Evaluation evidence',
    'Add reproducible test results.',
  ]);
  const item = workspace.feedback[0];
  await actor(ids.student);
  workspace = await rpc('fyp_governance_respond_feedback', [
    item.id,
    item.version,
    'Added a held out test table and methodology.',
  ]);
  assert.equal(workspace.feedback[0].status, 'addressed');
  await actor(ids.supervisor);
  workspace = await rpc('fyp_governance_review_feedback', [item.id, item.version + 1, 'verify']);
  assert.equal(workspace.feedback[0].status, 'verified');
  await assert.rejects(
    rpc('fyp_governance_review_feedback', [item.id, item.version + 1, 'reopen']),
    (error) => error.code === '40001',
  );
});

test('criterion scores aggregate into legacy totals and retain the rubric snapshot', async () => {
  await actor(ids.supervisor);
  const supervisorScores = {
    proposal: { proposal_method: 3, proposal_scope: 5 },
    progress: { progress_evidence: 13 },
    contribution: { [ids.student]: { contribution_evidence: 14 } },
  };
  await rpc('fyp_governance_save_supervisor_marks', [ids.group, supervisorScores]);
  await db.exec('reset role');
  let row = (
    await db.query(
      'select proposal,progress,individual,rubric_snapshot from fyp_assessment_v2.supervisor_marks',
    )
  ).rows[0];
  assert.equal(Number(row.proposal), 8);
  assert.equal(Number(row.progress), 13);
  assert.equal(Number(row.individual[0].mark), 14);
  assert.equal(row.rubric_snapshot.version, 2);
  await actor(ids.examiner);
  const examinerScores = {
    report: { report_quality: 13 },
    implementation: { implementation_quality: 14 },
    viva: { [ids.student]: { viva_quality: 18 } },
  };
  await rpc('fyp_governance_submit_examiner_marks', [
    ids.defense,
    examinerScores,
    'Evidence reviewed.',
  ]);
  await db.exec('reset role');
  row = (
    await db.query(
      'select report,implementation,viva,rubric_snapshot from fyp_assessment_v2.assessments',
    )
  ).rows[0];
  assert.equal(Number(row.report), 13);
  assert.equal(Number(row.implementation), 14);
  assert.equal(Number(row.viva[0].mark), 18);
  assert.equal(row.rubric_snapshot.version, 2);
});
