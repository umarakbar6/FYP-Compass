import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
const uid = (n) => '90000000-0000-4000-8000-' + String(n).padStart(12, '0');
const coordinator = uid(1),
  supervisors = [uid(2), uid(3), uid(4)],
  students = [uid(100), uid(101), uid(102), uid(103)];
let db, sid;
async function actor(id, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('test.actor',$1,false)", [id || '']);
  await db.exec('set role ' + role);
}
async function rpc(name, args = []) {
  return (
    await db.query(
      'select public.' + name + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') value',
      args.map((a) => (a && typeof a === 'object' && !Array.isArray(a) ? JSON.stringify(a) : a)),
    )
  ).rows[0].value;
}
async function register(id, name = 'Real Student', confirmed = false, extra = {}) {
  await db.exec('reset role');
  await db.query(
    'insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,$3,$4::jsonb)',
    [
      id,
      id + '@example.test',
      confirmed ? new Date().toISOString() : null,
      JSON.stringify({ full_name: name, registration_source: 'student_self_service_v1', ...extra }),
    ],
  );
}
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 grant usage on schema auth,storage to anon,authenticated;grant execute on function auth.uid()to anon,authenticated;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid()primary key,bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const id of [coordinator, ...supervisors])
    await db.query('insert into auth.users(id,email_confirmed_at)values($1,now())', [id]);
  await db.exec(fs.readFileSync(new URL('../INSTALL-ALL-V2.sql', import.meta.url), 'utf8'));
  for (const id of [coordinator, ...supervisors])
    await db.query('insert into public.fyp_profiles values($1,$2,$3)', [
      id,
      id === coordinator ? 'Coordinator' : 'Supervisor',
      id === coordinator ? 'coordinator' : 'supervisor',
    ]);
  await db.exec(
    fs.readFileSync(
      new URL('../../supabase/migrations/202610140003_student_registration.sql', import.meta.url),
      'utf8',
    ),
  );
  await actor(coordinator);
  const config = await rpc('fyp_v2_core_configure', [
    'session',
    { name: 'Academic 2026', active: true },
  ]);
  sid = config.sessions[0].id;
  for (const supervisor of supervisors)
    await rpc('fyp_v2_core_configure', [
      'capacity',
      { session_id: sid, supervisor_id: supervisor, max_groups: 10, topic_ids: [] },
    ]);
});
after(async () => db?.close());
test('email confirmation creates own student profile and enrollment; unverified users are blocked', async () => {
  await register(students[0], 'Real Student');
  assert.equal(
    (await db.query('select count(*)::int n from public.fyp_profiles where id=$1', [students[0]]))
      .rows[0].n,
    0,
  );
  await actor(students[0]);
  await assert.rejects(rpc('fyp_v2_core_get_student_workspace'), (e) => e.code === '42501');
  await db.exec('reset role');
  await db.query('update auth.users set email_confirmed_at=now()where id=$1', [students[0]]);
  const profile = (await db.query('select*from public.fyp_profiles where id=$1', [students[0]]))
    .rows[0];
  assert.equal(profile.role, 'student');
  assert.equal(profile.full_name, 'Real Student');
  await actor(students[0]);
  const w = await rpc('fyp_v2_core_get_student_workspace');
  assert.equal(w.session.id, sid);
  assert.equal(w.group, null);
  assert.equal(w.proposal, null);
});
test('metadata cannot grant staff roles and verification cannot overwrite an existing owner', async () => {
  await register(students[1], 'New Student', true, { role: 'coordinator', is_admin: true });
  assert.equal(
    (await db.query('select role from public.fyp_profiles where id=$1', [students[1]])).rows[0]
      .role,
    'student',
  );
  await db.query(
    'update auth.users set raw_user_meta_data=$2::jsonb,email_confirmed_at=now()where id=$1',
    [
      coordinator,
      JSON.stringify({
        registration_source: 'student_self_service_v1',
        full_name: 'Forged',
        role: 'student',
      }),
    ],
  );
  const owner = (await db.query('select*from public.fyp_profiles where id=$1', [coordinator]))
    .rows[0];
  assert.equal(owner.role, 'coordinator');
  assert.equal(owner.full_name, 'Coordinator');
  await actor(students[1]);
  await assert.rejects(rpc('fyp_v2_core_configuration'), (e) => e.code === '42501');
});
test('a new verified student submits their own proposal and cannot access another group', async () => {
  await actor(students[0]);
  const w = await rpc('fyp_v2_core_create_student_group', ['Real Project Team', sid, []]);
  const saved = await rpc('fyp_v2_core_save_student_proposal', [
    w.group.id,
    'Campus water quality monitoring',
    'A student authored IoT project measuring water quality and issuing evidence based alerts.',
    ['water', 'iot'],
    [],
    supervisors,
    null,
    true,
  ]);
  assert.equal(saved.proposal.title, 'Campus water quality monitoring');
  assert.equal(saved.proposal.status, 'submitted');
  await actor(students[1]);
  assert.equal((await rpc('fyp_v2_core_get_student_workspace')).proposal, null);
  await assert.rejects(
    rpc('fyp_v2_core_save_student_proposal', [
      w.group.id,
      'Other project',
      'Should not overwrite',
      ['privacy'],
      [],
      supervisors,
      null,
      true,
    ]),
    (e) => e.code === '42501',
  );
});
test('enrollment is idempotent and retries work after an active session is configured', async () => {
  await db.exec('reset role');
  await db.exec('update fyp_core_v2.sessions set active=false');
  await register(students[2], 'Future Student', true);
  await actor(students[2]);
  assert.equal((await rpc('fyp_v2_core_get_student_workspace')).session, null);
  await actor(coordinator);
  await rpc('fyp_v2_core_configure', ['activate_session', { id: sid }]);
  await actor(students[2]);
  await rpc('fyp_v2_core_get_student_workspace');
  await rpc('fyp_v2_core_get_student_workspace');
  await db.exec('reset role');
  assert.equal(
    (
      await db.query(
        'select count(*)::int n from fyp_core_v2.participants where profile_id=$1 and session_id=$2',
        [students[2], sid],
      )
    ).rows[0].n,
    1,
  );
});
test('anonymous access, direct profile promotion and the private enrollment helper are denied', async () => {
  await actor(null, 'anon');
  await assert.rejects(rpc('fyp_v2_core_get_student_workspace'), (e) => e.code === '42501');
  await actor(students[0]);
  await assert.rejects(
    db.query("update public.fyp_profiles set role='coordinator'where id=$1", [students[0]]),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    db.query('select fyp_registration_v1.enroll_verified_student($1)', [students[1]]),
    (e) => e.code === '42501',
  );
});
test('staff invitation without public registration marker keeps the invitation role assignment path', async () => {
  await db.exec('reset role');
  await db.query(
    'insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)values($1,$2,now(),$3::jsonb)',
    [students[3], 'invited@example.test', JSON.stringify({ full_name: 'Invited Staff' })],
  );
  assert.equal(
    (await db.query('select count(*)::int n from public.fyp_profiles where id=$1', [students[3]]))
      .rows[0].n,
    0,
  );
});

test('SQL-shaped names and proposal fields remain literal data and cannot promote the student', async () => {
  const payload = "Research'); update public.fyp_profiles set role='coordinator'; --";
  await db.exec('reset role');
  const before = (await db.query('select count(*)::int n from public.fyp_profiles')).rows[0].n;
  await actor(students[2]);
  const workspace = await rpc('fyp_v2_core_create_student_group', [payload, sid, []]);
  const saved = await rpc('fyp_v2_core_save_student_proposal', [
    workspace.group.id,
    payload,
    'Synthetic security regression: ' + payload,
    ['security'],
    [],
    supervisors,
    null,
    true,
  ]);
  assert.equal(saved.group.name, payload);
  assert.equal(saved.proposal.title, payload);
  assert.equal(saved.proposal.abstract, 'Synthetic security regression: ' + payload);
  await assert.rejects(rpc('fyp_v2_core_configuration'), (e) => e.code === '42501');
  await db.exec('reset role');
  const profile = (await db.query('select role from public.fyp_profiles where id=$1', [students[2]])).rows[0];
  assert.equal(profile.role, 'student');
  assert.equal((await db.query('select count(*)::int n from public.fyp_profiles')).rows[0].n, before);
});
