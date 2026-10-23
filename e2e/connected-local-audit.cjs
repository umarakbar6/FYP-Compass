const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'handover/verification/strict-audit');
fs.mkdirSync(path.join(output, 'screenshots'), { recursive: true });
const { chromium } = createRequire(path.join(root, 'package.json'))('@playwright/test');
const base = process.env.FYP_LOCAL_WEB_URL || 'http://127.0.0.1:5182';
const api = process.env.FYP_LOCAL_API_URL || 'http://127.0.0.1:54329';
for (const target of [base, api]) { const url = new URL(target); assert.equal(url.protocol, 'http:'); assert(['127.0.0.1','localhost'].includes(url.hostname), 'This synthetic audit is loopback-only'); }
const report = { checkedAt: new Date().toISOString(), mode: 'isolated local PostgreSQL bridge', checks: [], pages: [], runtimeErrors: [] };
const add = (name, passed, detail) => report.checks.push({ name, passed, detail });
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
}
async function login(page, account) {
  page.setDefaultNavigationTimeout(120000);
  await page.goto(base + '/login');
  await page.getByLabel('Demo account', { exact: true }).selectOption(account.id);
  await page.getByRole('button', { name: 'Enter local backend demo', exact: true }).click();
  await page.waitForURL('**/' + account.role + '/dashboard', { timeout: 30000 });
  await settle(page);
}
(async () => {
  const directory = await (await fetch(api + '/local-demo/accounts')).json();
  assert(directory.local_only && directory.accounts.length === 9);
  const browser = await chromium.launch({ headless: true });
  try {
    const core = {
      student: ['dashboard', 'group', 'proposal', 'milestones', 'health', 'notices', 'peers', 'results'],
      supervisor: ['dashboard', 'groups', 'proposals', 'milestones', 'health', 'notices', 'assessment', 'defenses'],
      examiner: ['dashboard', 'defenses', 'assessment'],
      coordinator: ['dashboard', 'configuration', 'matching', 'defenses', 'assessment', 'reports', 'reports?view=full', 'results'],
    };
    const advanced = {
      student: ['governance', 'help', 'privacy-requests'],
      supervisor: ['governance', 'assistants', 'help'],
      examiner: ['help'],
      coordinator: ['health', 'governance', 'assistants', 'help', 'privacy-requests', 'users', 'service-status', 'enquiries', 'case-studies'],
    };
    for (const role of Object.keys(core)) {
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      const page = await context.newPage();
      const responses = [];
      page.on('pageerror', error => report.runtimeErrors.push({ role, message: error.message, path: new URL(page.url()).pathname }));
      page.on('response', response => {
        if (response.url().startsWith(api) && response.status() >= 400)
          responses.push({ status: response.status(), endpoint: new URL(response.url()).pathname });
      });
      try {
        const account = directory.accounts.find(a => a.role === role);
        await login(page, account);
        add(role + ' local SDK session and dashboard', true);
        await page.reload(); await settle(page);
        add(role + ' session survives refresh', new URL(page.url()).pathname === '/' + role + '/dashboard');
        const forbidden = role === 'student' || role === 'supervisor' ? '/coordinator/configuration' : '/student/group';
        await page.goto(base + forbidden);
        await page.waitForURL('**/' + role + '/dashboard', { timeout: 30000 });
        await settle(page);
        add(role + ' cross-role URL blocked', new URL(page.url()).pathname === '/' + role + '/dashboard');
        for (const [kind, paths] of [['core', core[role]], ['advanced', advanced[role]]]) {
          for (const route of paths) {
            responses.length = 0;
            await page.goto(base + '/' + role + '/' + route); await settle(page);
            const errors = await page.locator('.error-message').allTextContents();
            const headings = await page.locator('h1').allTextContents();
            const crashed = await page.getByRole('heading', { name: 'We could not open this screen.' }).count();
            const item = { role, kind, route, headings, errors, failedResponses: [...responses], crashed: !!crashed };
            item.passed = !errors.length && !crashed && !responses.length;
            report.pages.push(item);
            if (role === 'student' && route === 'results') {
              const before = await page.locator('main').innerText();
              await page.reload(); await settle(page);
              const after = await page.locator('main').innerText();
              add('saved student result survives refresh', before === after && before.includes('91'), { expectedTotal: 91 });
              await page.screenshot({ path: path.join(output, 'screenshots/student-results-desktop.png'), fullPage: true });
            }
          }
        }
        for (const width of [320, 375, 768, 1366]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(base + '/' + role + '/dashboard'); await settle(page);
          const size = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
          add(role + ' dashboard at ' + width + 'px has no document overflow', size.document <= size.viewport + 1, size);
          if (width === 375 || width === 1366)
            await page.screenshot({ path: path.join(output, 'screenshots/' + role + '-dashboard-' + width + '.png'), fullPage: true });
        }
        await page.setViewportSize({ width: 375, height: 900 });
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
        await page.getByRole('link', { name: 'Overview', exact: true }).click();
        add(role + ' mobile menu navigation', new URL(page.url()).pathname === '/' + role + '/dashboard');
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
        await page.getByRole('button', { name: 'Sign out', exact: true }).click();
        await page.getByRole('button', { name: 'Confirm', exact: true }).click();
        await page.waitForURL('**/login');
        add(role + ' logout', true);
      } catch (error) {
        add(role + ' browser audit completed', false, error.message);
        await page.screenshot({ path: path.join(output, 'screenshots/' + role + '-failure.png'), fullPage: true }).catch(() => {});
      } finally { await context.close(); }
      fs.writeFileSync(path.join(output, 'local-browser-audit.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ roleComplete: role, pages: report.pages.filter(x => x.role === role).length }), '\n');
    }
    const context = await browser.newContext(); const page = await context.newPage();
    try {
      await login(page, directory.accounts.find(a => a.full_name === 'Student Three'));
      await page.goto(base + '/student/notices'); await settle(page);
      const buttons = page.getByRole('button', { name: 'Mark as read', exact: true });
      const unread = await buttons.count();
      if (unread) { await buttons.first().click(); await settle(page); }
      else assert(await page.getByText('Read', { exact: true }).count() > 0, 'Seed a health notice before testing persistence.');
      await page.reload(); await settle(page);
      add('student notice read state survives refresh', await page.getByText('Read', { exact: true }).count() > 0);
      await page.screenshot({ path: path.join(output, 'screenshots/student-notice-read-after-refresh.png'), fullPage: true });
    } catch (error) { add('student notice persistence', false, error.message); }
    await context.close();
    add('no uncaught JavaScript runtime errors', report.runtimeErrors.length === 0, report.runtimeErrors);
  } finally { await browser.close(); }
  report.corePages = { total: report.pages.filter(x => x.kind === 'core').length, passed: report.pages.filter(x => x.kind === 'core' && x.passed).length };
  report.advancedPages = { total: report.pages.filter(x => x.kind === 'advanced').length, passed: report.pages.filter(x => x.kind === 'advanced' && x.passed).length };
  report.functionalChecks = { total: report.checks.length, passed: report.checks.filter(x => x.passed).length };
  report.allChecksPassed = report.checks.every(x => x.passed) && report.pages.every(x => x.passed);
  fs.writeFileSync(path.join(output, 'local-browser-audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ corePages: report.corePages, advancedPages: report.advancedPages, functionalChecks: report.functionalChecks, runtimeErrors: report.runtimeErrors.length, allChecksPassed: report.allChecksPassed }));
  if (!report.allChecksPassed) process.exitCode = 1;
})().catch(error => { fs.writeFileSync(path.join(output, 'local-browser-audit-error.json'), JSON.stringify({ message: error.message, stack: error.stack }, null, 2)); console.error(error.message); process.exitCode = 1; });
