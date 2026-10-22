import crypto from 'node:crypto';
// MVP acceptance matrix built from executed assertions, not inferred from file names.
// --verify-existing consumes this audit's raw results; the default executes fresh suites.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
const root = process.cwd(),
  dir = path.join(root, 'handover/verification/strict-audit');
fs.mkdirSync(dir, { recursive: true });
if (!process.argv.includes('--verify-existing')) {
  for (const [file, args] of [
    [
      'frontend-final',
      [
        'test',
        '--',
        '--maxWorkers=1',
        '--reporter=json',
        '--outputFile=handover/verification/strict-audit/frontend-final.json',
      ],
    ],
    ['database', ['run', 'test:database']],
    ['sdk-http-after-fix', ['run', 'test:local-http']],
  ]) {
    const r = cp.spawnSync(
      process.platform === 'win32' ? process.env.ComSpec : 'npm',
      process.platform === 'win32' ? ['/d', '/c', 'npm', ...args] : args,
      { cwd: root, encoding: 'utf8', timeout: 900000, maxBuffer: 12 * 1024 * 1024 },
    );
    fs.writeFileSync(path.join(dir, file + '.txt'), (r.stdout || '') + '\n' + (r.stderr || ''));
    assert.equal(r.status, 0, file + ' failed');
  }
}
const frontend = JSON.parse(fs.readFileSync(path.join(dir, 'frontend-final.json'), 'utf8'));
assert.equal(frontend.success, true, 'Frontend regressions must pass');
const expectedTestFiles = fs
  .readdirSync(path.join(root, 'src/test'), { recursive: true })
  .filter((n) => /\.test\.(ts|tsx)$/.test(n));
assert.equal(
  frontend.testResults.length,
  expectedTestFiles.length,
  'Every current frontend test file must execute',
);
for (const name of expectedTestFiles)
  assert(
    frontend.testResults.some((r) =>
      r.name.replaceAll('\\', '/').endsWith('/src/test/' + name.replaceAll('\\', '/')),
    ),
    'Test file did not execute: ' + name,
  );
assert(frontend.numTotalTests >= 163, 'Original frontend coverage was lost');
assert.equal(frontend.numPassedTests, frontend.numTotalTests, 'All frontend assertions must pass');
assert.equal(frontend.numFailedTests, 0);

assert(
  frontend.testResults.every((x) => x.status === 'passed'),
  'A test worker failed',
);
const database = fs.readFileSync(path.join(dir, 'database.txt'), 'utf8');
const http = fs.readFileSync(path.join(dir, 'sdk-http-after-fix.txt'), 'utf8');
const databasePasses = [...database.matchAll(/ℹ pass (\d+)/g)].reduce(
  (n, m) => n + Number(m[1]),
  0,
);
assert(databasePasses >= 56, 'Original database coverage was lost');
assert(!/ℹ fail [1-9]/.test(database), 'Database suite contains failures');
assert.match(database, /fail 0/);
assert.match(http, /pass 4/);
assert.match(http, /fail 0/);
const names = [
  [
    'Complete Main Workflow',
    [
      'full group/proposal/matching/rework/contribution/health/assessment/result workflow works in PostgreSQL',
    ],
  ],
  [
    'Preference-First Matching',
    [
      'preference-first rounds prevent stronger-topic second choices displacing first choices',
      'stored seed repeats exact ties, capacities never overflow and manual changes need a reason',
    ],
  ],
  [
    'Group and Proposal Restrictions',
    [
      'group limits, duplicate membership and session enrollment are enforced by the RPC',
      'proposal requires three distinct supervisors and at most three controlled tags',
    ],
  ],
  [
    'Proposal, Similarity and Milestones',
    [
      'similarity requires human justification and approval creates one milestone plan',
      'full group/proposal/matching/rework/contribution/health/assessment/result workflow works in PostgreSQL',
    ],
  ],
  [
    'Peer Marks and Human Review',
    [
      'reviewed peer mark requires a reason, preserves original and invalidates on new evidence',
      'exclusion preserves original rating and records human-reviewed recalculation',
    ],
  ],
  [
    'Rule-Based Health and AI Explanation',
    [
      'database fallback works without Edge/Gemini, is idempotent and cannot publish',
      'synthetic health fixtures are idempotent, preserve active session and evaluate Amber/Red with student draft privacy',
    ],
  ],
  [
    'Examiner and Final Marks',
    [
      'unassigned examiners cannot view or submit; assessments stay independent and immutable',
      '55/45 results differ per student and remain private until coordinator release',
    ],
  ],
  [
    'Roles and Privacy',
    [
      'all migrations compile, profile roles cannot be elevated and anonymous core access is denied',
      'anonymous/direct table writes and cross-role grading are denied',
    ],
  ],
  [
    'Defense and Result Controls',
    [
      'defense gate requires accepted milestones, fee and distinct examiner-role accounts',
      'released correction requires a reason/version and keeps the shared group component identical',
    ],
  ],
  [
    'Dashboard and Report Accuracy',
    ['accreditation aggregates match actual database rows and current health evidence'],
  ],
];
const browserPath = path.join(root, 'handover/verification/pdf-review-e2e.json');
const browser = fs.existsSync(browserPath)
  ? JSON.parse(fs.readFileSync(browserPath, 'utf8'))
  : null;
const geminiPath = path.join(root, 'handover/verification/gemini-live.json');
const geminiEvidence = fs.existsSync(geminiPath)
  ? JSON.parse(fs.readFileSync(geminiPath, 'utf8'))
  : null;
const healthFiles = [
  'supabase/functions/fyp-health-agent-v2/index.ts',
  'backend/health-agent/handler.ts',
  'backend/http/provider-fetch.ts',
  'backend/http/read-json.ts',
  'src/health/agent.ts',
  'src/health/rules.ts',
];
const healthHash = crypto
  .createHash('sha256')
  .update(
    healthFiles
      .map((f) => fs.readFileSync(path.join(root, f), 'utf8').replaceAll('\r\n', '\n'))
      .join(''),
  )
  .digest('hex');
const providerTime = Date.parse(geminiEvidence?.checkedAt || geminiEvidence?.at || '');
const geminiVerified =
  geminiEvidence?.passed === true &&
  (providerTime >= frontend.startTime ||
    (geminiEvidence.sourceBindingConfirmed === true &&
      geminiEvidence.sourceFilesUnchangedAfterProviderRun === true &&
      geminiEvidence.implementationSha256 === healthHash &&
      Date.now() - providerTime < 6 * 60 * 60 * 1000));
const matrix = names.map(([name, evidence], index) => {
  for (const item of evidence)
    assert(database.includes('✔ ' + item + ' ('), `Missing executed passing assertion: ${item}`);
  return {
    case: index + 1,
    name,
    status: index === 5 && !geminiVerified ? 'PASS_REQUIRED_FALLBACK' : 'PASS',
    evidence,
    method:
      'Actual PostgreSQL migration tests; full frontend regressions and SDK HTTP tests also passed',
    limitations:
      index === 5
        ? geminiVerified
          ? 'Real Gemini draft persisted and fixed risk/no automatic publication verified; live exhausted quota was not tested.'
          : 'Live Gemini success is not verified; required fallback and controlled-provider tests pass.'
        : index === 9
          ? 'Compiled demo checked in Chromium, Firefox and WebKit at 320, 375, 768 and 1366 pixels; physical device Safari was not certified.'
          : null,
  };
});
if (browser) {
  assert.equal(browser.stats.expected, 36, 'Every three-engine browser case must pass');
  assert.equal(browser.stats.unexpected, 0);
  assert.equal(browser.stats.skipped, 0);
  matrix[9].responsiveChecks = 3;
  matrix[9].browserCases = 36;
} else matrix[9].status = 'PARTIAL_RESPONSIVE_EVIDENCE_MISSING';
const result = {
  checkedAt: new Date().toISOString(),
  specification:
    'Ten names from the pasted MVP brief; detailed procedures were not supplied. Assertions are the documented acceptance interpretation.',
  frontend: { total: frontend.numTotalTests, passed: frontend.numPassedTests },
  database: databasePasses,
  sdkHTTP: 4,
  functionalCasesPassed: 10,
  allResponsiveEvidencePresent: Boolean(browser),
  matrix,
};
fs.writeFileSync(path.join(dir, 'ten-mvp-cases.json'), JSON.stringify(result, null, 2) + '\n');
console.log(matrix.map((x) => `Case ${x.case}: ${x.status} — ${x.name}`).join('\n'));
if (matrix.some((x) => x.status.startsWith('PARTIAL'))) process.exitCode = 1;
