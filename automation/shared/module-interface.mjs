import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const STANDARD_STATUSES = Object.freeze(['PASS', 'FAIL', 'WARNING']);

export function toProjectRelativePath(absolutePath) {
  if (!absolutePath) return null;
  const relativePath = path.relative(repositoryRoot, absolutePath);
  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return absolutePath;
  return relativePath.split(path.sep).join(path.posix.sep);
}

export function normalizeWarnings(warnings = []) {
  return warnings.filter(Boolean).map((warning) => typeof warning === 'string' ? warning : (warning.message ?? String(warning)));
}

export function normalizeErrors(errors = []) {
  return errors.filter(Boolean).map((error) => typeof error === 'string' ? error : (error.message ?? String(error)));
}

export function standardizedStatus({ status, warnings = [], errors = [] } = {}) {
  if (status && STANDARD_STATUSES.includes(status)) return status;
  if (normalizeErrors(errors).length) return 'FAIL';
  if (normalizeWarnings(warnings).length) return 'WARNING';
  return 'PASS';
}

export function createModuleResult({ status, startedAt, completedAt, inputFile = null, outputFile = null, processedItems = 0, warnings = [], errors = [], ...extra }) {
  const startedTime = startedAt ? new Date(startedAt).getTime() : Date.now();
  const completedTime = completedAt ? new Date(completedAt).getTime() : Date.now();
  const normalized = {
    status: standardizedStatus({ status, warnings, errors }),
    startedAt: startedAt ?? new Date(startedTime).toISOString(),
    completedAt: completedAt ?? new Date(completedTime).toISOString(),
    durationMs: Math.max(0, completedTime - startedTime),
    inputFile: inputFile ? toProjectRelativePath(inputFile) : null,
    outputFile: outputFile ? toProjectRelativePath(outputFile) : null,
    processedItems: Number.isFinite(Number(processedItems)) ? Number(processedItems) : 0,
    warnings: normalizeWarnings(warnings),
    errors: normalizeErrors(errors)
  };
  return { ...normalized, ...extra };
}

export async function writeModuleArtifacts(result, { logFile, reportFile, logEntries = [] } = {}) {
  const writes = [];
  if (logFile) {
    writes.push((async () => {
      await mkdir(path.dirname(logFile), { recursive: true });
      await writeFile(logFile, JSON.stringify({ moduleResult: result, entries: logEntries }, null, 2));
    })());
  }
  if (reportFile) {
    writes.push((async () => {
      await mkdir(path.dirname(reportFile), { recursive: true });
      await writeFile(reportFile, JSON.stringify(result, null, 2));
    })());
  }
  await Promise.all(writes);
}

export async function runStandardizedModule(input = {}, work) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const warnings = [];
  const errors = [];
  const logEntries = [{ level: 'info', at: startedAt, message: `${input.name ?? input.id ?? 'module'} started` }];
  let workResult = {};
  try {
    workResult = await work({ ...input, warnings, logEntries });
    if (workResult?.warnings) warnings.push(...workResult.warnings);
  } catch (error) {
    errors.push(error);
    logEntries.push({ level: 'error', at: new Date().toISOString(), message: error.message, stack: error.stack });
  }
  const completedAt = new Date().toISOString();
  const result = createModuleResult({
    ...workResult,
    status: errors.length ? 'FAIL' : workResult?.status,
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.now() - started),
    inputFile: workResult?.inputFile ?? input.inputFile ?? input.inputPath,
    outputFile: workResult?.outputFile ?? input.outputFile ?? input.outputPath,
    warnings,
    errors
  });
  await writeModuleArtifacts(result, { logFile: input.logFile, reportFile: input.reportFile, logEntries });
  return result;
}
