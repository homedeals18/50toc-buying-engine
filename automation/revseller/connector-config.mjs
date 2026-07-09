import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const revsellerConnectorConfig = {
  supplier: 'RevSeller',
  baseUrl: 'https://revseller.com',
  loginUrl: 'https://revseller.com/login',
  accountUrl: 'https://revseller.com/account',
  emailEnv: 'REVSELLER_EMAIL',
  passwordEnv: 'REVSELLER_PASSWORD',
  manualLoginTimeoutMs: Number(process.env.REVSELLER_MANUAL_LOGIN_TIMEOUT_MS ?? 10 * 60 * 1000),
  maxProducts: Number(process.env.REVSELLER_MAX_PRODUCTS ?? 25),
  amazonProductUrls: (process.env.REVSELLER_AMAZON_PRODUCT_URLS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  connectorProductsPath: process.env.REVSELLER_CONNECTOR_PRODUCTS_PATH || '',
  noSensitiveArtifacts: true
};

export function parseDotEnv(content = '') {
  const values = {};
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

export function readLocalDotEnv(envPath = path.resolve(process.cwd(), '../../.env')) {
  if (!existsSync(envPath)) return {};
  return parseDotEnv(readFileSync(envPath, 'utf8'));
}

export function getRevsellerCredentials(env = readLocalDotEnv()) {
  const email = String(env.REVSELLER_EMAIL ?? '').trim();
  const password = String(env.REVSELLER_PASSWORD ?? '');
  return {
    email,
    password,
    hasEmail: email.length > 0,
    hasPassword: password.length > 0,
    hasCredentials: email.length > 0 && password.length > 0,
    source: '.env'
  };
}

export function redactSensitiveText(value, env = { ...process.env, ...readLocalDotEnv() }) {
  let output = String(value ?? '');
  for (const secret of [env.REVSELLER_EMAIL, env.REVSELLER_PASSWORD].filter(Boolean)) {
    output = output.split(String(secret)).join('[REDACTED]');
  }
  output = output.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  return output;
}
