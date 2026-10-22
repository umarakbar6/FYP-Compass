import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  newPlan,
  validatePlan,
  validateAdmin,
  validatePublic,
  provision,
  projectRef,
} from './demo-accounts.mjs';
function harness() {
  const users = [];
  const profiles = new Map();
  let created = 0;
  return {
    users,
    profiles,
    get created() {
      return created;
    },
    api: {
      list: async () => users,
      create: async (input) => {
        created++;
        const u = { ...input, id: 'demo-' + created };
        users.push(u);
        return u;
      },
      profile: async (p) => profiles.set(p.id, p),
      verify: async (a) => profiles.get(a.id),
    },
  };
}
test('private plan has all workflow roles and independent strong passwords', () => {
  const p = newPlan();
  validatePlan(p);
  assert.equal(p.status, 'unprovisioned');
  assert.equal(p.accounts.filter((a) => a.role === 'examiner').length, 2);
  assert.equal(p.accounts.filter((a) => a.role === 'student').length, 3);
  assert.equal(new Set(p.accounts.map((a) => a.password)).size, 9);
  assert.equal(newPlan().run === p.run, false);
});
test('verification cannot use an elevated or another project key', () => {
  const jwt = (c) => `x.${Buffer.from(JSON.stringify(c)).toString('base64url')}.x`;
  assert.throws(() => validatePublic('sb_secret_test'));
  assert.throws(() => validatePublic(jwt({ role: 'service_role', ref: projectRef })));
  assert.throws(() => validatePublic(jwt({ role: 'anon', ref: 'other' })));
  validatePublic(jwt({ role: 'anon', ref: projectRef }));
});
test('public key and wrong target cannot authorize creation', () => {
  const jwt = (payload) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.x`;
  assert.throws(() =>
    validateAdmin(`https://${projectRef}.supabase.co`, jwt({ role: 'anon', ref: projectRef })),
  );
  assert.throws(() => validateAdmin('https://other.supabase.co', 'sb_secret_test'));
  assert.throws(() =>
    validateAdmin(`https://${projectRef}.supabase.co`, jwt({ role: 'service_role', ref: 'other' })),
  );
  validateAdmin(
    `https://${projectRef}.supabase.co`,
    jwt({ role: 'service_role', ref: projectRef }),
  );
});
test('collision is rejected before any mutation or journal rewrite', async () => {
  const h = harness(),
    p = newPlan();
  h.users.push({ id: 'real-user', email: p.accounts[3].email, app_metadata: {} });
  let writes = 0;
  await assert.rejects(
    provision(p, h.api, () => writes++),
    /collision/,
  );
  assert.equal(h.created, 0);
  assert.equal(writes, 0);
  assert.equal(h.profiles.size, 0);
});
test('provisioning verifies public signed-in profiles and retries without new users', async () => {
  const h = harness(),
    p = newPlan();
  await provision(p, h.api, () => {});
  assert.equal(h.created, 9);
  assert.equal(p.status, 'login-verified');
  await provision(p, h.api, () => {});
  assert.equal(h.created, 9);
  assert.equal(h.profiles.size, 9);
});
test('failed profile creation leaves resumable auth identity, never falsely complete', async () => {
  const h = harness(),
    p = newPlan();
  const fail = {
    ...h.api,
    profile: async () => {
      throw new Error('schema mismatch');
    },
  };
  await assert.rejects(
    provision(p, fail, () => {}),
    /schema/,
  );
  assert.equal(p.status, 'provisioning');
  assert.equal(p.accounts[0].status, 'auth-created');
  await provision(p, h.api, () => {});
  assert.equal(h.created, 9);
  assert.equal(p.status, 'login-verified');
});
test('incorrect live profile cannot be marked login verified', async () => {
  const h = harness(),
    p = newPlan();
  await assert.rejects(
    provision(
      p,
      { ...h.api, verify: async (a) => ({ id: a.id, role: 'student', full_name: 'wrong' }) },
      () => {},
    ),
    /verification/,
  );
  assert.notEqual(p.status, 'login-verified');
  assert.equal(p.accounts[0].status, 'profile-created');
});
test('tampered identity or role is rejected before remote work', async () => {
  const h = harness(),
    p = newPlan();
  p.accounts[0].role = 'coordinator';
  await assert.rejects(
    provision(p, h.api, () => {}),
    /Invalid/,
  );
  assert.equal(h.created, 0);
});
test('private account folder is excluded from repository and handover packaging', () => {
  if (fs.existsSync('.gitignore')) {
    assert.match(fs.readFileSync('.gitignore', 'utf8'), /\.private\//);
  } else {
    assert.equal(
      process.env.VERCEL,
      '1',
      'Repository ignore file must exist outside a Vercel build',
    );
    const privateFiles = fs.existsSync('.private')
      ? fs
          .readdirSync('.private', { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
      : [];
    assert.equal(
      privateFiles.length,
      0,
      'Private file contents must never reach the cloud build: ' +
        privateFiles.map((entry) => entry.name).join(', '),
    );
  }
  assert.match(
    fs.readFileSync('scripts/package-handover.mjs', 'utf8'),
    /skipDirs\s*=\s*new Set\(\[\s*'\.private'/,
  );
});
