import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../../ui/toast.service';
import { safeProdMessage } from './prod-error';

/**
 * Endpoints whose failures MatchPage surfaces itself at the call site with
 * a more-useful, engine-specific message (it includes the engine rejection
 * reason via `commandRejectionMessage` / `fetchFailureMessage`). The generic
 * interceptor toast must stay silent for these — otherwise the user sees a
 * flash of "Something went wrong" that's then overwritten by the specific
 * toast, plus redundant timer contention between the two.
 *
 * Matched (path only, ignoring query string), where `{id}` is the match id:
 *   * GET  /matches/{id}            (MatchPage.refresh / load)
 *   * GET  /matches/{id}/state      (MatchPage.fetchState)
 *   * POST /matches/{id}/commands   (MatchPage.send)
 *   * POST /matches/{id}/concede    (MatchPage.onConcede)
 *
 * Deliberately NOT matched (no call-site toast, so the generic toast is the
 * only surface and must remain):
 *   * GET  /matches            (lobby list)
 *   * POST /matches            (create)
 *   * /matches/{id}/play-draw, /roll, /join  (silent at the call site)
 *   * everything else (card search, decks, /me, …)
 */
const CALL_SITE_HANDLED_MATCH_PATH =
  /\/matches\/[^/?#]+(?:\/(?:state|commands|concede))?(?:[?#].*)?$/;

/**
 * True when the request targets a `/matches/*` endpoint that MatchPage
 * surfaces itself — so the interceptor should defer to the call-site toast.
 * Parsed from the request path (query string stripped); robust to absolute
 * URLs (the OpenAPI client uses `apiBaseUrl`).
 */
export function isCallSiteHandledMatchRequest(url: string): boolean {
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, '');
  return CALL_SITE_HANDLED_MATCH_PATH.test(path);
}

/**
 * Always-on prod HTTP error surface. On any failed response it shows a
 * generic, safe {@link ToastService} error toast ("Something went wrong —
 * retry") and RETHROWS so downstream consumers (and the dev-error
 * interceptor) still observe the original error unchanged.
 *
 * Exception: requests MatchPage surfaces itself (see
 * {@link isCallSiteHandledMatchRequest}) are NOT toasted here — the
 * call-site message (which carries the engine rejection reason) wins. The
 * error is still rethrown so the call site can render it.
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
      if (err instanceof HttpErrorResponse && !isCallSiteHandledMatchRequest(req.url)) {
        toast.error(safeProdMessage(err));
      }
      return throwError(() => err);
    })
  );
};
