import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService as Auth0Service } from '@auth0/auth0-angular';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';

/**
 * Auth0 redirect target. The SDK auto-detects `?code=&state=` on app
 * bootstrap (APP_INITIALIZER), exchanges the code for a session, and
 * fires `isAuthenticated$ = true`. This page just waits for that tick
 * then navigates to `appState.target` (set by LoginPage to `/lobby`)
 * or `/lobby` as a fallback.
 *
 * Auth0 emits errors via `error$` if the exchange or Discord round-trip
 * failed (user cancelled, callback URL mismatch, etc.).
 */
@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [RouterLink],
  template: `
    <main class="grid min-h-screen place-items-center px-6 py-12"
          style="background: var(--majik-bg); color: var(--majik-fg);">
      <div class="flex flex-col items-center gap-4 text-center">
        @if (error()) {
          <p class="text-sm" style="color: var(--majik-danger, #e07a7a);">
            {{ error() }}
          </p>
          <a routerLink="/login"
             class="text-sm underline underline-offset-2"
             style="color: var(--majik-accent);">
            Back to sign in
          </a>
        } @else {
          <p class="text-sm" style="color: var(--majik-fg-muted);">
            Signing you in…
          </p>
        }
      </div>
    </main>
  `
})
export class AuthCallbackPage implements OnInit {
  private readonly router = inject(Router);
  private readonly auth0 = inject(Auth0Service, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    if (!this.auth0) {
      this.error.set('Auth is not configured.');
      return;
    }

    this.auth0.isAuthenticated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(authed => {
        if (authed) this.router.navigateByUrl('/lobby');
      });

    this.auth0.error$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(err => {
        this.error.set(err?.message ?? 'Sign-in failed. Try again.');
      });
  }
}
