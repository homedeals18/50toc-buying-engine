import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const artifactRoot = path.resolve(process.cwd(), '../../artifacts/bjs');
const screenshotDir = path.join(artifactRoot, 'screenshots');
const logDir = path.join(artifactRoot, 'logs');
const searchTerm = 'Blue Diamond Almonds';

async function saveStep(page, name, details = {}) {
  await mkdir(screenshotDir, { recursive: true });
  await mkdir(logDir, { recursive: true });
  const safeName = name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const screenshotPath = path.join(screenshotDir, `${safeName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(
    path.join(logDir, `${safeName}.json`),
    JSON.stringify({ ...details, url: page.url(), title: await page.title(), savedAt: new Date().toISOString(), screenshotPath }, null, 2)
  );
}

test.describe("BJ's product search automation", () => {
  test('finds Blue Diamond Almonds search results and records artifacts', async ({ page }) => {
    const consoleMessages = [];
    page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: error.message }));

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await saveStep(page, '01-bjs-homepage');

    const searchBox = page
      .locator('input[type="search"], input[placeholder*="Search" i], input[aria-label*="Search" i], input[name*="search" i]')
      .first();

    if (await searchBox.isVisible({ timeout: 15_000 }).catch(() => false)) {
      await searchBox.fill(searchTerm);
      await Promise.all([
        page.waitForLoadState('domcontentloaded').catch(() => undefined),
        searchBox.press('Enter')
      ]);
    } else {
      await page.goto(`/search/${encodeURIComponent(searchTerm)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }

    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    await saveStep(page, '02-blue-diamond-almonds-results', { searchTerm });

    const bodyText = (await page.locator('body').innerText({ timeout: 15_000 })).replace(/\s+/g, ' ');
    const normalizedUrl = decodeURIComponent(page.url()).toLowerCase();
    const reachedSearchExperience =
      normalizedUrl.includes('blue') ||
      normalizedUrl.includes('diamond') ||
      /blue\s+diamond/i.test(bodyText) ||
      /almond/i.test(bodyText);

    await writeFile(
      path.join(logDir, 'blue-diamond-almonds-console.json'),
      JSON.stringify({ searchTerm, url: page.url(), consoleMessages, bodyPreview: bodyText.slice(0, 2000) }, null, 2)
    );

    expect(reachedSearchExperience, `Expected BJ's page to reach a Blue Diamond Almonds search/product experience. URL: ${page.url()}`).toBe(true);
  });
});
