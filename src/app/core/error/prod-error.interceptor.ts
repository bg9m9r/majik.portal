import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../../ui/toast.service';
import { safeProdMessage } from './prod-error';

/**
 * Always-on prod HTTP error surface. On any failed response it shows a
 * generic, safe {@link ToastService} error toast ("Something went wrong —
 * retry") and RETHROWS so downstream consumers (and the dev-error
 * interceptor) still observe the original error unchanged.
 *
 * The toast message never includes the response body — leaking server
 * internals into the UI is exactly what we're guarding against. The
 * verbose, opt-in dev toast (dev-error.interceptor) still carries the
 * full payload for debugging.
 *
 * Sits in the interceptor chain AFTER authInterceptor (so auth-refresh
 * retries get their turn first) and alongside devErrorInterceptor.
 */
export const prodErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);
  return next(req).pipe(
    catchError(err => {
      if (err instanceof HttpErrorResponse) {
        toast.error(safeProdMessage(err));
      }
      return throwError(() => err);
    })
  );
};
