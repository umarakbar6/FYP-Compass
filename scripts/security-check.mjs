import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const excluded = new Set([
  '.private',
  '.git',
  '.vercel',
  'node_modules',
  'dist',
  'handover',
  'coverage',
  'test-results',
  'playwright-report',
  'source-archives',
  '.npm-cache',
]);
const problems = [];
let count = 0;
function walk(folder) {
  for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (!excluded.has(e.name)) walk(file);
      continue;
    }
    if (
      /\.zip$|\.tsbuildinfo$/.test(e.name) ||
      e.name === '.env' ||
      (e.name.startsWith('.env.') &&
        !['.env.example', '.env.demo', '.env.v2', '.env.localbackend'].includes(e.name))
    )
      continue;
    const bytes = fs.readFileSync(file);
    count++;
    const relative = path.relative(root, file).replaceAll('\\', '/');
    if (!bytes.length) problems.push({ file: relative, reason: 'empty file' });
    if (
      /\.(?:ts|tsx|mjs|js|json|md|sql|txt|ya?ml|toml|html|css)$/.test(e.name) ||
      e.name.startsWith('.env')
    ) {
      const text = bytes.toString('utf8');
      for (const [reason, pattern] of [
        ['private signing key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
        ['provider key', /AIza[\w-]{30,}/],
        ['Supabase secret', /sb_secret_[\w-]{15,}/],
        ['management credential', /sbp_(?:oauth_|v0_)?[a-f0-9]{40}/],
      ])
        if (pattern.test(text)) problems.push({ file: relative, reason });
    }
  }
}
walk(root);
const run = (args) => {
  const r = cp.spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 5 * 1024 * 1024,
  });
  return {
    passed: r.status === 0,
    exitCode: r.status,
    output: (r.stdout || '') + (r.stderr || ''),
  };
};
const guards = run([
  '--test',
  'scripts/cloud-config.test.mjs',
  'scripts/browser-security.test.mjs',
  'scripts/provider-environment.test.mjs',
  'scripts/release-integrity.test.mjs',
]);
const migration = run(['scripts/generate-installers.mjs', '--check']);
const audit = process.env.npm_execpath
  ? run([process.env.npm_execpath, 'audit', '--json', '--ignore-scripts'])
  : null;
let vulnerabilityCounts = null;
try {
  vulnerabilityCounts = JSON.parse(audit?.output || '{}').metadata?.vulnerabilities || null;
} catch {
  /* Invalid audit output is a failure, never zero vulnerabilities. */
}
const report = {
  checkedAt: new Date().toISOString(),
  sourceFiles: count,
  sourceFindings: problems,
  guardsPassed: guards.passed,
  migrationsCurrent: migration.passed,
  vulnerabilityCounts,
  dependencyAuditPassed: Boolean(audit?.passed && vulnerabilityCounts),
  scope:
    'Local code/config checks and npm advisory audit. Not independent penetration testing or platform-account MFA verification.',
};
report.passed =
  !problems.length &&
  report.guardsPassed &&
  report.migrationsCurrent &&
  report.dependencyAuditPassed;
fs.mkdirSync(path.join(root, 'handover/verification'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'handover/verification/security-maintenance.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
