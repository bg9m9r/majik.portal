import { ErrorHandler, Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DevErrorToastService } from './dev-error-toast.service';

/**
 * Custom Angular {@link ErrorHandler} that:
 *  1. Forwards unexpected client-side exceptions to {@link DevErrorToastService}
 *     so they surface as on-screen toasts during prod-testing.
 *  2. Still defers to the default behavior (`console.error`) so devtools
 *     output is unchanged.
 *
 * Skips {@link HttpErrorResponse} because the HTTP interceptor already
 * captured those — Angular re-routes uncaught observable HTTP errors here
 * which would otherwise double-toast.
 */
@Injectable({ providedIn: 'root' })
export class DevToastErrorHandler implements ErrorHandler {
  private readonly toast = inject(DevErrorToastService);

  handleError(error: unknown): void {
    const unwrapped = unwrapRxjs(error);
    if (!(unwrapped instanceof HttpErrorResponse)) {
      try {
        this.toast.pushJsError(unwrapped);
      } catch {
        // Never let the error handler itself throw — that would loop.
      }
    }
    // Match the default ErrorHandler behavior so devtools still sees it.
    console.error(error);
  }
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
