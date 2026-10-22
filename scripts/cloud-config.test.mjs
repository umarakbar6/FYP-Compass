import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const key = (role = 'anon', ref = 'cloudtest') =>
  Buffer.from('{}').toString('base64url') +
  '.' +
  Buffer.from(JSON.stringify({ role, ref })).toString('base64url') +
  '.test';
const base = {
  ...process.env,
  VITE_SUPABASE_URL: 'https://cloudtest.supabase.co',
  VITE_SUPABASE_ANON_KEY: key(),
  VITE_LOCAL_BACKEND: 'false',
  VITE_DEMO_MODE: 'false',
  VITE_BACKEND_API: 'v2',
};
for (const [name, changes, ok] of [
  ['public config', {}, true],
  ['QA enabled exact', { VITE_QA_REVIEW_ENABLED: 'true' }, true],
  ['QA disabled exact', { VITE_QA_REVIEW_ENABLED: 'false' }, true],
  ['QA newline rejected', { VITE_QA_REVIEW_ENABLED: 'true\r\n' }, false],
  ['QA case rejected', { VITE_QA_REVIEW_ENABLED: 'True' }, false],
  ['missing URL', { VITE_SUPABASE_URL: '' }, false],
  ['localhost', { VITE_SUPABASE_URL: 'http://127.0.0.1:54329' }, false],
  ['missing key', { VITE_SUPABASE_ANON_KEY: '' }, false],
  ['secret key', { VITE_SUPABASE_ANON_KEY: 'sb_secret_test' }, false],
  ['management token', { VITE_SUPABASE_ANON_KEY: 'sbp_test' }, false],
  ['service role', { VITE_SUPABASE_ANON_KEY: key('service_role') }, false],
  ['local backend', { VITE_LOCAL_BACKEND: 'true' }, false],
  ['demo mode', { VITE_DEMO_MODE: 'true' }, false],
  ['legacy API', { VITE_BACKEND_API: 'legacy' }, false],
  ['malformed key', { VITE_SUPABASE_ANON_KEY: 'invalid' }, false],
  ['mismatched project', { VITE_SUPABASE_URL: 'https://different.supabase.co' }, false],
  ['AI key prefix rejected', { VITE_GEMINI_API_KEY: 'synthetic-secret' }, false],
  ['SMTP password prefix rejected', { VITE_SMTP_PASSWORD: 'synthetic-secret' }, false],
  ['unknown public variable rejected', { VITE_UNREVIEWED_FLAG: 'true' }, false],
  [
    'database URI rejected',
    { VITE_SUPPORT_EMAIL: 'postgresql://user:password@db.example/db' },
    false,
  ],
  ['service token in public field rejected', { VITE_SUPPORT_EMAIL: key('service_role') }, false],
  ['public app origin accepted', { VITE_APP_ORIGIN: 'https://fyp.example' }, true],
  ['public site key accepted', { VITE_TURNSTILE_SITE_KEY: 'public-site-key' }, true],
])
  test('cloud configuration: ' + name, () => {
    const result = spawnSync(process.execPath, ['scripts/check-cloud-env.mjs'], {
      env: { ...base, ...changes },
      encoding: 'utf8',
    });
    assert.equal(result.status === 0, ok);
  });
