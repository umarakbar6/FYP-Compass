// Supabase's auth session table is not part of an application database installer.
// Model it explicitly in isolated PostgreSQL tests; production has no test bypass.
export async function installAuthSessionFixture(db) {
  await db.exec(
    'alter table storage.objects add column if not exists created_at timestamptz default now()',
  );
  await db.exec(`create table if not exists auth.sessions(
    id uuid primary key,user_id uuid not null,not_after timestamptz
  );`);
}
export async function setTestActor(db, id, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('test.actor',$1,false)", [id || '']);
  if (id && role === 'authenticated')
    await db.query(
      'insert into auth.sessions(id,user_id) values($1,$1) on conflict(id) do nothing',
      [id],
    );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ role, sub: id || null, session_id: id || null }),
  ]);
  if (!['anon', 'authenticated', 'service_role'].includes(role)) throw Error('Invalid test role');
  await db.exec('set role ' + role);
}
