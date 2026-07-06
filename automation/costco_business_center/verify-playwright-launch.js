import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: process.env.COSTCO_BUSINESS_CENTER_HEADLESS !== 'false', args: ['--disable-dev-shm-usage', '--no-sandbox'] });
const page = await browser.newPage();
await page.setContent('<main><h1>Playwright launch verification passed</h1></main>');
const heading = await page.locator('h1').textContent();
if (heading !== 'Playwright launch verification passed') {
  throw new Error('Chromium launched but page verification failed.');
}
await browser.close();
console.log('[verify] Chromium launched and rendered a page successfully.');
