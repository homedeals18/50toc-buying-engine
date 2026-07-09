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
  noSensitiveArtifacts: true
};

export function getRevsellerCredentials(env = process.env) {
  const email = String(env.REVSELLER_EMAIL ?? '').trim();
  const password = String(env.REVSELLER_PASSWORD ?? '');
  return {
    email,
    password,
    hasEmail: email.length > 0,
    hasPassword: password.length > 0,
    hasCredentials: email.length > 0 && password.length > 0
  };
}

export function redactSensitiveText(value, env = process.env) {
  let output = String(value ?? '');
  for (const secret of [env.REVSELLER_EMAIL, env.REVSELLER_PASSWORD].filter(Boolean)) {
    output = output.split(String(secret)).join('[REDACTED]');
  }
  output = output.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  return output;
}
