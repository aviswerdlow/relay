import { test, expect } from '@playwright/test';

test('placeholder', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Relay/i);
});
