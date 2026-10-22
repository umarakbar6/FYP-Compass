import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
let db;
const uid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema fyp_core_v2;create schema fyp_ops_v1;
 create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create table public.fyp_profiles(id uuid primary key references auth.users(id),full_name text,role text);
 create table fyp_ops_v1.invites(id uuid primary key default gen_random_uuid(),request_id uuid,email text,full_name text,role text,status text default 'pending',created_at timestamptz default now());
 create function fyp_core_v2.role(expected text)returns void language plpgsql as $$begin if current_setting('test.role',true)is distinct from expected then raise exception 'Forbidden'using errcode='42501';end if;end$$;
 create function public.fyp_admin_invite_reserve(p_request_id uuid,p_session_id uuid,p_people jsonb)returns jsonb language plpgsql as $$begin
 insert into fyp_ops_v1.invites(request_id,email,full_name,role)select p_request_id,value->>'email',value->>'full_name',value->>'role'from jsonb_array_elements(p_people);return p_people;end$$;`);
  await db.exec(
    fs.readFileSync(
      new URL('../../supabase/migrations/202610160004_account_capacity.sql', import.meta.url),
      'utf8',
    ),
  );
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec(
    "reset role;truncate fyp_accounts_v1.settings,fyp_accounts_v1.slots,public.fyp_profiles,auth.users,fyp_ops_v1.invites cascade;insert into fyp_accounts_v1.settings(singleton)values(true);select set_config('test.role','coordinator',false)",
  );
  await account(1, 'coordinator', 'owner@example.test');
  await db.query('select fyp_accounts_v1.set_owner($1,$2)', [uid(1), 'owner@example.test']);
});
async function account(n, role = 'student', email = `user${n}@example.test`) {
  await db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())', [
    uid(n),
    email,
  ]);
  await db.query('insert into public.fyp_profiles values($1,$2,$3)', [uid(n), 'Test user', role]);
}
async function capacity() {
  return (await db.query('select * from fyp_accounts_v1.capacity()')).rows;
}
test('limits are 100 students, 10 supervisors, two coordinators and one excluded owner', async () => {
  assert.deepEqual(
    (await capacity()).map((x) => [x.role, x.maximum, Number(x.registered)]),
    [
      ['coordinator', 2, 0],
      ['student', 100, 0],
      ['supervisor', 10, 0],
    ],
  );
});
test('100 unconfirmed student identities fill capacity and the 101st rolls back', async () => {
  await db.exec(
    "insert into auth.users(id,email)select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'pending'||n||'@example.test'from generate_series(10,109)n",
  );
  await assert.rejects(
    db.query('insert into auth.users(id,email)values($1,$2)', [uid(110), 'overflow@example.test']),
    /student account capacity/,
  );
  assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n, 101);
});
test('public metadata cannot grant staff role or owner exemption', async () => {
  await db.query(
    "insert into auth.users(id,email,raw_user_meta_data)values($1,'attacker@example.test',$2)",
    [
      uid(2),
      JSON.stringify({ role: 'coordinator', is_owner: true, owner_email: 'owner@example.test' }),
    ],
  );
  assert.equal(
    (await db.query('select role from fyp_accounts_v1.slots where account_id=$1', [uid(2)])).rows[0]
      .role,
    'student',
  );
  assert.equal((await capacity()).find((x) => x.role === 'student').registered, 1);
});
test('the eleventh supervisor profile is rejected without exceeding ten', async () => {
  for (let n = 10; n < 20; n++) await account(n, 'supervisor');
  await db.query('insert into auth.users(id,email)values($1,$2)', [uid(20), 'extra@example.test']);
  await assert.rejects(
    db.query("insert into public.fyp_profiles values($1,'Extra','supervisor')", [uid(20)]),
    /supervisor account capacity/,
  );
  assert.equal(Number((await capacity()).find((x) => x.role === 'supervisor').registered), 10);
});
test('two coordinators coexist with owner and a third ordinary coordinator is rejected', async () => {
  await account(2, 'coordinator');
  await account(3, 'coordinator');
  await db.query("insert into auth.users(id,email)values($1,'extra@example.test')", [uid(4)]);
  await assert.rejects(
    db.query("insert into public.fyp_profiles values($1,'Extra','coordinator')", [uid(4)]),
    /coordinator account capacity/,
  );
  assert.equal(
    (await db.query("select count(*)::int as n from public.fyp_profiles where role='coordinator'"))
      .rows[0].n,
    3,
  );
});
test('role changes also enforce target capacity', async () => {
  await account(2, 'coordinator');
  await account(3, 'coordinator');
  await account(4, 'supervisor');
  await assert.rejects(
    db.query("update public.fyp_profiles set role='coordinator'where id=$1", [uid(4)]),
    /coordinator account capacity/,
  );
  assert.equal(
    (await db.query('select role from public.fyp_profiles where id=$1', [uid(4)])).rows[0].role,
    'supervisor',
  );
});
test('owner role, email and immutable identity cannot be altered through ordinary writes', async () => {
  await assert.rejects(
    db.query("update auth.users set email='other@example.test'where id=$1", [uid(1)]),
    /owner email is protected/,
  );
  await assert.rejects(
    db.query("update public.fyp_profiles set role='student'where id=$1", [uid(1)]),
    /owner role is protected/,
  );
  await assert.rejects(
    db.query('update public.fyp_profiles set id=$1 where id=$2', [uid(99), uid(1)]),
    /identity is immutable/,
  );
});
test('only one owner can be pinned and user metadata cannot replace it', async () => {
  await account(2, 'coordinator');
  await assert.rejects(
    db.query('select fyp_accounts_v1.set_owner($1,$2)', [uid(2), 'user2@example.test']),
    /Owner is already pinned/,
  );
});
test('a whole invitation batch reserves capacity before email dispatch', async () => {
  const people = Array.from({ length: 11 }, (_, i) => ({
    email: `staff${i}@example.test`,
    full_name: 'Staff user',
    role: 'supervisor',
  }));
  await assert.rejects(
    db.query('select public.fyp_admin_invite_reserve($1,$2,$3)', [
      uid(300),
      uid(400),
      JSON.stringify(people),
    ]),
    /supervisor account capacity/,
  );
  assert.equal((await db.query('select count(*)::int as n from fyp_ops_v1.invites')).rows[0].n, 0);
});
test('invited identity consumes its reserved slot without double counting', async () => {
  const people = Array.from({ length: 10 }, (_, i) => ({
    email: `staff${i}@example.test`,
    full_name: 'Staff user',
    role: 'supervisor',
  }));
  await db.query('select public.fyp_admin_invite_reserve($1,$2,$3)', [
    uid(300),
    uid(400),
    JSON.stringify(people),
  ]);
  await db.query("insert into auth.users(id,email)values($1,'staff0@example.test')", [uid(500)]);
  const c = (await capacity()).find((x) => x.role === 'supervisor');
  assert.equal(Number(c.registered), 1);
  assert.equal(Number(c.reserved), 9);
});
test('anonymous and authenticated users cannot read capacity internals or set owner', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec('set role ' + role);
    await assert.rejects(
      db.query('select * from fyp_accounts_v1.settings'),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      db.query('select fyp_accounts_v1.set_owner($1,$2)', [uid(1), 'owner@example.test']),
      (e) => e.code === '42501',
    );
    await db.exec('reset role');
  }
  await db.exec("select set_config('test.role','student',false)");
  await assert.rejects(db.query('select public.fyp_account_capacity()'), (e) => e.code === '42501');
});
test('no unspecified examiner limit is invented and capacity tables keep RLS', async () => {
  for (let n = 10; n < 14; n++) await account(n, 'examiner');
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from pg_tables where schemaname='fyp_accounts_v1'and rowsecurity",
      )
    ).rows[0].n,
    3,
  );
  assert.equal((await capacity()).length, 3);
});
