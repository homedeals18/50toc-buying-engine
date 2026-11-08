import {randomUUID} from 'node:crypto';

export class AppError extends Error {
  constructor(code, message, {status=400, retryable=false, stage='validation', httpStatus=null}={}) {
    super(message);
    Object.assign(this, {code, status, retryable, stage, httpStatus});
  }
}

export function safeError(error) {
  const e = error instanceof AppError ? error : new AppError('LOCAL_ERROR', 'The operation could not be completed. Saved research is retained.', {status:500, stage:'local'});
  return {error:e.message, code:e.code, eventId:e.eventId ?? null};
}

export function eventFor(error, operation, elapsedMs=0) {
  return {id:randomUUID(), utc:new Date().toISOString(), operation, code:error instanceof AppError?error.code:'LOCAL_ERROR',
    stage:error instanceof AppError?error.stage:'local', httpStatus:error.httpStatus ?? null, elapsedMs};
}

export function nonnegativeNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/^\$/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s.replaceAll(',', ''));
  return Number.isFinite(n) ? n : null;
}

export function redact(value, secrets=[]) {
  return JSON.parse(JSON.stringify(value, (name, v) => {
    if (/^(?:authorization|api[_-]?key|.*token|password|secret|cookie|set-cookie|headers|credentials)$/i.test(name)) return '[REDACTED]';
    if (typeof v !== 'string') return v;
    let s = v;
    for (const secret of secrets.filter(Boolean)) s = s.split(secret).join('[REDACTED]');
    s = s.replace(/Bearer\s+[^\s"<>]+/gi, 'Bearer [REDACTED]');
    if (/^https?:\/\//i.test(s)) {
      try {
        const u = new URL(s); u.username=''; u.password='';
        for (const k of [...u.searchParams.keys()]) if (/token|key|auth|secret|signature|credential/i.test(k)) u.searchParams.set(k,'[REDACTED]');
        s=u.href;
      } catch { return '[Invalid URL]'; }
    }
    return s;
  }));
}
