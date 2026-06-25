import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';

/**
 * In-app issue-report dialog (Slice 1). A small modal: a description
 * textarea + Submit / Cancel. The parent (match page) owns telemetry
 * assembly + the service call; this component is a pure input surface
 * that emits the typed description on submit.
 *
 * Styling is inline Tailwind (jsdom can't load external .scss, and the
 * page-level header test asserts against rendered DOM).
 */
@Component({
  selector: 'app-report-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Report an issue"
      data-test="report-dialog">
      <div
        class="w-full max-w-md rounded-lg border border-[color:var(--majik-line)] bg-[color:var(--majik-bg)] p-4 shadow-xl">
        <h2 class="majik-h2 mb-2">Report an issue</h2>
        <p class="mb-3 text-sm opacity-70">
          Describe what went wrong. We'll attach the current game state +
          recent client diagnostics automatically.
        </p>
        <textarea
          data-test="report-description"
          class="min-h-28 w-full rounded border border-[color:var(--majik-line)] bg-transparent p-2 text-sm"
          placeholder="What happened?"
          [value]="description()"
          (input)="onInput($event)"
          aria-label="Issue description"></textarea>
        <div class="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            data-test="report-cancel"
            class="rounded px-3 py-1 text-sm underline opacity-70 hover:opacity-100"
            (click)="cancel.emit()">Cancel</button>
          <button
            type="button"
            data-test="report-submit"
            class="rounded bg-[color:var(--majik-accent)] px-3 py-1 text-sm text-black disabled:opacity-40"
            [disabled]="!canSubmit()"
            (click)="onSubmit()">Submit</button>
        </div>
      </div>
    </div>
  `,
})
export class ReportDialogComponent {
  readonly submitReport = output<string>();
  readonly cancel = output<void>();

  readonly description = signal('');

  canSubmit(): boolean {
    return this.description().trim().length > 0;
  }

  onInput(event: Event): void {
    this.description.set((event.target as HTMLTextAreaElement).value);
  }

  onSubmit(): void {
    const d = this.description().trim();
    if (d.length === 0) return;
    this.submitReport.emit(d);
  }
}
