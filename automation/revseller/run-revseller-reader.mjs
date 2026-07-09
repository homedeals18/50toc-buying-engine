import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getAmazonBrowserSession } from '../amazon/browser-session/index.mjs';
import { readRevsellerFromOpenAmazonPage, revsellerReaderReportPath } from './revseller-integration.mjs';
import { runStandardizedModule } from '../shared/module-interface.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const executionLogPath = path.join(repositoryRoot, 'artifacts', 'revseller', 'execution-log.json');
const moduleExecutionReportPath = path.join(repositoryRoot, 'artifacts', 'revseller', 'module-execution-report.json');

export async function run(input = {}) {
  const outputPath = input.outputPath ?? revsellerReaderReportPath;
  return runStandardizedModule({
    id: 'revseller-reader',
    name: 'Revseller Reader',
    inputFile: input.inputFile ?? null,
    outputFile: outputPath,
    logFile: input.logFile ?? executionLogPath,
    reportFile: input.reportFile ?? moduleExecutionReportPath
  }, async () => {
    const context = input.context ?? await getAmazonBrowserSession({ chromium, launchOptions: { headless: process.env.AMAZON_BROWSER_HEADLESS === 'true' } });
    const report = await readRevsellerFromOpenAmazonPage(context, { reportPath: outputPath });
    const processedItems = Array.isArray(report?.analyses) ? report.analyses.length : Array.isArray(report?.reports) ? report.reports.length : report ? 1 : 0;
    return { status: 'PASS', outputFile: outputPath, processedItems, data: { reportPath: path.relative(repositoryRoot, outputPath) } };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await run();
  console.log(`RevSeller reader completed: ${revsellerReaderReportPath}`);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'FAIL' ? 1 : 0;
}
