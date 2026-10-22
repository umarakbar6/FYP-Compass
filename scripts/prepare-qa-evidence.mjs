// Local preparation only. This script never contacts an AI provider or reads environment/private files.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const frontend = JSON.parse(
  fs.readFileSync('handover/verification/strict-audit/frontend-final.json', 'utf8'),
);
const browser = JSON.parse(fs.readFileSync('handover/verification/pdf-review-e2e.json', 'utf8'));
const database = fs.readFileSync('handover/verification/strict-audit/database.txt', 'utf8');
const sdk = fs.readFileSync('handover/verification/strict-audit/sdk-http-after-fix.txt', 'utf8');
assert(
  frontend.success &&
    frontend.numTotalTests >= 190 &&
    frontend.numPassedTests === frontend.numTotalTests &&
    frontend.numFailedTests === 0,
);
assert(
  browser.stats.expected === 36 &&
    browser.stats.unexpected === 0 &&
    browser.stats.skipped === 0 &&
    browser.errors.length === 0,
);
const databasePassed = [...database.matchAll(/pass (\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
assert(databasePassed >= 73 && /fail 0/.test(database) && !/fail [1-9]/.test(database));
assert(/pass 4/.test(sdk) && /fail 0/.test(sdk));
const selected = [
  'backend/agents/matching.ts',
  'src/auth/recovery.ts',
  'src/security/documents.ts',
];
const evidence = {
  destination: 'Google Gemini',
  purpose: 'Advisory Dev/QA review; no execution or mutation',
  release_ready: true,
  generatedAt: new Date().toISOString(),
  selected_code: selected.map((path) => {
    const source = fs.readFileSync(path, 'utf8');
    assert(
      !/(?:AIza[\w-]{30,}|sb_secret_[\w-]{10,}|-----BEGIN .*PRIVATE KEY)/.test(source),
      'Refusing source containing a credential pattern',
    );
    return {
      path,
      sha256: hash(source),
      excerpt: source.slice(0, 6000),
      excerpt_truncated: source.length > 6000,
    };
  }),
  test_evidence: {
    frontend_passed: frontend.numPassedTests,
    frontend_total: frontend.numTotalTests,
    database_passed: databasePassed,
    database_total: databasePassed,
    sdk_http_passed: 4,
    browser_passed: browser.stats.expected,
    browser_skipped: browser.stats.skipped,
    physical_devices_certified: false,
    executed_relevant_suites: frontend.testResults
      .filter((r) =>
        /agent-workflows|ai-guardrails|document-security|recovery-security|assistant-navigation/.test(
          r.name,
        ),
      )
      .map((r) => ({
        file: r.name.replaceAll('\\', '/').split('/').pop(),
        passed: r.assertionResults.filter((a) => a.status === 'passed').length,
        cases: r.assertionResults
          .filter((a) => a.status === 'passed')
          .map((a) => a.fullName.slice(0, 250)),
      })),
  },
};
const serialized = JSON.stringify(evidence),
  checksum = hash(serialized);
fs.writeFileSync(
  'supabase/functions/fyp-assistants-v1/qa-evidence.ts',
  '// Generated local evidence; export remains disabled until this exact checksum is approved.\nexport const qaEvidence = ' +
    serialized +
    ' as const;\nexport const qaEvidenceSha256 = ' +
    JSON.stringify(checksum) +
    ';\n',
);
fs.writeFileSync(
  'handover/verification/pdf-review-qa-payload-manifest.json',
  JSON.stringify(
    {
      generatedAt: evidence.generatedAt,
      checksum,
      selectedFiles: selected,
      externalExportEnabled: false,
      method:
        'Fixed whitelist; bounded code excerpts and passing test counts only. No private/environment file reads or provider calls.',
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'QA evidence prepared locally. Server approval checksum and client enable flag remain unset.',
);
