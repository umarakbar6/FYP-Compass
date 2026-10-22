import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const alice = '00000000-0000-4000-8000-000000000001';
const bob = '00000000-0000-4000-8000-000000000002';
const session = '00000000-0000-4000-8000-000000000003';
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create role authenticator;
 create schema auth;create schema fyp_core_v2;create schema fyp_health_v2;create schema fyp_ops_v1;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
 create table public.fyp_profiles(id uuid primary key,role text,full_name text);
 alter table public.fyp_profiles enable row level security;
 grant select on public.fyp_profiles to authenticated;
 create policy own_profile on public.fyp_profiles for select to authenticated using(id=auth.uid());
 create table fyp_ops_v1.release_migrations(name text primary key);
 insert into public.fyp_profiles values('${alice}','student','Alice'),('${bob}','coordinator','Bob');
 insert into auth.sessions values('${session}','${alice}',null);`);
  await db.exec(
    fs.readFileSync(
      new URL('../../supabase/migrations/202610160001_active_sessions.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(
    fs.readFileSync(
      new URL('../../supabase/migrations/202610160002_privacy_requests.sql', import.meta.url),
      'utf8',
    ),
  );
});
after(async () => db?.close());
async function actor(id, claims) {
  await db.exec('reset role');
  await db.query(
    "select set_config('test.actor',$1,false),set_config('request.jwt.claims',$2,false)",
    [id || '', JSON.stringify(claims)],
  );
  await db.exec('set role authenticated');
}
test('a live authenticated session exposes only its own profile', async () => {
  await actor(alice, { role: 'authenticated', session_id: session });
  assert.equal((await db.query('select public.fyp_session_active() as ok')).rows[0].ok, true);
  assert.deepEqual((await db.query('select id from public.fyp_profiles')).rows, [{ id: alice }]);
  await db.query('select public.fyp_check_request()');
});
test('a session belonging to another account cannot be replayed', async () => {
  await actor(bob, { role: 'authenticated', session_id: session });
  assert.equal((await db.query('select public.fyp_session_active() as ok')).rows[0].ok, false);
  await assert.rejects(db.query('select public.fyp_check_request()'), (e) => e.code === '42501');
});
test('missing, malformed and incorrectly scoped session claims fail closed', async () => {
  for (const claims of [
    { role: 'authenticated' },
    { role: 'authenticated', session_id: 'invalid' },
    { role: 'anon', session_id: session },
    { role: 'service_role', session_id: session },
  ]) {
    await actor(alice, claims);
    assert.equal((await db.query('select public.fyp_session_active() as ok')).rows[0].ok, false);
    assert.equal((await db.query('select * from public.fyp_profiles')).rows.length, 0);
  }
});
test('expired sessions and revoked JWTs cannot read profiles or enter RPCs', async () => {
  await db.exec('reset role');
  await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [
    session,
  ]);
  await actor(alice, { role: 'authenticated', session_id: session });
  await assert.rejects(db.query('select public.fyp_check_request()'), (e) => e.code === '42501');
  await db.exec('reset role');
  await db.query('delete from auth.sessions where id=$1', [session]);
  await actor(alice, { role: 'authenticated', session_id: session });
  assert.equal((await db.query('select * from public.fyp_profiles')).rows.length, 0);
  await assert.rejects(db.query('select public.fyp_check_request()'), (e) => e.code === '42501');
});
test('internal session records remain unreadable and the release ledger has RLS', async () => {
  await actor(alice, { role: 'authenticated', session_id: session });
  await assert.rejects(db.query('select * from auth.sessions'), (e) => e.code === '42501');
  await db.exec('reset role');
  assert.equal(
    (
      await db.query(
        "select relrowsecurity from pg_class where oid='fyp_ops_v1.release_migrations'::regclass",
      )
    ).rows[0].relrowsecurity,
    true,
  );
  const config = (await db.query("select rolconfig from pg_roles where rolname='authenticator'"))
    .rows[0].rolconfig;
  assert(config.includes('pgrst.db_pre_request=public.fyp_check_request'));
});
test('anonymous public calls remain available without allowing session impersonation', async () => {
  await db.exec('reset role');
  await db.query(
    "select set_config('test.actor','',false),set_config('request.jwt.claims',$1,false)",
    [JSON.stringify({ role: 'anon' })],
  );
  await db.exec('set role anon');
  await db.query('select public.fyp_check_request()');
  await assert.rejects(db.query('select public.fyp_session_active()'), (e) => e.code === '42501');
});

test('privacy requests are bound to the caller, isolated from other students and deny raw table access', async () => {
  await db.exec('reset role');
  await db.exec(
    `insert into auth.sessions values('${alice}','${alice}',null),('${bob}','${bob}',null) on conflict do nothing`,
  );
  await actor(alice, { role: 'authenticated', session_id: alice });
  await assert.rejects(
    db.query("select public.fyp_privacy_submit('deletion','Review my account data.',false)"),
    (e) => e.code === '22023',
  );
  const rows = (
    await db.query(
      "select public.fyp_privacy_submit('deletion','Review my account data.',true) as value",
    )
  ).rows[0].value;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requester_name, 'Alice');
  await assert.rejects(
    db.query("select public.fyp_privacy_submit('deletion','Duplicate review request.',true)"),
    (e) => e.code === '22023',
  );
  await assert.rejects(
    db.query('select * from fyp_privacy_v1.requests'),
    (e) => e.code === '42501',
  );
  await db.exec('reset role');
  const outsider = '00000000-0000-4000-8000-000000000004';
  await db.query("insert into public.fyp_profiles values($1,'student','Outsider')", [outsider]);
  await db.query('insert into auth.sessions values($1,$1,null)', [outsider]);
  await actor(outsider, { role: 'authenticated', session_id: outsider });
  assert.deepEqual(
    (await db.query('select public.fyp_privacy_requests() as value')).rows[0].value,
    [],
  );
});
test('only coordinators record privacy responses with optimistic locking; academic identity remains intact', async () => {
  await actor(alice, { role: 'authenticated', session_id: alice });
  const request = (await db.query('select public.fyp_privacy_requests() as value')).rows[0]
    .value[0];
  await assert.rejects(
    db.query('select public.fyp_privacy_respond($1,1,$2)', [
      request.id,
      'A forged staff response.',
    ]),
    (e) => e.code === '42501',
  );
  await actor(bob, { role: 'authenticated', session_id: bob });
  await assert.rejects(
    db.query('select public.fyp_privacy_respond($1,2,$2)', [
      request.id,
      'An outdated staff response.',
    ]),
    (e) => e.code === '40001',
  );
  await db.query('select public.fyp_privacy_respond($1,1,$2)', [
    request.id,
    'Retention review requested. No records have been erased.',
  ]);
  await assert.rejects(
    db.query('select public.fyp_privacy_respond($1,1,$2)', [
      request.id,
      'A duplicate staff response.',
    ]),
    (e) => e.code === '40001',
  );
  await actor(alice, { role: 'authenticated', session_id: alice });
  assert.equal(
    (await db.query('select public.fyp_privacy_requests() as value')).rows[0].value[0].status,
    'responded',
  );
  assert.equal(
    (await db.query('select full_name from public.fyp_profiles')).rows[0].full_name,
    'Alice',
  );
});
test('privacy queue enforces its persisted daily allowance even after prior requests receive responses', async () => {
  for (let i = 0; i < 4; i++) {
    await actor(alice, { role: 'authenticated', session_id: alice });
    const row = (
      await db.query(
        "select public.fyp_privacy_submit('export','Please export my account information.',true) as value",
      )
    ).rows[0].value.find((r) => r.status === 'requested');
    await actor(bob, { role: 'authenticated', session_id: bob });
    await db.query('select public.fyp_privacy_respond($1,1,$2)', [
      row.id,
      'Secure export delivery will be arranged by the institution.',
    ]);
  }
  await actor(alice, { role: 'authenticated', session_id: alice });
  await assert.rejects(
    db.query(
      "select public.fyp_privacy_submit('correction','Please review a correction to my display name.',true)",
    ),
    (e) => e.code === 'P0429',
  );
});
