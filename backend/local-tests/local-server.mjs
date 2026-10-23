import { createEnquiryHandler } from '../engagement/enquiry-handler.ts';
// Loopback-only application bridge over the complete production migrations.
// External AI is opt-in per request and requires private server environment settings.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { AsyncLocalStorage } from 'node:async_hooks';
import { inspectDocument } from '../../src/security/documents.ts';
import { createLocalFunctions } from './local-functions.mjs';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const people = [
  ['student', 'Student One', 101],
  ['student', 'Student Two', 102],
  ['student', 'Student Three', 103],
  ['supervisor', 'Demo Supervisor', 1],
  ['supervisor', 'Demo Supervisor Two', 2],
  ['supervisor', 'Demo Supervisor Three', 3],
  ['examiner', 'Examiner One', 301],
  ['examiner', 'Examiner Two', 302],
  ['coordinator', 'Demo Coordinator', 201],
].map(([role, full_name, n]) => ({
  id: uuid(n),
  role,
  full_name,
  email: `${role}-${n}@local.fypcompass.test`,
}));
export async function createLocalServer({
  dataDir = path.join(root, '.private/local-backend-full'),
  origin = 'http://127.0.0.1:5182',
  port = 54329,
  memory = false,
  environment = process.env,
  providerFetch = fetch,
} = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const keyPath = path.join(dataDir, 'signing-key.json');
  let key;
  if (memory) key = crypto.randomBytes(32);
  else if (fs.existsSync(keyPath))
    key = Buffer.from(JSON.parse(fs.readFileSync(keyPath, 'utf8')).key, 'hex');
  else {
    key = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, JSON.stringify({ key: key.toString('hex') }), { mode: 0o600 });
  }
  const db = new PGlite({
    dataDir: memory ? undefined : path.join(dataDir, 'postgres'),
    extensions: { vector },
  });
  const requestIdentity = new AsyncLocalStorage();
  let queue = Promise.resolve();
  function serialize(operation) {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  }
  const existed = (await db.query("select to_regclass('fyp_core_v2.sessions') as table_name"))
    .rows[0].table_name;
  if (!existed) {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('local.actor',true),'')::uuid$$;grant usage on schema auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),raw_user_meta_data jsonb default '{}');create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);create table auth.mfa_factors(id uuid primary key,user_id uuid,status text);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text not null,name text not null,metadata jsonb,created_at timestamptz default now(),unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert on storage.objects to authenticated;grant select on storage.objects to anon;`,
    );
    const hash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(root, 'backend/INSTALL-PRODUCTION.sql')))
      .digest('hex');
    if (!memory)
      fs.writeFileSync(path.join(dataDir, 'installed-source.json'), JSON.stringify({ hash }), {
        mode: 0o600,
      });
    for (const p of people) {
      await db.query('insert into auth.users(id,email) values($1,$2)', [p.id, p.email]);
      await db.query('insert into auth.sessions(id,user_id) values($1,$1)', [p.id]);
    }
    await db.exec(fs.readFileSync(path.join(root, 'backend/INSTALL-PRODUCTION.sql'), 'utf8'));
    for (const p of people)
      await db.query('insert into public.fyp_profiles(id,full_name,role) values($1,$2,$3)', [
        p.id,
        p.full_name,
        p.role,
      ]);
  } else if (!memory) {
    const manifest = path.join(dataDir, 'installed-source.json');
    const hash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(root, 'backend/INSTALL-PRODUCTION.sql')))
      .digest('hex');
    if (!fs.existsSync(manifest) || JSON.parse(fs.readFileSync(manifest, 'utf8')).hash !== hash) {
      await db.close();
      throw new Error(
        'Local database belongs to a different migration version. Preserve it and use a new demo data directory; no data was deleted.',
      );
    }
  }
  const functions = new Map(
    (
      await db.query(
        "select proname,proargnames,proargtypes::text as types from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and has_function_privilege('authenticated',p.oid,'EXECUTE') and (proname like 'fyp\\_%' escape '\\' or proname in ('get_health_workspace','calculate_group_health','prepare_group_health_draft','save_group_health_draft','review_group_health','mark_health_notice_read','create_group_health_fallback'))",
      )
    ).rows.map((f) => [f.proname, f]),
  );
  async function asActor(id, operation) {
    const claims = requestIdentity.getStore()?.claims || {
      sub: id,
      role: 'authenticated',
      session_id: id,
      aal: 'aal1',
    };
    if (claims.sub !== id)
      throw Object.assign(new Error('Session actor mismatch.'), { status: 403 });
    return serialize(async () => {
      try {
        await db.exec('reset role');
        await db.query(
          "select set_config('local.actor',$1,false),set_config('request.jwt.claims',$2,false)",
          [id, JSON.stringify(claims)],
        );
        await db.exec('set role authenticated');
        return await operation();
      } finally {
        await db.exec('reset role');
        await db.query(
          "select set_config('local.actor','',false),set_config('request.jwt.claims','',false)",
        );
      }
    });
  }
  async function rpc(id, name, args = {}) {
    const f = functions.get(name);
    if (!f || !/^[a-zA-Z0-9_]+$/.test(name))
      throw Object.assign(new Error('RPC is unavailable.'), { code: 'PGRST202' });
    const names = Object.keys(args);
    const types = f.types.split(' ');
    for (const n of names)
      if (!/^[a-zA-Z0-9_]+$/.test(n) || !f.proargnames?.includes(n))
        throw new Error('Invalid RPC argument.');
    const values = names.map((n) =>
      types[f.proargnames.indexOf(n)] === '3802' && args[n] !== null
        ? JSON.stringify(args[n])
        : args[n],
    );
    return asActor(id, async () => {
      const result = await db.query(
        'select public.' +
          name +
          '(' +
          names.map((n, i) => n + '=> $' + (i + 1)).join(',') +
          ') as value',
        values,
      );
      return result.rows[0].value;
    });
  }
  async function serviceRpc(name, args = {}) {
    if (!/^fyp_[a-z0-9_]+$/.test(name)) throw new Error('Invalid internal operation.');
    return serialize(async () => {
      try {
        await db.exec('reset role');
        const candidates = (
          await db.query(
            "select proargnames,proargtypes::text types from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname=$1 and has_function_privilege('service_role',p.oid,'EXECUTE')",
            [name],
          )
        ).rows;
        const f = candidates
          .filter((f) => Object.keys(args).every((key) => f.proargnames?.includes(key)))
          .sort((a, b) => a.proargnames.length - b.proargnames.length)[0];
        if (!f) throw new Error('Internal operation unavailable.');
        const names = Object.keys(args),
          types = f.types.split(' ');
        for (const key of names)
          if (!/^[a-zA-Z0-9_]+$/.test(key) || !f.proargnames?.includes(key))
            throw new Error('Invalid internal argument.');
        const values = names.map((key) =>
          types[f.proargnames.indexOf(key)] === '3802' && args[key] !== null
            ? JSON.stringify(args[key])
            : args[key],
        );
        await db.query(
          "select set_config('request.jwt.claims',$1,false),set_config('local.actor','',false)",
          [JSON.stringify({ role: 'service_role' })],
        );
        await db.exec('set role service_role');
        return (
          await db.query(
            'select public.' +
              name +
              '(' +
              names.map((key, i) => key + '=>$' + (i + 1)).join(',') +
              ') value',
            values,
          )
        ).rows[0].value;
      } finally {
        await db.exec('reset role');
        await db.query(
          "select set_config('request.jwt.claims','',false),set_config('local.actor','',false)",
        );
      }
    });
  }
  // New local data only. Seed configuration once; never reset existing demo work.
  if (!existed) {
    const coordinator = people.find((p) => p.role === 'coordinator').id;
    let config = await rpc(coordinator, 'fyp_v2_core_configure', {
      p_operation: 'session',
      p_data: { name: 'FYP Compass Local Demo 2026', active: true },
    });
    const sid = config.sessions[0].id;
    for (const name of ['Web Development', 'Artificial Intelligence', 'Data Science'])
      config = await rpc(coordinator, 'fyp_v2_core_configure', {
        p_operation: 'topic',
        p_data: { name },
      });
    for (const p of people.filter((p) => p.role === 'student'))
      await rpc(coordinator, 'fyp_v2_core_configure', {
        p_operation: 'enroll',
        p_data: { profile_id: p.id, session_id: sid },
      });
    for (const p of people.filter((p) => p.role === 'supervisor'))
      await rpc(coordinator, 'fyp_v2_core_configure', {
        p_operation: 'capacity',
        p_data: {
          session_id: sid,
          supervisor_id: p.id,
          max_groups: 2,
          topic_ids: config.topics.map((t) => t.id),
        },
      });
    await rpc(coordinator, 'fyp_v2_core_configure', {
      p_operation: 'template',
      p_data: {
        session_id: sid,
        name: 'Final report',
        description: 'Submit the report and individual contribution evidence.',
        days: 3,
      },
    });
  }
  function token(id, kind = 'access', seconds = 3600, extra = {}) {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const p = people.find((p) => p.id === id);
    const body = Buffer.from(
      JSON.stringify({
        sub: id,
        role: 'authenticated',
        aud: 'authenticated',
        iss: 'fyp-compass-local-demo',
        iat: now,
        exp: now + seconds,
        email: p?.email,
        kind,
        aal: 'aal1',
        session_id: requestIdentity.getStore()?.claims?.session_id || id,
        ...extra,
      }),
    ).toString('base64url');
    const data = header + '.' + body;
    return data + '.' + crypto.createHmac('sha256', key).update(data).digest('base64url');
  }
  function verify(value, kind = 'access') {
    try {
      const [head, body, sig, ...rest] = value.split('.');
      if (rest.length || !sig) throw 0;
      const expected = crypto
        .createHmac('sha256', key)
        .update(head + '.' + body)
        .digest();
      const actual = Buffer.from(sig, 'base64url');
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw 0;
      const header = JSON.parse(Buffer.from(head, 'base64url').toString());
      if (header.alg !== 'HS256' || header.typ !== 'JWT') throw 0;
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (
        claims.role !== 'authenticated' ||
        claims.aud !== 'authenticated' ||
        claims.kind !== kind ||
        claims.iss !== 'fyp-compass-local-demo' ||
        claims.exp <= Date.now() / 1000 ||
        !people.some((p) => p.id === claims.sub)
      )
        throw 0;
      return claims;
    } catch {
      throw Object.assign(new Error('Invalid or expired local session.'), {
        status: 401,
        code: '42501',
      });
    }
  }
  function authUser(id) {
    const p = people.find((p) => p.id === id);
    return {
      id: p.id,
      email: p.email,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: { provider: 'local-demo', providers: ['local-demo'] },
      user_metadata: { full_name: p.full_name },
      created_at: '2026-10-08T00:00:00Z',
    };
  }
  async function session(id, existingSession) {
    const sessionId = existingSession || crypto.randomUUID();
    if (!existingSession)
      await serialize(() =>
        db.query('insert into auth.sessions(id,user_id) values($1,$2)', [sessionId, id]),
      );
    return {
      access_token: token(id, 'access', 3600, { session_id: sessionId }),
      refresh_token: token(id, 'refresh', 86400, { session_id: sessionId }),
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: authUser(id),
    };
  }
  async function body(req, max = 16384) {
    let chunks = [],
      count = 0;
    for await (const chunk of req) {
      count += chunk.length;
      if (count > max) throw Object.assign(new Error('Request is too large.'), { status: 413 });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async function activateClaims(claims) {
    const active = await serialize(() =>
      db.query(
        'select 1 from auth.sessions where id=$1 and user_id=$2 and (not_after is null or not_after>now())',
        [claims.session_id, claims.sub],
      ),
    );
    if (!active.rows.length)
      throw Object.assign(new Error('Session is no longer active. Sign in again.'), {
        status: 401,
        code: '42501',
      });
    requestIdentity.getStore().claims = claims;
    return claims;
  }
  let actualPort = port;
  const functionHandlers = createLocalFunctions({
    origin,
    environment,
    providerFetch,
    rpc,
    serviceRpc,
    url: () => 'http://127.0.0.1:' + actualPort,
    authenticate: async (accessToken) => {
      const claims = await activateClaims(verify(accessToken));
      const person = people.find((p) => p.id === claims.sub);
      return { id: person.id, role: person.role };
    },
  });
  const server = http.createServer((req, res) =>
    requestIdentity.run({}, async () => {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile,prefer,x-upsert,cache-control',
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const json = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      try {
        if (req.headers.origin && req.headers.origin !== origin)
          return json(403, { message: 'Origin is not allowed.' });
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
        const url = new URL(req.url, 'http://127.0.0.1:' + actualPort);
        if (url.pathname === '/local-demo/accounts' && req.method === 'GET')
          return json(200, {
            local_only: true,
            accounts: people.map(({ id, role, full_name }) => ({ id, role, full_name })),
          });
        if (url.pathname === '/local-demo/session' && req.method === 'POST') {
          const input = JSON.parse((await body(req)).toString());
          if (!people.some((p) => p.id === input.id))
            return json(400, { message: 'Choose a local demo account.' });
          return json(200, await session(input.id));
        }
        if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
          const input = JSON.parse((await body(req)).toString());
          if (url.searchParams.get('grant_type') !== 'refresh_token')
            return json(400, {
              message:
                'Use the clearly labelled local demo account picker. Cloud passwords are not accepted here.',
            });
          const claims = await activateClaims(verify(input.refresh_token, 'refresh'));
          return json(200, await session(claims.sub, claims.session_id));
        }
        if (url.pathname.startsWith('/storage/v1/object/sign/') && req.method === 'GET') {
          const claims = await activateClaims(verify(url.searchParams.get('token') || '', 'file'));
          const object = decodeURIComponent(url.pathname.slice('/storage/v1/object/sign/'.length));
          if (claims.object !== object)
            throw Object.assign(new Error('Signed file mismatch.'), { status: 403 });
          const [bucket, ...parts] = object.split('/');
          const row = await asActor(
            claims.sub,
            async () =>
              (
                await db.query('select * from storage.objects where bucket_id=$1 and name=$2', [
                  bucket,
                  parts.join('/'),
                ])
              ).rows[0],
          );
          if (!row) return json(404, { message: 'File is unavailable.' });
          const file = path.join(dataDir, 'files', row.id);
          if (!fs.existsSync(file)) return json(404, { message: 'File contents are unavailable.' });
          res.writeHead(200, {
            'Content-Type': row.metadata.mimetype || 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="evidence.' + row.metadata.extension + '"',
          });
          res.end(fs.readFileSync(file));
          return;
        }
        if (url.pathname === '/functions/v1/fyp-enquiries-v1') {
          const handler = createEnquiryHandler({
            origin,
            fingerprint: async () =>
              crypto
                .createHmac('sha256', key)
                .update(req.socket.remoteAddress || 'local')
                .digest('hex'),
            receive: async (input, hash) =>
              serialize(async () => {
                await db.exec('reset role');
                return (
                  await db.query(
                    'select public.fyp_engagement_receive_enquiry($1,$2,$3,$4,$5,$6,$7) value',
                    [
                      input.request_id,
                      input.name,
                      input.email,
                      input.plan,
                      input.brief,
                      input.consent,
                      hash,
                    ],
                  )
                ).rows[0].value;
              }),
          });
          const buffer = await body(req, 24576);
          const response = await handler(
            new Request(url, { method: req.method, headers: req.headers, body: buffer }),
          );
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(await response.text());
          return;
        }
        if (url.pathname === '/rest/v1/rpc/fyp_engagement_public_cases' && req.method === 'POST')
          return json(
            200,
            await serialize(async () => {
              await db.exec('reset role');
              await db.exec('set role anon');
              try {
                return (await db.query('select public.fyp_engagement_public_cases() value')).rows[0]
                  .value;
              } finally {
                await db.exec('reset role');
              }
            }),
          );
        const claims = await activateClaims(
          verify((req.headers.authorization || '').replace(/^Bearer /, '')),
        );
        const id = claims.sub;
        if (url.pathname === '/auth/v1/user' && req.method === 'GET')
          return json(200, authUser(id));
        if (url.pathname === '/auth/v1/logout' && req.method === 'POST') {
          await serialize(() =>
            db.query('update auth.sessions set not_after=now() where id=$1 and user_id=$2', [
              claims.session_id,
              id,
            ]),
          );
          res.writeHead(204);
          res.end();
          return;
        }
        if (url.pathname === '/rest/v1/fyp_profiles' && req.method === 'GET') {
          const wanted = url.searchParams.get('id')?.replace(/^eq\./, '') || id;
          const rows = await asActor(
            id,
            async () =>
              (
                await db.query('select id,full_name,role from public.fyp_profiles where id=$1', [
                  wanted,
                ])
              ).rows,
          );
          if (req.headers.accept?.includes('object+json'))
            return rows.length === 1
              ? json(200, rows[0])
              : json(406, { code: 'PGRST116', message: 'No accessible profile.' });
          return json(200, rows);
        }
        if (url.pathname.startsWith('/rest/v1/rpc/') && req.method === 'POST')
          return json(
            200,
            await rpc(
              id,
              url.pathname.slice('/rest/v1/rpc/'.length),
              JSON.parse((await body(req, 131072)).toString() || '{}'),
            ),
          );
        if (url.pathname.startsWith('/functions/v1/')) {
          const handler = functionHandlers[url.pathname.slice('/functions/v1/'.length)];
          if (!handler) return json(404, { error: 'This server function is unavailable.' });
          const buffer = await body(req, 131072);
          const response = await handler(
            new Request(url, {
              method: req.method,
              headers: req.headers,
              ...(req.method === 'POST' ? { body: buffer } : {}),
            }),
          );
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(await response.text());
          return;
        }
        if (url.pathname.startsWith('/storage/v1/object/authenticated/') && req.method === 'GET') {
          const object = decodeURIComponent(
            url.pathname.slice('/storage/v1/object/authenticated/'.length),
          );
          const [bucket, ...parts] = object.split('/');
          const row = await asActor(
            id,
            async () =>
              (
                await db.query(
                  'select id,metadata from storage.objects where bucket_id=$1 and name=$2',
                  [bucket, parts.join('/')],
                )
              ).rows[0],
          );
          if (!row) return json(404, { message: 'File is unavailable.' });
          const file = path.join(dataDir, 'files', row.id);
          if (!fs.existsSync(file)) return json(404, { message: 'File contents are unavailable.' });
          res.writeHead(200, { 'Content-Type': row.metadata.mimetype });
          res.end(fs.readFileSync(file));
          return;
        }
        if (url.pathname.startsWith('/storage/v1/object/sign/') && req.method === 'POST') {
          const object = decodeURIComponent(url.pathname.slice('/storage/v1/object/sign/'.length));
          const [bucket, ...parts] = object.split('/');
          const row = await asActor(
            id,
            async () =>
              (
                await db.query('select id from storage.objects where bucket_id=$1 and name=$2', [
                  bucket,
                  parts.join('/'),
                ])
              ).rows[0],
          );
          if (!row) return json(404, { message: 'File is unavailable.' });
          return json(200, {
            signedURL:
              '/object/sign/' + encodeURI(object) + '?token=' + token(id, 'file', 60, { object }),
          });
        }
        if (url.pathname.startsWith('/storage/v1/object/') && req.method === 'POST') {
          const object = decodeURIComponent(url.pathname.slice('/storage/v1/object/'.length));
          const [bucket, ...parts] = object.split('/');
          const name = parts.join('/');
          if (
            bucket !== 'fyp-v2-submissions' ||
            !['pdf', 'doc', 'docx'].includes(name.split('.').at(-1)) ||
            req.headers['x-upsert'] === 'true'
          )
            return json(400, { message: 'Only immutable private evidence uploads are allowed.' });
          const buffer = await body(req, 11 * 1024 * 1024);
          let data = buffer,
            mime = req.headers['content-type'] || 'application/octet-stream';
          if (mime.startsWith('multipart/form-data')) {
            const request = new Request('http://localhost/upload', {
              method: 'POST',
              headers: { 'content-type': mime },
              body: buffer,
            });
            const form = await request.formData();
            const file = [...form.values()].find(
              (v) => typeof v !== 'string' && typeof v.arrayBuffer === 'function',
            );
            if (!file) throw new Error('Missing upload file.');
            data = Buffer.from(await file.arrayBuffer());
            mime = file.type || 'application/octet-stream';
          }
          if (data.length < 1 || data.length > 10485760)
            return json(413, { message: 'Choose a nonempty file up to 10 MB.' });
          const allowedMime = {
            pdf: 'application/pdf',
            doc: 'application/msword',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }[name.split('.').at(-1)];
          if (mime === 'application/octet-stream') mime = allowedMime;
          if (mime !== allowedMime)
            return json(400, { message: 'Unsupported evidence MIME type.' });
          inspectDocument(new Uint8Array(data), name.split('/').at(-1));
          const row = await asActor(
            id,
            async () =>
              (
                await db.query(
                  'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb) returning id',
                  [
                    bucket,
                    name,
                    JSON.stringify({
                      size: data.length,
                      mimetype: mime,
                      extension: name.split('.').at(-1),
                    }),
                  ],
                )
              ).rows[0],
          );
          fs.mkdirSync(path.join(dataDir, 'files'), { recursive: true });
          fs.writeFileSync(path.join(dataDir, 'files', row.id), data, { mode: 0o600 });
          await serviceRpc('fyp_ops_record_document', {
            p_actor: id,
            p_path: name,
            p_size: data.length,
            p_sha256: crypto.createHash('sha256').update(data).digest('hex'),
            p_mime: mime,
          });
          return json(200, { Id: row.id, Key: bucket + '/' + name });
        }
        return json(404, { message: 'This endpoint is not available in the local demo.' });
      } catch (error) {
        const status =
          error.status ||
          (error.code === '42501'
            ? 403
            : error.code === '23505' || error.code === '40001'
              ? 409
              : error.code === 'PGRST202'
                ? 404
                : 400);
        json(status, {
          code: error.code || 'LOCAL_DEMO_ERROR',
          message: error.message || 'Local request failed.',
        });
      }
    }),
  );
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  actualPort = server.address().port;
  return {
    url: 'http://127.0.0.1:' + actualPort,
    people,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await queue;
      await db.close();
    },
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDirArgument = process.argv.indexOf('--data-dir');
  if (dataDirArgument >= 0 && !process.argv[dataDirArgument + 1])
    throw new Error('--data-dir requires a directory.');
  const app = await createLocalServer(
    dataDirArgument >= 0 ? { dataDir: path.resolve(process.argv[dataDirArgument + 1]) } : {},
  );
  console.log(
    'FYP Compass local PostgreSQL demo: ' +
      app.url +
      ' · 9 local-only accounts · no cloud connection',
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
