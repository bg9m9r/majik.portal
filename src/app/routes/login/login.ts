import { Component, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DescopeAuthService } from '@descope/angular-sdk';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  template: `
    <main class="grid min-h-screen place-items-center px-6 py-12"
          style="background: var(--majik-bg); color: var(--majik-fg);">
      <div class="vignette relative flex w-full max-w-sm flex-col items-center gap-8">

        <header class="flex items-center gap-5">
          <img
            src="logo/logo-icon.svg"
            alt=""
            class="h-20 w-20 select-none drop-shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
            draggable="false" />
          <img
            src="logo/logo-majik-wordmark.svg"
            alt="Majik"
            class="h-14 select-none"
            draggable="false" />
        </header>

        <p class="text-center text-sm leading-relaxed"
           style="color: var(--majik-fg-muted);">
          Open-source Magic: The Gathering rules engine.<br />
          1v1, desktop, free.
        </p>

        @if (auth.isStub) {
          <button
            class="w-full rounded px-6 py-2.5 text-sm font-medium transition-colors"
            style="border: 1px solid var(--majik-accent);
                   color: var(--majik-accent);
                   background: transparent;"
            (mouseenter)="hover = 'stub'" (mouseleave)="hover = null"
            [style.background]="hover === 'stub' ? 'var(--majik-accent-soft)' : 'transparent'"
            (click)="continue()">
            Enter — stub user
            <span class="ml-1 opacity-50">{{ auth.principal()?.sub }}</span>
          </button>
        } @else {
          <button
            type="button"
            class="flex w-full items-center justify-center gap-3 rounded px-6 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style="background: #5865F2; color: #ffffff;"
            (mouseenter)="hover = 'discord'" (mouseleave)="hover = null"
            [style.background]="hover === 'discord' && !busy() ? '#4752C4' : '#5865F2'"
            [disabled]="busy()"
            (click)="signInWithDiscord()">
            <svg width="20" height="20" viewBox="0 0 71 55" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M60.1 4.9A58.6 58.6 0 0 0 46 .5l-.6 1.3a54 54 0 0 0-16.1 0L28.7.5A58.7 58.7 0 0 0 14.6 4.9C5.6 18.1 3.1 31 4.4 43.7a59 59 0 0 0 18 9 43.5 43.5 0 0 0 3.8-6.1 38.2 38.2 0 0 1-6-2.9c.5-.4 1-.7 1.5-1.1a42 42 0 0 0 36.4 0c.5.4 1 .7 1.5 1.1a38 38 0 0 1-6 2.9 42.7 42.7 0 0 0 3.8 6 59 59 0 0 0 18-9c1.5-14.7-2.5-27.5-10.3-38.8ZM23.7 36.1c-3.5 0-6.5-3.2-6.5-7.2 0-4 2.8-7.3 6.5-7.3 3.6 0 6.5 3.3 6.5 7.3 0 4-2.8 7.2-6.5 7.2Zm23.8 0c-3.5 0-6.4-3.2-6.4-7.2 0-4 2.8-7.3 6.4-7.3 3.7 0 6.6 3.3 6.5 7.3 0 4-2.8 7.2-6.5 7.2Z"/>
            </svg>
            {{ busy() ? 'Redirecting…' : 'Sign in with Discord' }}
          </button>
          @if (error()) {
            <p class="text-center text-sm" style="color: var(--majik-danger, #e07a7a);">
              {{ error() }}
            </p>
          }
        }

        <footer class="majik-micro flex items-center gap-2 pt-4"
                style="color: var(--majik-fg-faint);">
          <span>v0.1</span>
          <span aria-hidden="true">·</span>
          <a href="https://github.com/bg9m9r/majik"
             target="_blank" rel="noopener"
             class="underline-offset-2 hover:underline"
             style="color: var(--majik-fg-muted);">
            github.com/bg9m9r/majik
          </a>
        </footer>

      </div>
    </main>
  `,
  styles: [`
    :host { display: block; }
    .vignette::before {
      content: "";
      position: absolute;
      inset: -40px;
      background: radial-gradient(closest-side at center,
                                  rgba(202, 167, 90, 0.06),
                                  transparent 70%);
      pointer-events: none;
      z-index: -1;
    }
  `]
})
export class LoginPage {
  readonly auth = inject(AuthService);
  private readonly descope = inject(DescopeAuthService, { optional: true });
  private readonly router = inject(Router);

  hover: 'stub' | 'discord' | null = null;
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (this.auth.isAuthenticated()) {
        this.router.navigate(['/lobby']);
      }
    });
  }

  continue(): void {
    this.router.navigate(['/lobby']);
  }

  async signInWithDiscord(): Promise<void> {
    if (!this.descope) {
      this.error.set('Auth is not configured.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const redirectUrl = `${window.location.origin}/auth/callback`;
      const res = await firstValueFrom(
        this.descope.descopeSdk.oauth.start('discord', redirectUrl)
      );
      const url = (res?.data as { url?: string } | undefined)?.url;
      if (!url) {
        throw new Error('Descope did not return an OAuth URL.');
      }
      // Full navigation to Discord — Descope handles the callback, then
      // bounces back to /auth/callback?code=... where CallbackPage
      // exchanges the code for a session JWT.
      window.location.assign(url);
    } catch (err) {
      this.busy.set(false);
      this.error.set(err instanceof Error ? err.message : 'Sign-in failed. Try again.');
    }
  }
}
