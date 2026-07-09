import { chromium } from 'playwright';
import { getAmazonBrowserSession } from '../amazon/browser-session/index.mjs';
import { readRevsellerFromOpenAmazonPage, revsellerReaderReportPath } from './revseller-integration.mjs';

const context = await getAmazonBrowserSession({ chromium, launchOptions: { headless: process.env.AMAZON_BROWSER_HEADLESS === 'true' } });

try {
  const report = await readRevsellerFromOpenAmazonPage(context, { reportPath: revsellerReaderReportPath });
  console.log(`RevSeller reader completed: ${revsellerReaderReportPath}`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`RevSeller reader failed: ${error.message}`);
  process.exitCode = 1;
}
