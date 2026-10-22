import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from 'vite';
import {
  publicEnvironmentNames,
  stripAutomaticVercelMetadata,
  assertPublicEnvironment,
} from './public-environment.mjs';
test('Vercel automatic metadata is omitted without weakening the app public variable guard', () => {
  const environment = {
    VITE_VERCEL_GIT_REPO_ID: 'synthetic-id',
    VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG: 'synthetic-provider-metadata',
    VITE_VERCEL_HASH_SALT: 'synthetic-unused-salt',
    VITE_SUPABASE_URL: 'https://owned.supabase.co',
  };
  stripAutomaticVercelMetadata(environment);
  assert.deepEqual(environment, { VITE_SUPABASE_URL: 'https://owned.supabase.co' });
  assertPublicEnvironment(environment);
});
test('unknown provider names and credentials remain rejected', () => {
  for (const name of [
    'VITE_GEMINI_API_KEY',
    'VITE_VERCEL_OIDC_TOKEN',
    'VITE_VERCEL_UNKNOWN_SECRET',
  ]) {
    const environment = { [name]: 'synthetic-server-secret' };
    assert.throws(() => {
      stripAutomaticVercelMetadata(environment);
      assertPublicEnvironment(environment);
    });
  }
});
test('the actual Vite browser prefix list excludes provider metadata and unapproved variables', () => {
  const keys = ['VITE_VERCEL_GIT_REPO_ID', 'VITE_VERCEL_HASH_SALT', 'VITE_GEMINI_API_KEY'];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const key of keys) process.env[key] = 'synthetic-server-value';
    const browser = loadEnv('production', process.cwd(), [...publicEnvironmentNames]);
    for (const key of keys) assert(!Object.hasOwn(browser, key));
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

import { canonicalPublicRouting } from './portable-routing.mjs';
test('provider formatting and injected build environment do not change public routing hashes', () => {
  const intended = {
    rewrites: [{ source: '/app', destination: '/index.html' }],
    headers: [{ source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }],
  };
  const platform = {
    ...intended,
    $schema: 'metadata-only',
    build: { env: { SERVER_SECRET: 'synthetic-server-value' } },
  };
  assert.equal(canonicalPublicRouting(intended), canonicalPublicRouting(platform));
  assert(!canonicalPublicRouting(platform).includes('synthetic-server-value'));
});
test('changing a routing or security control changes its integrity input', () => {
  assert.notEqual(
    canonicalPublicRouting({ headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }),
    canonicalPublicRouting({ headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }] }),
  );
});
