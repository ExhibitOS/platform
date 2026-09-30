import { expect, test } from '@playwright/test';

test('loads the entry page and reaches the real API through the web proxy', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/ExhibitOS/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '연결 확인' }).click();
  await expect(page.getByRole('status')).toHaveText('API가 연결되었습니다.');
});

test('shows a recoverable connection failure and allows retry', async ({ page }) => {
  await page.route('**/api/v1/health', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: '연결 확인' }).click();
  await expect(page.getByRole('status')).toContainText('API에 연결할 수 없습니다.');
  await page.unroute('**/api/v1/health');
  await page.getByRole('button', { name: '연결 확인' }).click();
  await expect(page.getByRole('status')).toHaveText('API가 연결되었습니다.');
});

test('supports a narrow viewport and keyboard connection action', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '연결 확인' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('API가 연결되었습니다.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
