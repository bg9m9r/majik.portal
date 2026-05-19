import { Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DescopeComponent } from '@descope/angular-sdk';
import { AuthService } from '../../core/auth/auth.service';
import { MAJIK_AUTH_CONFIG } from '../../core/auth/auth.config';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [DescopeComponent],
  template: `
    <main class="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 class="text-3xl font-semibold tracking-wide">Majik</h1>

      @if (auth.isStub) {
        <p class="text-sm opacity-70">Auth stub mode — signed in as <code>{{ auth.principal()?.sub }}</code></p>
        <button
          class="rounded border border-[color:var(--majik-accent)] px-6 py-2 text-[color:var(--majik-accent)] hover:bg-[color:var(--majik-accent)]/10"
          (click)="continue()">
          Enter
        </button>
      } @else {
        <descope
          [flowId]="cfg.flowId"
          theme="dark"
          (error)="onError($event)"></descope>
      }
    </main>
  `
})
export class LoginPage {
  readonly auth = inject(AuthService);
  readonly cfg = inject(MAJIK_AUTH_CONFIG);
  private readonly router = inject(Router);

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
