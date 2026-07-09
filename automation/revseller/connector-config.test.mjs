import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getRevsellerCredentials, redactSensitiveText } from './connector-config.mjs';

test('reads RevSeller credentials only from environment variables', () => {
  const email = `${randomUUID()}@example.invalid`;
  const password = randomUUID();
  const credentials = getRevsellerCredentials({ REVSELLER_EMAIL: email, REVSELLER_PASSWORD: password });
  assert.equal(credentials.email, email);
  assert.equal(credentials.password, password);
  assert.equal(credentials.hasCredentials, true);
});

test('redacts credentials and email-like values from text before artifact writes', () => {
  const email = `${randomUUID()}@example.invalid`;
  const password = randomUUID();
  const redacted = redactSensitiveText(`${email} used ${password} and other@example.invalid`, { REVSELLER_EMAIL: email, REVSELLER_PASSWORD: password });
  assert.equal(redacted.includes(email), false);
  assert.equal(redacted.includes(password), false);
  assert.equal(redacted, '[REDACTED] used [REDACTED] and [REDACTED_EMAIL]');
});
