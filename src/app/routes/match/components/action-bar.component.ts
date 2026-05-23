import { Component, computed, input, output, signal } from '@angular/core';
import { detectKind, PromptKind } from './prompt-overlay.component';

interface PromptSummary {
  expectedKinds?: string[];
  recipientPlayerId?: string;
  description?: string;
}

@Component({
  selector: 'app-action-bar',
  standalone: true,
  template: `
    <div
      class="flex items-center justify-between gap-3 border-t border-white/10 bg-black/40 px-3 py-2"
      role="toolbar"
      aria-label="game actions">
      <div class="text-xs">
        @if (currentPrompt(); as p) {
          <span class="prompt-readout" [attr.data-kind]="kind()">
            <span class="prompt-readout__label">prompt:</span>
            <span class="prompt-readout__text">{{ p.description ?? p.expectedKinds?.join(', ') ?? 'awaiting input' }}</span>
          </span>
        } @else {
          <span class="opacity-50">no active prompt</span>
        }
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded border border-[color:var(--majik-accent)] px-4 py-1.5 text-sm text-[color:var(--majik-accent)] hover:bg-[color:var(--majik-accent)]/10 disabled:opacity-40"
          [disabled]="!canPass() || submitting()"
          (click)="onPass()">
          {{ submitting() ? 'Passing…' : 'Pass priority' }}
        </button>
      </div>
    </div>
  `
})
export class ActionBarComponent {
  readonly canPass = input<boolean>(false);
  readonly currentPrompt = input<PromptSummary | null>(null);
  readonly submitting = signal(false);
  readonly pass = output<void>();

  // Echo the prompt-overlay color cue down to the action bar so the
  // bar carries the same kind signal even when the overlay isn't
  // mounted (e.g. waiting on opponent's combat declaration).
  readonly kind = computed<PromptKind>(() =>
    detectKind(this.currentPrompt()?.expectedKinds));

  async onPass(): Promise<void> {
    this.submitting.set(true);
    try {
      this.pass.emit();
    } finally {
      this.submitting.set(false);
    }
  }
}
