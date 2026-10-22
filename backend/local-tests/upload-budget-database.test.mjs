import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const alice = '00000000-0000-4000-8000-000000000001',
  group = '00000000-0000-4000-8000-000000000002';
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function public.fyp_v2_core_file_access(p_name text,p_write boolean)returns boolean language sql stable as $$select auth.uid()is not null and split_part(p_name,'/',1)=auth.uid()::text and split_part(p_name,'/',2)='${group}'$$;
 create table storage.objects(bucket_id text,name text,metadata jsonb,created_at timestamptz default now());
 alter table storage.objects enable row level security;grant usage on schema auth,storage to anon,authenticated;
 grant insert,select on storage.objects to anon,authenticated;
 create policy broad_legacy on storage.objects for all to anon,authenticated using(true)with check(true);`);
  await db.exec(
    fs.readFileSync(
      new URL('../../supabase/migrations/202610160003_upload_budgets.sql', import.meta.url),
      'utf8',
    ),
  );
});
beforeEach(async () => {
  await db.exec('reset role;truncate storage.objects');
  await db.query("select set_config('test.actor',$1,false)", [alice]);
});
after(async () => db?.close());
async function insert(name, size) {
  return db.query(
    "insert into storage.objects(bucket_id,name,metadata)values('fyp-v2-submissions',$1,$2)",
    [name, JSON.stringify(size === null ? {} : { size })],
  );
}
test('restrictive budget permits a normal upload and denies malformed or foreign upload paths', async () => {
  await db.exec('set role authenticated');
  await insert(alice + '/' + group + '/normal.pdf', 500);
  for (const size of [0, 10485761, 'not-a-size'])
    await assert.rejects(insert(alice + '/' + group + '/bad.pdf', size));
  await assert.rejects(insert('other-user/' + group + '/foreign.pdf', 500));
});
test('100 MiB account budget is enforced on direct inserts including absent size metadata', async () => {
  await db.query(
    "insert into storage.objects select 'fyp-v2-submissions',$1||'/'||$2||'/'||n||'.pdf',jsonb_build_object('size',10485760),now()-interval'2 days' from generate_series(1,10)n",
    [alice, group],
  );
  await db.exec('set role authenticated');
  await assert.rejects(insert(alice + '/' + group + '/extra.pdf', 1));
  await assert.rejects(insert(alice + '/' + group + '/missing-size.pdf', null));
});
test('200 MiB group budget cannot be bypassed by a fresh member account', async () => {
  await db.query(
    "insert into storage.objects select 'fyp-v2-submissions','another-member/'||$1||'/'||n||'.pdf',jsonb_build_object('size',10485760),now()-interval'2 days' from generate_series(1,20)n",
    [group],
  );
  await db.exec('set role authenticated');
  await assert.rejects(insert(alice + '/' + group + '/extra.pdf', 1));
});
test('the rolling upload count blocks a twenty-first small file despite permissive legacy policies', async () => {
  await db.exec('set role authenticated');
  for (let i = 0; i < 20; i++) await insert(alice + '/' + group + '/' + i + '.pdf', 1);
  await assert.rejects(insert(alice + '/' + group + '/twenty-first.pdf', 1));
});
test('anonymous upload cannot consume project storage', async () => {
  await db.exec('reset role');
  await db.query("select set_config('test.actor','',false)");
  await db.exec('set role anon');
  await assert.rejects(insert(alice + '/' + group + '/anonymous.pdf', 1));
});
