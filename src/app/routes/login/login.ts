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

    /* Strip Descope's internal panel chrome so the widget reads as
       part of our page, not a popover stuck on top of it. Targets the
       common surface patterns regardless of which screen variant the
       flow renders. */
    :host ::ng-deep descope,
    :host ::ng-deep descope-wc,
    :host ::ng-deep descope-sign-in-flow,
    :host ::ng-deep descope-container,
    :host ::ng-deep [data-id="container"],
    :host ::ng-deep [data-type="container"],
    :host ::ng-deep [class*="container"],
    :host ::ng-deep [class*="Container"],
    :host ::ng-deep [class*="card"],
    :host ::ng-deep [class*="Card"],
    :host ::ng-deep [class*="panel"],
    :host ::ng-deep [class*="Panel"] {
      background: transparent !important;
      background-color: transparent !important;
      border: none !important;
      box-shadow: none !important;
      padding: 0 !important;
    }
    :host ::ng-deep descope,
    :host ::ng-deep descope-wc {
      display: block;
      width: 100%;
    }

    /* Subtle vignette so the composition has weight without a hard panel */
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
  `],
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
            (mouseenter)="hover = true" (mouseleave)="hover = false"
            [style.background]="hover ? 'var(--majik-accent-soft)' : 'transparent'"
            (click)="continue()">
            Enter — stub user
            <span class="ml-1 opacity-50">{{ auth.principal()?.sub }}</span>
          </button>
        } @else {
          <descope
            [flowId]="cfg.flowId"
            theme="dark"
            (error)="onError($event)"></descope>
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
