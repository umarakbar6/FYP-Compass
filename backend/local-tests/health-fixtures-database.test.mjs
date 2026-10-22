import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('synthetic health fixtures are idempotent, preserve active session and evaluate Amber/Red with student draft privacy', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
  grant usage on schema auth,storage to anon,authenticated;
  grant execute on function auth.uid() to anon,authenticated;
  create table auth.users(id uuid primary key);
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
  alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;`);
    const names = [
      'Student One',
      'Student Two',
      'Student Three',
      'Demo Supervisor',
      'Demo Supervisor Two',
      'Demo Supervisor Three',
      'Demo Coordinator',
    ];
    const ids = names.map((_, i) => '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'));
    for (const id of ids) await db.query('insert into auth.users values($1)', [id]);
    await db.exec(fs.readFileSync(new URL('../INSTALL-ALL-V2.sql', import.meta.url), 'utf8'));
    for (const [i, name] of names.entries())
      await db.query('insert into public.fyp_profiles(id,full_name,role) values($1,$2,$3)', [
        ids[i],
        name,
        i < 3 ? 'student' : i < 6 ? 'supervisor' : 'coordinator',
      ]);
    await db.exec("insert into fyp_core_v2.sessions(name,active) values('Existing Demo',true)");
    const sql = fs.readFileSync(
      new URL('../demo-data/seed-health-scenarios.sql', import.meta.url),
      'utf8',
    );
    await db.exec(sql);
    await db.exec(sql);
    assert.equal((await db.query('select count(*)::int n from fyp_core_v2.groups')).rows[0].n, 2);
    assert.equal(
      (await db.query('select name from fyp_core_v2.sessions where active')).rows[0].name,
      'Existing Demo',
    );
    const sup = (await db.query('select supervisor_id from fyp_core_v2.allocations limit 1'))
      .rows[0].supervisor_id;
    await db.query("select set_config('test.actor',$1,false)", [sup]);
    await db.exec('set role authenticated');
    const health = (await db.query('select public.get_health_workspace() value')).rows[0].value;
    assert.deepEqual(health.projects.map((p) => p.health.level).sort(), ['amber', 'red']);
    const red = health.projects.find((p) => p.health.level === 'red');
    const drafted = (
      await db.query('select public.create_group_health_fallback($1) value', [red.id])
    ).rows[0].value;
    assert(drafted.reports.some((r) => r.project_id === red.id && r.status === 'draft'));
    assert.equal(drafted.notices.length, 0);
    await db.exec('reset role');
    await db.query("select set_config('test.actor',$1,false)", [ids[0]]);
    await db.exec('set role authenticated');
    const student = (await db.query('select public.get_health_workspace() value')).rows[0].value;
    assert.equal(student.reports.length, 0);
    assert(student.projects.every((p) => p.health.rules.length === 0));
  } finally {
    await db.close();
  }
});
