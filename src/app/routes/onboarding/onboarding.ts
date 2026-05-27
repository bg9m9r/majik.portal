import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthUserStore } from '../../core/auth/auth-user.store';

const HANDLE_REGEX = /^[A-Za-z0-9_-]{3,20}$/;

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [FormsModule],
  template: `
    <main class="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-8">
      <h1 class="text-3xl font-semibold tracking-wide">Pick a handle</h1>
      <p class="text-sm opacity-70">3-20 chars. Letters, digits, <code>_</code>, <code>-</code>. Globally unique.</p>

      <form class="flex w-full flex-col gap-3" (submit)="submit($event)">
        <input
          name="handle"
          class="rounded border border-white/10 bg-black/30 px-3 py-2 text-lg outline-none focus:border-[color:var(--majik-accent)]"
          [(ngModel)]="handle"
          (input)="localError.set(null)"
          autocomplete="off"
          autofocus
          required />
        <button
          type="submit"
          class="rounded border border-[color:var(--majik-accent)] px-4 py-2 text-[color:var(--majik-accent)] hover:bg-[color:var(--majik-accent)]/10 disabled:opacity-40"
          [disabled]="submitting() || !isLocallyValid()">
          {{ submitting() ? 'Saving…' : 'Save' }}
        </button>
        @if (localError(); as e) {
          <p class="text-xs text-red-300/80">{{ e }}</p>
        }
        @if (serverError(); as e) {
          <p class="text-xs text-red-300/80">{{ e }}</p>
        }
      </form>
    </main>
  `,
})
export class OnboardingPage {
  private readonly profile = inject(AuthUserStore);
  private readonly router = inject(Router);

  handle = this.profile.handle() ?? '';
  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);
  readonly serverError = signal<string | null>(null);

  isLocallyValid(): boolean {
    return HANDLE_REGEX.test(this.handle.trim());
  }

  async submit(evt: Event): Promise<void> {
    evt.preventDefault();
    this.serverError.set(null);
    const trimmed = this.handle.trim();
    if (!HANDLE_REGEX.test(trimmed)) {
      this.localError.set('3-20 chars; letters, digits, _ or -.');
      return;
    }
    this.submitting.set(true);
    const result = await this.profile.update(trimmed);
    this.submitting.set(false);
    if (result.ok) {
      this.router.navigate(['/lobby']);
      return;
    }
    switch (result.error.code) {
      case 'handle-taken':
        this.serverError.set('That handle is taken.');
        break;
      case 'invalid-handle':
        this.serverError.set(result.error.detail ?? 'Invalid handle.');
        break;
      case 'mongo-not-configured':
        this.serverError.set('Profile storage unavailable. Contact admin.');
        break;
      case 'network':
        this.serverError.set('Network error. Try again.');
        break;
      default:
        this.serverError.set('Unexpected error.');
    }
  }
}
