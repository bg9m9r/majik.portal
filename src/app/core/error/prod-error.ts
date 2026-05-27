import { ErrorHandler, Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ToastService } from '../../ui/toast.service';
import { DevToastErrorHandler } from '../dev-error/dev-toast-error-handler';

/**
 * Generic, safe, user-facing error message. Deliberately content-free so
 * we never leak server internals / stack frames / secrets into the UI.
 * Short enough to render on a single toast line.
 */
export const PROD_ERROR_MESSAGE = 'Something went wrong — retry';

/**
 * The maximum length a surfaced prod message may have. The generic
 * message is well within this; the cap is a belt-and-braces guard in
 * case a future caller passes a longer canned string.
 */
const MAX_PROD_MESSAGE_LEN = 80;

/**
 * Map any error to the user-facing prod message. Intentionally ignores
 * the error payload entirely — the dev toast (gated, opt-in) carries the
 * full detail; this path is always-on and must stay non-leaking. Returns
 * a single, truncated, generic line.
 */
export function safeProdMessage(_err: unknown): string {
  const msg = PROD_ERROR_MESSAGE;
  return msg.length <= MAX_PROD_MESSAGE_LEN ? msg : msg.slice(0, MAX_PROD_MESSAGE_LEN - 1) + '…';
}

/** Rxjs sometimes wraps the original error inside `{ rejection: ... }` etc. */
function unwrapRxjs(err: unknown): unknown {
  if (err && typeof err === 'object') {
    const e = err as { rejection?: unknown; originalError?: unknown };
    if (e.rejection !== undefined) return e.rejection;
    if (e.originalError !== undefined) return e.originalError;
  }
  return err;
}

/**
 * Always-on prod error surface. Registered as the app's {@link ErrorHandler}
 * (replacing the dev-only one in app.config). It:
 *
 *  1. Surfaces a generic, safe toast for uncaught client-side (JS) errors
 *     via {@link ToastService} so a prod user always sees *something* and
 *     a recovery affordance, not a silent dead screen.
 *  2. Delegates to {@link DevToastErrorHandler} so the dev-only verbose
 *     toast + the default `console.error` behaviour are unchanged.
 *
 * Skips {@link HttpErrorResponse}: the HTTP error interceptor already
 * surfaces those (and Angular re-routes uncaught observable HTTP errors
 * here, which would otherwise double-toast).
 */
@Injectable({ providedIn: 'root' })
export class ProdErrorHandler implements ErrorHandler {
  private readonly toast = inject(ToastService);
  private readonly dev = inject(DevToastErrorHandler);

  handleError(error: unknown): void {
    const unwrapped = unwrapRxjs(error);
    if (!(unwrapped instanceof HttpErrorResponse)) {
      try {
        this.toast.error(safeProdMessage(unwrapped));
      } catch {
        // Never let the error handler itself throw — that would loop.
      }
    }
    // Preserve dev detail + console.error.
    this.dev.handleError(error);
  }
}
