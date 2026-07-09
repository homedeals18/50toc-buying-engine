import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRevsellerCredentials, parseDotEnv, readLocalDotEnv, redactSensitiveText } from './connector-config.mjs';

test('parses RevSeller credentials from .env syntax', () => {
  const email = `${randomUUID()}@example.invalid`;
  const password = randomUUID();
  const parsed = parseDotEnv(`# local only\nREVSELLER_EMAIL="${email}"\nREVSELLER_PASSWORD='${password}'`);
  assert.equal(parsed.REVSELLER_EMAIL, email);
  assert.equal(parsed.REVSELLER_PASSWORD, password);
});

test('reads RevSeller credentials only from .env values', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'revseller-env-'));
  try {
    const envPath = path.join(tempRoot, '.env');
    const email = `${randomUUID()}@example.invalid`;
    const password = randomUUID();
    await writeFile(envPath, `REVSELLER_EMAIL=${email}\nREVSELLER_PASSWORD=${password}\n`);
    const credentials = getRevsellerCredentials(readLocalDotEnv(envPath));
    assert.equal(credentials.email, email);
    assert.equal(credentials.password, password);
    assert.equal(credentials.hasCredentials, true);
    assert.equal(credentials.source, '.env');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('redacts credentials and email-like values from text before artifact writes', () => {
  const email = `${randomUUID()}@example.invalid`;
  const password = randomUUID();
  const redacted = redactSensitiveText(`${email} used ${password} and other@example.invalid`, { REVSELLER_EMAIL: email, REVSELLER_PASSWORD: password });
  assert.equal(redacted.includes(email), false);
  assert.equal(redacted.includes(password), false);
  assert.equal(redacted, '[REDACTED] used [REDACTED] and [REDACTED_EMAIL]');
});
