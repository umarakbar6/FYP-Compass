import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const runtime = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  runtime.set(page, []);
  page.on('pageerror', (error) => runtime.get(page)?.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(runtime.get(page) || []).toEqual([]);
});
async function accessible(page: Page) {
  await expect(page.getByRole('heading', { name: 'We could not open this screen.' })).toHaveCount(
    0,
  );
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  ).toEqual([]);
}
for (const path of ['/', '/login', '/forgot-password', '/privacy', '/terms'])
  test('public ' + path + ' renders and passes axe', async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('h1,h2').first()).toBeVisible();
    await accessible(page);
  });
for (const [name, role] of [
  ['Student', 'student'],
  ['Supervisor', 'supervisor'],
  ['Examiner', 'examiner'],
  ['Coordinator', 'coordinator'],
])
  test(role + ' login, navigation, role guard and logout', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/' + role + '/dashboard$'));
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await accessible(page);
    if (role === 'student') {
      await page.goto('/coordinator/health');
      await expect(page).toHaveURL(/\/student\/dashboard$/);
    }
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
test('enquiry download contains the entered specific data', async ({ page }) => {
  await page.goto('/#pricing');
  await page.getByLabel('Your name', { exact: true }).fill('Download Audit');
  await page.getByLabel('Email address', { exact: true }).fill('download-audit@example.test');
  await page
    .getByLabel('Project requirements', { exact: true })
    .fill('Synthetic browser download verification, no submission or contact.');
  await page.getByRole('checkbox').check();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download a copy', exact: true }).click();
  const download = await event;
  expect(download.suggestedFilename()).toBe('fyp-compass-enquiry-copy.txt');
  const stream = await download.createReadStream();
  let content = '';
  for await (const chunk of stream!) content += chunk.toString();
  expect(content).toContain('Download Audit');
  expect(content).toContain('download-audit@example.test');
  expect(content).toContain('Synthetic browser download verification');
});
test('responsive navigation and public screens avoid page overflow', async ({ page }) => {
  for (const width of [320, 375, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
  }
  await page.goto('/login');
  await page.getByRole('button', { name: 'Student', exact: true }).click();
  await page.setViewportSize({ width: 375, height: 900 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('link', { name: 'My notices', exact: true }).click();
  await expect(page).toHaveURL(/\/student\/notices$/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test('proposal review opens the correct AI assistant with its project and selected kind', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Supervisor', exact: true }).click();
  await page.goto('/supervisor/proposals/proposal-nexus');
  await page.getByRole('link', { name: 'Open proposal review assistant' }).click();
  await expect(page).toHaveURL(/\/supervisor\/assistants\?kind=proposal&project=/);
  await expect(page.getByRole('heading', { name: 'AI assistants' })).toBeVisible();
  await expect(page.getByLabel('Assistant')).toHaveValue('proposal');
  await accessible(page);
});
