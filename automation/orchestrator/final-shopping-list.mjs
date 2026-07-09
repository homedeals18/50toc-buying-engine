import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultDecisionReportPath = path.join(repositoryRoot, 'artifacts', 'decision-engine', 'decision-report.json');
export const defaultFinalShoppingListPath = path.join(repositoryRoot, 'artifacts', 'orchestrator', 'final-shopping-list.json');

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function produceFinalShoppingList({ decisionReportPath = defaultDecisionReportPath, outputPath = defaultFinalShoppingListPath } = {}) {
  if (!existsSync(decisionReportPath)) throw new Error(`Decision report not found: ${path.relative(repositoryRoot, decisionReportPath)}`);
  const decisionReport = await readJson(decisionReportPath);
  const shoppingList = {
    module: 'final-shopping-list-v1',
    generatedAt: new Date().toISOString(),
    input: path.relative(repositoryRoot, decisionReportPath),
    totals: decisionReport.totals ?? {},
    decisions: decisionReport.decisions ?? []
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(shoppingList, null, 2));
  return shoppingList;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const report = await produceFinalShoppingList();
  console.log(`Final Shopping List v1 complete: ${report.decisions.length} decisions.`);
  console.log(`Wrote ${path.relative(repositoryRoot, defaultFinalShoppingListPath)}`);
}
