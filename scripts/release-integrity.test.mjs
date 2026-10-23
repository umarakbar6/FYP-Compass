import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReleaseManifest } from './create-release-manifest.mjs';

for (const folder of ['http', 'health-agent', 'agents']) {
  test('release fingerprint detects shared backend ' + folder + ' source changes', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fyp-release-security-'));
    try {
      fs.mkdirSync(path.join(temp, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(temp, 'dist', 'app.js'), '/* synthetic asset */');
      const target = path.join(temp, 'backend', folder, 'handler.ts');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'export const policy = 1;');
      const before = createReleaseManifest(temp, {});
      fs.writeFileSync(target, 'export const policy = 2;');
      const after = createReleaseManifest(temp, {});
      assert.notEqual(before.sourceFingerprint, after.sourceFingerprint);
      const manifest = JSON.parse(fs.readFileSync(path.join(temp, 'dist', 'release.json')));
      assert(manifest.sources.some(({ file }) => file === 'backend/' + folder + '/handler.ts'));
      assert.equal(before.assets, after.assets);
    } finally {
      const resolved = path.resolve(temp);
      assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
      assert(path.basename(resolved).startsWith('fyp-release-security-'));
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });
}
