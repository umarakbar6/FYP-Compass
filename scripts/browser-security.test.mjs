import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBrowserOutput } from './check-browser-output.mjs';
const token = (role) =>
  Buffer.from('{"alg":"HS256"}').toString('base64url') +
  '.' +
  Buffer.from(JSON.stringify({ role })).toString('base64url') +
  '.synthetic';
for (const [name, text, environment, allowed] of [
  ['public anon key', token('anon'), {}, true],
  ['elevated key', token('service_role'), {}, false],
  ['user access token', token('authenticated'), {}, false],
  [
    'actual server password',
    'const leaked="synthetic-long-smtp-password"',
    { FYP_SMTP_APP_PASSWORD: 'synthetic-long-smtp-password' },
    false,
  ],
  ['AI provider credential', 'AIza' + 'x'.repeat(35), {}, false],
])
  test('browser build secret guard: ' + name, () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fyp-browser-security-'));
    try {
      fs.writeFileSync(path.join(folder, 'bundle.js'), text);
      if (allowed)
        assert.equal(checkBrowserOutput(folder, environment).noDetectedServerSecrets, true);
      else assert.throws(() => checkBrowserOutput(folder, environment));
    } finally {
      if (
        !path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
        !path.basename(folder).startsWith('fyp-browser-security-')
      )
        throw Error('Unsafe test cleanup path');
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
