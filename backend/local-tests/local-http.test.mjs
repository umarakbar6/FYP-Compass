import { createLocalServer } from './local-server.mjs';
import { createClient } from '@supabase/supabase-js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
let server, clients;
before(async () => {
  server = await createLocalServer({ port: 0, memory: true });
  clients = {};
  for (const p of server.people) {
    const response = await fetch(server.url + '/local-demo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id }),
    });
    const session = await response.json();
    const client = createClient(server.url, 'local-demo-public-client', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signed = await client.auth.setSession(session);
    assert.equal(signed.error, null);
    clients[p.full_name] = client;
  }
});
after(async () => {
  for (const c of Object.values(clients || {})) c.auth.stopAutoRefresh();
  await server?.close();
});
async function rpc(client, name, args) {
  const result = await client.rpc(name, args);
  assert.equal(result.error, null, result.error?.message);
  return result.data;
}
test('actual Supabase SDK sign-in, profile access and role-scoped RPCs work through the local HTTP bridge', async () => {
  const student = clients['Student One'],
    coord = clients['Demo Coordinator'];
  const profile = await student.from('fyp_profiles').select('id,full_name,role').single();
  assert.equal(profile.error, null);
  assert.equal(profile.data.role, 'student');
  const other = await student
    .from('fyp_profiles')
    .select('id,full_name,role')
    .eq('id', server.people.find((p) => p.role === 'coordinator').id)
    .single();
  assert(other.error);
  const ws = await rpc(student, 'fyp_v2_core_get_student_workspace');
  assert.equal(ws.supervisors.length, 3);
  const denied = await student.rpc('fyp_v2_core_report');
  assert.equal(denied.error.code, '42501');
  const report = await rpc(coord, 'fyp_v2_core_accreditation');
  assert.equal(report.groups.length, 0);
  assert.equal(report.participants.length, 6);
});
test('shared group/proposal/matching/approval, binary upload and signed download work with the same SDK as the frontend', async () => {
  const student = clients['Student One'],
    coord = clients['Demo Coordinator'];
  const workspace = await rpc(student, 'fyp_v2_core_get_student_workspace');
  let w = await rpc(student, 'fyp_v2_core_create_student_group', {
    p_name: 'HTTP Team',
    p_session_id: workspace.session.id,
    p_member_ids: server.people
      .filter((p) => p.role === 'student' && p.full_name !== 'Student One')
      .map((p) => p.id),
  });
  w = await rpc(student, 'fyp_v2_core_save_student_proposal', {
    p_group_id: w.group.id,
    p_title: 'Academic supervision portal',
    p_abstract: 'Manage group proposals and assessments',
    p_keywords: ['academic'],
    p_topic_ids: workspace.topics.map((t) => t.id),
    p_supervisor_ids: workspace.supervisors.map((s) => s.id),
    p_document: null,
    p_submit: true,
  });
  await rpc(coord, 'fyp_v2_core_match', { p_seed: 'sdk-seed' });
  const allocated = await rpc(student, 'fyp_v2_core_get_student_workspace');
  const supervisorName = server.people.find(
    (p) => p.id === allocated.allocation.supervisor_id,
  ).full_name;
  const supervisor = clients[supervisorName];
  await rpc(supervisor, 'fyp_v2_core_run_similarity_screen', { p_proposal_id: w.proposal.id });
  await rpc(supervisor, 'fyp_v2_core_review_supervisor_proposal', {
    p_proposal_id: w.proposal.id,
    p_action: 'approve',
    p_comment: '',
    p_justification: '',
    p_expected_status: 'submitted',
  });
  const ms = await rpc(student, 'fyp_v2_core_get_milestone_workspace');
  const m = ms.projects[0].milestones[0];
  const studentId = server.people.find((p) => p.full_name === 'Student One').id;
  const file = studentId + '/' + allocated.group.id + '/' + m.id + '/evidence.pdf';
  const bytes = new TextEncoder().encode(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n',
  );
  const upload = await student.storage
    .from('fyp-v2-submissions')
    .upload(file, new Blob([bytes], { type: 'application/pdf' }));
  assert.equal(upload.error, null, upload.error?.message);
  await rpc(student, 'fyp_v2_core_submit_student_milestone', {
    p_milestone_id: m.id,
    p_document: { name: 'evidence.pdf', path: file, size: bytes.length },
    p_statement: 'Implemented the portal.',
    p_expected_submission_id: null,
  });
  const signed = await supervisor.storage.from('fyp-v2-submissions').createSignedUrl(file, 60);
  assert.equal(signed.error, null, signed.error?.message);
  const downloaded = await fetch(signed.data.signedUrl);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), bytes);
  const invalid = await fetch(signed.data.signedUrl.replace(/token=.*/, 'token=invalid'));
  assert.equal(invalid.status, 401);
  const health = await rpc(supervisor, 'get_health_workspace');
  assert.equal(health.projects[0].health.level, 'amber');
  const draft = await rpc(supervisor, 'create_group_health_fallback', {
    p_project_id: allocated.group.id,
  });
  assert.equal(draft.reports[0].source, 'fallback');
  assert.equal(draft.notices.length, 0);
});
test('invalid JWTs, disallowed browser origins and oversized bodies are rejected', async () => {
  const anonymous = await fetch(server.url + '/rest/v1/rpc/fyp_v2_core_report', {
    method: 'POST',
    headers: { Authorization: 'Bearer fake', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(anonymous.status, 401);
  const wrongOrigin = await fetch(server.url + '/local-demo/accounts', {
    headers: { Origin: 'https://unrelated.example' },
  });
  assert.equal(wrongOrigin.status, 403);
  const large = await fetch(server.url + '/local-demo/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'x'.repeat(17000),
  });
  assert.equal(large.status, 413);
});

test('browser Auth SDK preflight permits its version header only for the configured loopback origin', async () => {
  const requested = [
    'authorization',
    'apikey',
    'content-type',
    'x-client-info',
    'x-supabase-api-version',
    'accept-profile',
    'content-profile',
    'prefer',
  ];
  const response = await fetch(server.url + '/auth/v1/user', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1:5182',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': requested.join(','),
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5182');
  const allowed = response.headers
    .get('access-control-allow-headers')
    .toLowerCase()
    .split(',')
    .map((x) => x.trim());
  assert(requested.every((x) => allowed.includes(x)));
  const denied = await fetch(server.url + '/auth/v1/user', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://unrelated.example',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': requested.join(','),
    },
  });
  assert.equal(denied.status, 403);
});

test('complete production RPC registry serves advanced dashboards while service functions stay private', async () => {
  const coordinator = clients['Demo Coordinator'];
  for (const name of [
    'fyp_v2_core_report',
    'fyp_v2_assessment_workspace',
    'fyp_privacy_requests',
  ]) {
    const data = await rpc(coordinator, name);
    assert(data !== null);
  }
  const student = clients['Student One'];
  const own = await rpc(student, 'fyp_privacy_submit', {
    p_kind: 'export',
    p_detail: 'Please review my own account information.',
    p_confirm: true,
  });
  assert.equal(own.length, 1);
  assert.deepEqual(await rpc(clients['Student Two'], 'fyp_privacy_requests'), []);
  const service = await student.rpc('fyp_ops_record_document', {
    p_actor: server.people[0].id,
    p_path: 'spoof.pdf',
    p_size: 1,
    p_sha256: 'a'.repeat(64),
    p_mime: 'application/pdf',
  });
  assert(service.error, 'Browser callers must never execute service-only attestations');
});

test('production assistant endpoint enforces consent before provider access and fails honestly without a key', async () => {
  const session = (await clients['Student One'].auth.getSession()).data.session;
  const invoke = (body) =>
    fetch(server.url + '/functions/v1/fyp-assistants-v1', {
      method: 'POST',
      headers: {
        Origin: 'http://127.0.0.1:5182',
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  const denied = await invoke({
    kind: 'support',
    project_id: null,
    question: 'How do I submit?',
    consent: false,
  });
  assert.equal(denied.status, 400);
  const unavailable = await invoke({
    kind: 'support',
    project_id: null,
    question: 'How do I submit?',
    consent: true,
  });
  assert.equal(unavailable.status, 503);
  const payload = await unavailable.json();
  assert(payload.error);
  assert(!payload.draft, 'An unavailable provider must not create a fake successful answer');
});

test('unsafe active PDF uploads are rejected before a private document can be registered', async () => {
  const student = clients['Student One'];
  const w = await rpc(student, 'fyp_v2_core_get_student_workspace');
  const path = server.people[0].id + '/' + w.group.id + '/active-content.pdf';
  const bytes = new Blob(['%PDF-1.4\n/JavaScript (alert(1))\n%%EOF\n'], {
    type: 'application/pdf',
  });
  const result = await student.storage.from('fyp-v2-submissions').upload(path, bytes);
  assert(result.error);
  assert.match(result.error.message, /active|embedded/i);
});

test('logout revokes access and refresh tokens even after a separate new login', async () => {
  const person = server.people.find((p) => p.full_name === 'Student Three');
  const login = async () => {
    const response = await fetch(server.url + '/local-demo/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: person.id }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const old = await login();
  const logout = await fetch(server.url + '/auth/v1/logout', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + old.access_token },
  });
  assert.equal(logout.status, 204);
  const current = await login();
  const check = (token) =>
    fetch(server.url + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token },
    });
  assert.equal((await check(current.access_token)).status, 200);
  assert.equal((await check(old.access_token)).status, 401);
  const refresh = await fetch(server.url + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: old.refresh_token }),
  });
  assert.equal(refresh.status, 401);
});

test('shared production AI handler validates controlled provider output and persists only private advisory drafts', async () => {
  let providerCalls = 0,
    unsafe = false;
  const app = await createLocalServer({
    port: 0,
    memory: true,
    environment: {
      GEMINI_API_KEY: 'synthetic-controlled-provider',
      GEMINI_MODEL: 'synthetic-model',
    },
    providerFetch: async () => {
      providerCalls++;
      const draft = {
        summary: unsafe
          ? '<script>unsafe()</script>'
          : 'Create your group from the student workspace.',
        findings: ['Use the configured active session.'],
        actions: ['Contact the coordinator for enrollment help.'],
        references: [],
      };
      return new Response(
        JSON.stringify({
          candidates: [
            { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(draft) }] } },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    },
  });
  try {
    const login = async (name) => {
      const p = app.people.find((p) => p.full_name === name);
      return (
        await fetch(app.url + '/local-demo/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: p.id }),
        })
      ).json();
    };
    const one = await login('Student One'),
      two = await login('Student Two');
    const headers = (token) => ({
      Origin: 'http://127.0.0.1:5182',
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    });
    const invoke = (session, kind = 'support', consent = true) =>
      fetch(app.url + '/functions/v1/fyp-assistants-v1', {
        method: 'POST',
        headers: headers(session.access_token),
        body: JSON.stringify({
          kind,
          project_id: null,
          question: 'How do I create a group?',
          consent,
        }),
      });
    assert.equal((await invoke(one, 'support', false)).status, 400);
    assert.equal(providerCalls, 0);
    assert.equal((await invoke(one, 'report')).status, 403);
    assert.equal(providerCalls, 0);
    const generated = await invoke(one);
    assert.equal(generated.status, 200, JSON.stringify(await generated.clone().json()));
    const result = await generated.json();
    assert.equal(result.requires_human_approval, true);
    assert.equal(result.draft.summary, 'Create your group from the student workspace.');
    const history = async (session) =>
      (
        await fetch(app.url + '/rest/v1/rpc/fyp_agents_history', {
          method: 'POST',
          headers: headers(session.access_token),
          body: '{}',
        })
      ).json();
    assert.equal((await history(one))[0].draft.summary, result.draft.summary);
    assert.deepEqual(await history(two), []);
    unsafe = true;
    assert.equal((await invoke(two)).status, 503);
    const failed = await history(two);
    assert.equal(failed[0].status, 'failed');
    assert.equal(failed[0].draft, null);
    assert.equal(providerCalls, 2);
  } finally {
    await app.close();
  }
});

test('database, private file bytes and an active session survive a complete local backend restart', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fyp-persistence-'));
  let app, client;
  try {
    app = await createLocalServer({ port: 0, dataDir });
    const person = app.people.find(p => p.full_name === 'Student One');
    const session = await (await fetch(app.url + '/local-demo/session', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: person.id }) })).json();
    const connect = async () => {
      client = createClient(app.url, 'local-demo-public-client', { auth: { persistSession: false, autoRefreshToken: false } });
      const signed = await client.auth.setSession(session);
      assert.equal(signed.error, null);
    };
    await connect();
    const workspace = await rpc(client, 'fyp_v2_core_get_student_workspace');
    const created = await rpc(client, 'fyp_v2_core_create_student_group', {
      p_name: 'Persistent academic project', p_session_id: workspace.session.id, p_member_ids: [],
    });
    const name = person.id + '/' + created.group.id + '/persistent.pdf';
    const bytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
    const uploaded = await client.storage.from('fyp-v2-submissions').upload(name, new Blob([bytes], { type: 'application/pdf' }));
    assert.equal(uploaded.error, null, uploaded.error?.message);
    client.auth.stopAutoRefresh();
    await app.close(); app = null;
    app = await createLocalServer({ port: 0, dataDir });
    await connect();
    const restored = await rpc(client, 'fyp_v2_core_get_student_workspace');
    assert.equal(restored.group.id, created.group.id);
    assert.equal(restored.group.name, created.group.name);
    const signed = await client.storage.from('fyp-v2-submissions').createSignedUrl(name, 60);
    assert.equal(signed.error, null, signed.error?.message);
    const downloaded = await fetch(signed.data.signedUrl);
    assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  } finally {
    client?.auth.stopAutoRefresh();
    await app?.close();
    const target = path.resolve(dataDir), parent = path.resolve(os.tmpdir());
    assert(target.startsWith(parent + path.sep) && path.basename(target).startsWith('fyp-persistence-'));
    fs.rmSync(target, { recursive: true, force: true });
  }
});
