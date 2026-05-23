import { Component, inject } from '@angular/core';
import { DevErrorToastService, DevErrorRecord } from './dev-error-toast.service';

/**
 * Top-right stack of verbose error cards. Each card holds the full
 * formatted-JSON dump of an HTTP failure or uncaught JS error. Cards do not
 * auto-dismiss — the user reads at leisure and clicks the close button.
 *
 * Positioned top-right so it doesn't collide with `BotDecisionsPanelComponent`
 * which lives bottom-right. The existing `<app-toast>` (single ephemeral
 * notice) also lives top-right but auto-clears after 3s; the two only
 * collide briefly and the dev-error stack flows downward beneath it.
 */
@Component({
  selector: 'app-dev-error-toast-container',
  standalone: true,
  template: `
    @if (svc.enabled() && svc.errors().length > 0) {
      <div
        class="pointer-events-none fixed right-2 top-12 z-[60] flex max-h-[90vh] w-[28rem] max-w-[95vw] flex-col gap-2 overflow-y-auto"
        aria-live="polite"
      >
        <div class="pointer-events-auto flex items-center justify-between rounded border border-red-400 bg-red-950/90 px-2 py-1 text-xs text-red-100 shadow">
          <span>{{ svc.errors().length }} dev error(s)</span>
          <div class="flex gap-2">
            <button
              type="button"
              class="rounded border border-red-300/60 px-2 py-0.5 hover:bg-red-900"
              (click)="svc.clearAll()"
              aria-label="Clear all dev error toasts"
            >Clear all</button>
            <button
              type="button"
              class="rounded border border-red-300/60 px-2 py-0.5 hover:bg-red-900"
              (click)="disable()"
              title="Disable dev error toasts (sets majik.devErrorToast=off)"
            >Disable</button>
          </div>
        </div>

        @for (err of svc.errors(); track err.id) {
          <article
            class="pointer-events-auto rounded border border-red-400 bg-red-950/95 text-red-50 shadow-lg"
            role="alert"
          >
            <header class="flex items-start justify-between gap-2 border-b border-red-400/40 px-3 py-2">
              <div class="min-w-0 flex-1">
                <div class="truncate text-xs font-semibold" [title]="err.title">{{ err.title }}</div>
                <div class="text-[10px] opacity-70">{{ kindLabel(err) }} · {{ err.timestamp }}</div>
              </div>
              <button
                type="button"
                class="shrink-0 rounded border border-red-300/60 px-2 py-0.5 text-xs hover:bg-red-900"
                (click)="svc.dismiss(err.id)"
                [attr.aria-label]="'Dismiss ' + err.title"
              >×</button>
            </header>
            <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-[11px] leading-snug"
                 >{{ err.detail }}</pre>
            <footer class="flex justify-end border-t border-red-400/40 px-3 py-1">
              <button
                type="button"
                class="rounded border border-red-300/60 px-2 py-0.5 text-[10px] hover:bg-red-900"
                (click)="copy(err)"
                title="Copy detail to clipboard"
              >Copy</button>
            </footer>
          </article>
        }
      </div>
    }
  `,
})
export class DevErrorToastContainerComponent {
  readonly svc = inject(DevErrorToastService);

  kindLabel(err: DevErrorRecord): string {
    return err.kind === 'http' ? 'HTTP error' : 'JS error';
  }

  disable(): void {
    this.svc.setEnabled(false);
    this.svc.clearAll();
  }

  async copy(err: DevErrorRecord): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${err.title}\n${err.detail}`);
    } catch {
      // ignore — clipboard may be blocked
    }
  }
}
