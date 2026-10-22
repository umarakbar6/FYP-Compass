// Read-only owned-cloud application backup. Restore is ONLY into an isolated PostgreSQL engine.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root = process.cwd(),
  ref = 'mqzsrphoagzfmdovmukg',
  privateDir = path.join(root, '.private/backups');
fs.mkdirSync(privateDir, { recursive: true });
const { PGlite } = await import(
  'file:///' +
    path
      .join(root, 'backend/local-tests/node_modules/@electric-sql/pglite/dist/index.js')
      .replaceAll('\\', '/')
);
const { vector } = await import(
  pathToFileURL(
    path.join(root, 'backend/local-tests/node_modules/@electric-sql/pglite-pgvector/dist/index.js'),
  ).href
);
const cli =
  process.env.FYP_SUPABASE_CLI ||
  'D:/Projects/.npm-cache/_npx/b96a6bd565c470ce/node_modules/supabase/dist/supabase.js';
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const canonical = (value) =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
const rowHash = (rows) => hash(rows.map(canonical).sort().join('\n'));
const quote = (name) =>
  name
    .split('.')
    .map((s) => '"' + s.replaceAll('"', '""') + '"')
    .join('.');
const sql = [
  'create or replace function pg_temp.fyp_backup() returns jsonb language plpgsql stable as $$',
  "declare item record;data jsonb;items jsonb:='[]'::jsonb;parents jsonb;begin",
  "for item in select schemaname,tablename from pg_tables where (schemaname='public' and tablename='fyp_profiles') or left(schemaname,4)='fyp_' order by schemaname,tablename loop",
  "execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from %I.%I t',item.schemaname,item.tablename) into data;",
  "select coalesce(jsonb_agg(distinct n.nspname||'.'||c.relname),'[]'::jsonb) into parents from pg_constraint fk join pg_class c on c.oid=fk.confrelid join pg_namespace n on n.oid=c.relnamespace where fk.contype='f' and fk.conrelid=format('%I.%I',item.schemaname,item.tablename)::regclass;",
  "items:=items||jsonb_build_array(jsonb_build_object('name',item.schemaname||'.'||item.tablename,'rows',data,'parents',parents));end loop;",
  "return jsonb_build_object('taken_at',now(),'tables',items,'auth_ids',(select coalesce(jsonb_agg(id),'[]'::jsonb) from auth.users),'buckets',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)),'[]'::jsonb) from storage.buckets where id='fyp-v2-submissions'),'objects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket_id',bucket_id,'name',name,'metadata',metadata)),'[]'::jsonb) from storage.objects where bucket_id='fyp-v2-submissions'));end $$;",
  'select pg_temp.fyp_backup() as backup;',
].join('\n');
const queryFile = path.join(privateDir, 'application-export-query.sql');
fs.writeFileSync(queryFile, sql);
const query = cp.spawnSync(
  process.execPath,
  [
    cli,
    'db',
    'query',
    '--file',
    queryFile,
    '--linked',
    '--project-ref',
    ref,
    '--output',
    'json',
    '--output-format',
    'json',
    '--agent',
    'yes',
  ],
  { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 },
);
if (query.status !== 0) throw Error('Owned project export failed; no cloud restore was attempted.');
let parsed;
try {
  parsed = JSON.parse(query.stdout);
} catch {
  throw Error('Export response is not JSON.');
}
const snapshot = parsed.rows?.find((x) => x.backup)?.backup;
if (!snapshot?.tables?.length) throw Error('Export returned no application tables.');
const server = JSON.parse(
  fs.readFileSync(path.join(root, '.private/deployment/server-env.json'), 'utf8'),
);
assert.equal(server.SUPABASE_URL, 'https://' + ref + '.supabase.co');
const objects = [];
for (const object of snapshot.objects) {
  const url =
    server.SUPABASE_URL +
    '/storage/v1/object/authenticated/' +
    object.bucket_id +
    '/' +
    object.name.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(url, {
    headers: {
      apikey: server.SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + server.SUPABASE_SERVICE_ROLE_KEY,
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error('Private storage object could not be backed up.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 10485760) throw Error('Unexpected backup object size.');
  if (Number(object.metadata?.size) !== bytes.length)
    throw Error('Backup object differs from stored metadata.');
  objects.push({
    name: object.name,
    size: bytes.length,
    sha256: hash(bytes),
    bytes: bytes.toString('base64'),
  });
}
const installer = fs.readFileSync(path.join(root, 'backend/INSTALL-PRODUCTION.sql'), 'utf8');
const ledgerDDL = fs.readFileSync(path.join(root, 'supabase/release-ledger.sql'), 'utf8');
const payload = {
  version: 1,
  ref,
  snapshot,
  objects,
  installer,
  installerSha256: hash(installer),
  ledgerDDL,
  ledgerSha256: hash(ledgerDDL),
};
const key = crypto.randomBytes(32),
  nonce = crypto.randomBytes(12),
  cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const backupFile = path.join(privateDir, 'FYP-Compass-' + stamp + '.encrypted.json');
fs.writeFileSync(
  backupFile,
  JSON.stringify({
    version: 1,
    algorithm: 'AES-256-GCM',
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: encrypted.toString('base64'),
  }),
);
const portableKeyFile = backupFile + '.portable-recovery-key.json';
fs.writeFileSync(
  portableKeyFile,
  JSON.stringify({
    version: 1,
    backup: backupFile,
    key: key.toString('base64'),
    warning:
      'PRIVATE recovery key: store separately from the encrypted backup on a second trusted device.',
  }),
  { mode: 0o600 },
);
if (process.platform === 'win32') {
  const acl = cp.spawnSync(
    'icacls',
    [
      portableKeyFile,
      '/inheritance:r',
      '/grant:r',
      process.env.USERDOMAIN + '\\' + process.env.USERNAME + ':(F)',
    ],
    { encoding: 'utf8' },
  );
  if (acl.status !== 0) throw Error('Portable recovery-key access could not be restricted.');
}
const protection = cp.spawnSync(
  'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Add-Type -AssemblyName System.Security; $backupBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($backupBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))',
  ],
  { input: key.toString('base64'), encoding: 'utf8', timeout: 120000 },
);
if (protection.status !== 0 || !protection.stdout.trim())
  throw Error('Windows key protection failed.');
fs.writeFileSync(backupFile + '.key.dpapi', protection.stdout.trim());
key.fill(0);
const unprotected = cp.spawnSync(
  'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Add-Type -AssemblyName System.Security; $backupBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($backupBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))',
  ],
  { input: fs.readFileSync(backupFile + '.key.dpapi', 'utf8'), encoding: 'utf8', timeout: 120000 },
);
if (unprotected.status !== 0) throw Error('Backup key could not be recovered for the drill.');
const restoreKey = Buffer.from(unprotected.stdout.trim(), 'base64'),
  envelope = JSON.parse(fs.readFileSync(backupFile, 'utf8')),
  decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    restoreKey,
    Buffer.from(envelope.nonce, 'base64'),
  );
decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
const recovered = JSON.parse(
  Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString(),
);
restoreKey.fill(0);
assert.equal(hash(recovered.installer), recovered.installerSha256);
const portable = JSON.parse(fs.readFileSync(portableKeyFile, 'utf8'));
const portableKey = Buffer.from(portable.key, 'base64'),
  portableDecipher = crypto.createDecipheriv(
    'aes-256-gcm',
    portableKey,
    Buffer.from(envelope.nonce, 'base64'),
  );
portableDecipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
const portableRecovered = JSON.parse(
  Buffer.concat([
    portableDecipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    portableDecipher.final(),
  ]).toString(),
);
portableKey.fill(0);
assert.equal(hash(JSON.stringify(portableRecovered)), hash(JSON.stringify(recovered)));
const started = performance.now(),
  db = new PGlite({ extensions: { vector } });
try {
  await db.exec("set timezone='UTC'");
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;grant usage on schema auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create table auth.users(id uuid primary key);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;grant select on storage.objects to anon;",
  );
  for (const id of recovered.snapshot.auth_ids)
    await db.query('insert into auth.users values($1)', [id]);
  await db.exec(
    "alter table auth.users add column email text,add column email_confirmed_at timestamptz default now(),add column raw_user_meta_data jsonb default '{}'",
  );
  await db.exec(
    'create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);alter table storage.objects add column created_at timestamptz default now()',
  );
  await db.exec(recovered.installer);
  assert.equal(hash(recovered.ledgerDDL), recovered.ledgerSha256);
  await db.exec(recovered.ledgerDDL);
  const pending = [...recovered.snapshot.tables],
    all = new Set(pending.map((x) => x.name)),
    restored = new Set();
  // Only in this isolated restore engine: do not replay business side effects from
  // historical rows. PostgreSQL internal foreign-key triggers stay enabled.
  const restoreTables = [...all, 'storage.buckets', 'storage.objects'];
  for (const name of restoreTables)
    await db.exec('alter table ' + quote(name) + ' disable trigger user');
  await db.exec('truncate ' + pending.map((x) => quote(x.name)).join(',') + ' cascade');
  const insert = async (name, rows) => {
    if (rows.length)
      await db.query(
        'insert into ' +
          quote(name) +
          ' overriding system value select * from jsonb_populate_recordset(null::' +
          quote(name) +
          ',$1::jsonb)',
        [JSON.stringify(rows)],
      );
  };
  await db.exec('truncate storage.objects,storage.buckets cascade');
  await insert('storage.buckets', recovered.snapshot.buckets);
  await insert('storage.objects', recovered.snapshot.objects);
  while (pending.length) {
    const index = pending.findIndex((t) =>
      t.parents.every((parent) => parent === t.name || !all.has(parent) || restored.has(parent)),
    );
    if (index < 0) throw Error('Backup restore dependency cycle requires explicit handling.');
    const [table] = pending.splice(index, 1);
    await insert(table.name, table.rows);
    restored.add(table.name);
  }
  for (const name of restoreTables)
    await db.exec('alter table ' + quote(name) + ' enable trigger user');
  const disabledTriggers = (
    await db.query(
      "select count(*)::int as count from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where t.tgenabled='D' and (left(n.nspname,4)='fyp_' or n.nspname in ('public','storage'))",
    )
  ).rows[0].count;
  assert.equal(disabledTriggers, 0, 'Restore must re-enable every business trigger');
  for (const table of recovered.snapshot.tables) {
    const [schema, name] = table.name.split('.');
    const columns = (
      await db.query(
        "select column_name from information_schema.columns where table_schema=$1 and table_name=$2 and (is_identity='YES' or column_default like 'nextval(%')",
        [schema, name],
      )
    ).rows;
    for (const column of columns) {
      const seq = (
        await db.query('select pg_get_serial_sequence($1,$2) as value', [
          table.name,
          column.column_name,
        ])
      ).rows[0].value;
      if (seq) {
        const maximum = (
          await db.query(
            'select max(' +
              quote(column.column_name) +
              ')::text as value from ' +
              quote(table.name),
          )
        ).rows[0].value;
        await db.query('select setval($1::regclass,$2::bigint,$3)', [
          seq,
          maximum || '1',
          maximum !== null,
        ]);
      }
    }
  }
  const checks = [];
  for (const table of recovered.snapshot.tables) {
    const actual = (
      await db.query('select to_jsonb(t) as row from ' + quote(table.name) + ' t')
    ).rows.map((x) => x.row);
    if (rowHash(actual) !== rowHash(table.rows))
      fs.writeFileSync(
        path.join(privateDir, 'restore-difference.json'),
        JSON.stringify({ table: table.name, expected: table.rows, actual }, null, 2),
      );
    assert.equal(rowHash(actual), rowHash(table.rows), 'Restored rows differ: ' + table.name);
    checks.push({ table: table.name, rows: actual.length, sha256: rowHash(actual), passed: true });
  }
  const fileChecks = recovered.objects.map((file) => {
    const bytes = Buffer.from(file.bytes, 'base64');
    assert.equal(bytes.length, file.size);
    assert.equal(hash(bytes), file.sha256);
    return { size: file.size, sha256: file.sha256, passed: true };
  });
  const report = {
    checkedAt: new Date().toISOString(),
    passed: true,
    method:
      'Encrypted real owned-cloud application snapshot restored into isolated PGlite PostgreSQL; exact row hashes and private storage byte hashes compared',
    project: ref,
    backupEncrypted: true,
    foreignKeysChecked: true,
    businessTriggersReenabled: disabledTriggers === 0,
    snapshotAt: recovered.snapshot.taken_at,
    keyProtection:
      'Windows DPAPI CurrentUser plus a separately ACL-protected portable AES256 recovery key; both decryption paths were verified',
    tables: checks.length,
    rows: checks.reduce((n, x) => n + x.rows, 0),
    storageObjects: fileChecks.length,
    restoreMs: Math.round(performance.now() - started),
    checks,
    fileChecks,
    limitations: [
      'Auth passwords, active sessions, MFA, provider configuration and managed platform settings are not captured; Auth UUID links are restored as stubs for this drill.',
      'Database snapshot is consistent; storage bytes are downloaded afterwards and verified against snapshot sizes.',
      'The drill is isolated PostgreSQL, not a newly provisioned Supabase cloud project.',
      'Encrypted copy is on D:; it is not an off-device disaster recovery copy or point-in-time recovery.',
    ],
  };
  fs.writeFileSync(
    path.join(root, 'handover/verification/production-backup-restore.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(privateDir, 'LATEST.txt'),
    backupFile + '\n' + backupFile + '.key.dpapi\n' + portableKeyFile + '\n',
  );
  console.log(
    JSON.stringify({
      passed: true,
      tables: report.tables,
      rows: report.rows,
      storageObjects: report.storageObjects,
      restoreMs: report.restoreMs,
      encryptedBackup: backupFile,
    }),
  );
} finally {
  await db.close();
}
