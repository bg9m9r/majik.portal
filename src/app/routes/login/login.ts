import { Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DescopeComponent } from '@descope/angular-sdk';
import { AuthService } from '../../core/auth/auth.service';
import { MAJIK_AUTH_CONFIG } from '../../core/auth/auth.config';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [DescopeComponent],
  styles: [`
    :host { display: block; }

    /* Descope widget overrides. The widget renders into light DOM with
       its own panel chrome; we strip that so our outer frame is the
       only visible container. */
    :host ::ng-deep descope-sign-in-flow,
    :host ::ng-deep descope-wc {
      display: block;
      width: 100%;
    }
    :host ::ng-deep descope-container,
    :host ::ng-deep [data-id="container"] {
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      padding: 0 !important;
    }
  `],
  template: `
    <main class="grid min-h-screen place-items-center px-6 py-12"
          style="background: var(--majik-bg); color: var(--majik-fg);">
      <div class="flex w-full max-w-sm flex-col items-center gap-6">

        <header class="flex flex-col items-center gap-3">
          <img
            src="logo/logo-icon.svg"
            alt=""
            class="h-20 w-20 select-none"
            draggable="false" />
          <img
            src="logo/logo-majik-wordmark.svg"
            alt="Majik"
            class="h-10 select-none"
            draggable="false" />
          <p class="text-center text-sm"
             style="color: var(--majik-fg-muted);">
            Open-source Magic: The Gathering rules engine.
            <br />
            1v1, desktop, free.
          </p>
        </header>

        @if (auth.isStub) {
          <section class="w-full rounded-lg border p-6 text-center"
                   style="border-color: var(--majik-line);
                          background: var(--majik-surface-1);">
            <p class="majik-micro mb-3">Auth stub mode</p>
            <p class="majik-mono mb-4" style="color: var(--majik-fg-muted);">
              signed in as <code class="majik-code">{{ auth.principal()?.sub }}</code>
            </p>
            <button
              class="w-full rounded px-6 py-2 transition-colors"
              style="border: 1px solid var(--majik-accent);
                     color: var(--majik-accent);
                     background: transparent;"
              (mouseenter)="hover = true" (mouseleave)="hover = false"
              [style.background]="hover ? 'var(--majik-accent-soft)' : 'transparent'"
              (click)="continue()">
              Enter
            </button>
          </section>
        } @else {
          <section class="w-full rounded-lg border p-6"
                   style="border-color: var(--majik-line);
                          background: var(--majik-surface-1);">
            <descope
              [flowId]="cfg.flowId"
              theme="dark"
              (error)="onError($event)"></descope>
          </section>
        }

        <footer class="majik-micro flex items-center gap-2"
                style="color: var(--majik-fg-faint);">
          <span>SERVER</span>
          <span style="color: var(--majik-fg-muted);">·</span>
          <a href="https://github.com/bg9m9r/majik"
             target="_blank" rel="noopener"
             class="underline-offset-2 hover:underline"
             style="color: var(--majik-fg-muted);">
            github.com/bg9m9r/majik
          </a>
        </footer>

      </div>
    </main>
  `
})
export class LoginPage {
  readonly auth = inject(AuthService);
  readonly cfg = inject(MAJIK_AUTH_CONFIG);
  private readonly router = inject(Router);

  hover = false;

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

  onError(_evt: CustomEvent): void {
    // Descope component renders inline errors itself.
  }
}
