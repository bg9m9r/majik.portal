import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { DevErrorToastService } from './dev-error-toast.service';

/**
 * Captures every failed HTTP response, hands the full {@link HttpErrorResponse}
 * to {@link DevErrorToastService}, then RETHROWS so downstream consumers and
 * other interceptors still see the error unchanged.
 *
 * Intentionally added at the end of the interceptor chain so it observes
 * errors after auth-refresh retries have had their turn.
 */
export const devErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(DevErrorToastService);
  return next(req).pipe(
    catchError(err => {
      if (err instanceof HttpErrorResponse) {
        // Stash the method on the error for the service to surface; the
        // HttpErrorResponse doesn't preserve it natively.
        (err as unknown as { method?: string }).method = req.method;
        toast.pushHttpError(err, req.body ?? undefined);
      }
      return throwError(() => err);
    })
  );
};
