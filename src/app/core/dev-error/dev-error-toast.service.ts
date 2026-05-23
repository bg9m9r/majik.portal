import { Injectable, signal, computed } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

/**
 * Verbose dev-mode error toasts.
 *
 * Goal: while testing in production, surface every HTTP failure or uncaught
 * JS error as a non-auto-dismissing card with the full payload, so the user
 * doesn't have to crack the dev console open. This is intentionally
 * info-dense — readability is secondary to debuggability.
 *
 * Enable/disable at runtime via:
 *   - URL param  `?devToast=on` / `?devToast=off` (sets localStorage + reloads
 *     via the URL-param consumer; here we only read state).
 *   - localStorage `majik.devErrorToast` = `'on'` | `'off'`. Default `'on'`.
 *
 * The service is always wired in; if disabled, push* methods are no-ops.
 */

export type DevErrorKind = 'http' | 'js';

export interface DevErrorRecord {
  id: number;
  kind: DevErrorKind;
  timestamp: string;        // ISO
  title: string;            // short headline e.g. "HTTP 500 GET /api/foo"
  /** Full payload dump as formatted JSON-ish string. */
  detail: string;
}

const STORAGE_KEY = 'majik.devErrorToast';

/** Returns the current on/off state from localStorage. Defaults to ON. */
export function readDevToastEnabled(): boolean {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (v === null) return true;
    return v === 'on';
  } catch {
    return true;
  }
}

/**
 * Process `?devToast=on|off` from the current URL if present. Persists into
 * localStorage. Returns true if a value was applied (caller may want to strip
 * the param + reload).
 */
export function applyDevToastUrlParam(): boolean {
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('devToast');
    if (raw !== 'on' && raw !== 'off') return false;
    localStorage.setItem(STORAGE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

@Injectable({ providedIn: 'root' })
export class DevErrorToastService {
  private readonly _errors = signal<DevErrorRecord[]>([]);
  private readonly _enabled = signal<boolean>(readDevToastEnabled());
  private nextId = 1;

  readonly errors = this._errors.asReadonly();
  readonly enabled = this._enabled.asReadonly();
  readonly count = computed(() => this._errors().length);

  /** Allow runtime toggling without a reload (e.g. from a UI button). */
  setEnabled(on: boolean): void {
    this._enabled.set(on);
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      // ignore — storage may be unavailable (SSR / privacy mode)
    }
  }

  pushHttpError(err: HttpErrorResponse, requestBody?: unknown): void {
    if (!this._enabled()) return;

    const method = inferMethod(err);
    const status = err.status;
    const statusText = err.statusText || '';
    const url = err.url || '(unknown url)';

    const payload: Record<string, unknown> = {
      kind: 'http',
      timestamp: new Date().toISOString(),
      method,
      url,
      status,
      statusText,
      message: err.message,
      name: err.name,
      ok: err.ok,
      headers: collectHeaders(err),
      responseBody: parseBody(err.error),
    };
    if (requestBody !== undefined) {
      payload['requestBody'] = safeClone(requestBody);
    }

    const traceId =
      pickStringField(err.error, ['traceId', 'trace_id', 'requestId', 'request_id', 'correlationId']) ?? null;
    if (traceId) payload['traceId'] = traceId;

    const errorCode = pickStringField(err.error, ['code', 'errorCode', 'type']);
    if (errorCode) payload['errorCode'] = errorCode;

    const title = `HTTP ${status || '?'} ${method} ${shortUrl(url)}`;

    this.push({
      id: this.nextId++,
      kind: 'http',
      timestamp: payload['timestamp'] as string,
      title,
      detail: formatJson(payload),
    });
  }

  pushJsError(err: unknown): void {
    if (!this._enabled()) return;

    const e = err as Error & { stack?: string };
    const payload: Record<string, unknown> = {
      kind: 'js',
      timestamp: new Date().toISOString(),
      name: e?.name ?? typeof err,
      message: e?.message ?? String(err),
      stack: e?.stack ?? null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      url: typeof location !== 'undefined' ? location.href : null,
    };

    // Tack on any extra enumerable props (rxjs/CDK errors often carry extras).
    if (err && typeof err === 'object') {
      const extras: Record<string, unknown> = {};
      for (const k of Object.keys(err as object)) {
        if (k === 'name' || k === 'message' || k === 'stack') continue;
        extras[k] = safeClone((err as Record<string, unknown>)[k]);
      }
      if (Object.keys(extras).length > 0) payload['extras'] = extras;
    }

    const title = `JS ${payload['name']}: ${truncate(String(payload['message']), 80)}`;

    this.push({
      id: this.nextId++,
      kind: 'js',
      timestamp: payload['timestamp'] as string,
      title,
      detail: formatJson(payload),
    });
  }

  dismiss(id: number): void {
    this._errors.update(list => list.filter(e => e.id !== id));
  }

  clearAll(): void {
    this._errors.set([]);
  }

  private push(record: DevErrorRecord): void {
    // Cap to prevent runaway memory if something explodes in a loop.
    this._errors.update(list => {
      const next = [...list, record];
      return next.length > 50 ? next.slice(next.length - 50) : next;
    });
  }
}

function inferMethod(err: HttpErrorResponse): string {
  // HttpErrorResponse doesn't carry the request method directly. Try to read
  // it off the underlying error-like shape Angular sometimes attaches.
  const anyErr = err as unknown as { method?: string };
  return anyErr.method || '';
}

function collectHeaders(err: HttpErrorResponse): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const k of err.headers.keys()) {
      const v = err.headers.get(k);
      if (v != null) out[k] = v;
    }
  } catch {
    // ignore
  }
  return out;
}

function parseBody(body: unknown): unknown {
  if (body == null) return null;
  if (typeof body === 'string') {
    // ASP.NET often returns JSON-as-string under HttpErrorResponse.error when
    // responseType is text. Try to parse.
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return safeClone(body);
}

function pickStringField(body: unknown, names: string[]): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  for (const n of names) {
    const v = b[n];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function safeClone(v: unknown): unknown {
  // structuredClone fails on functions/DOM nodes; fall back to JSON round-trip
  // with a circular guard. We deliberately keep this lenient — we want to dump
  // SOMETHING, not nothing.
  try {
    return structuredClone(v);
  } catch {
    try {
      const seen = new WeakSet();
      return JSON.parse(
        JSON.stringify(v, (_k, val) => {
          if (typeof val === 'function') return `[function ${val.name || 'anonymous'}]`;
          if (val instanceof Error) {
            return { name: val.name, message: val.message, stack: val.stack };
          }
          if (val && typeof val === 'object') {
            if (seen.has(val as object)) return '[circular]';
            seen.add(val as object);
          }
          return val;
        })
      );
    } catch {
      return String(v);
    }
  }
}

function formatJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url, typeof location !== 'undefined' ? location.href : 'http://localhost');
    return u.pathname + (u.search || '');
  } catch {
    return url;
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
