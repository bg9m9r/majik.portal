import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DescopeAuthService } from '@descope/angular-sdk';
import { firstValueFrom } from 'rxjs';

/**
 * OAuth return target. Descope redirects here after the Discord round-trip
 * with `?code=...` (or `?err=...` on failure). Exchange the code for a
 * session JWT via `descopeSdk.oauth.exchange(code)`, then bounce to /lobby.
 * AuthService.session$ picks up the new session automatically.
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly descope = inject(DescopeAuthService, { optional: true });

  readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    if (!this.descope) {
      this.error.set('Auth is not configured.');
      return;
    }
    const params = this.route.snapshot.queryParamMap;
    const code = params.get('code');
    const err = params.get('err') ?? params.get('error');
    if (err) {
      this.error.set(`Discord sign-in was cancelled or failed (${err}).`);
      return;
    }
    if (!code) {
      this.error.set('Missing OAuth code in callback URL.');
      return;
    }
    try {
      await firstValueFrom(this.descope.descopeSdk.oauth.exchange(code));
      // session$ in AuthService will tick to authenticated and the route
      // guards on /lobby will let us through.
      await this.router.navigate(['/lobby']);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not exchange OAuth code.');
    }
  }
}
