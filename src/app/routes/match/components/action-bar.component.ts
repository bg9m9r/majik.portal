import { Component, computed, inject, input, output, signal } from '@angular/core';

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
      <div class="text-xs opacity-70">
        @if (currentPrompt(); as p) {
          <span class="text-amber-300">prompt:</span>
          <span class="ml-1">{{ p.description ?? p.expectedKinds?.join(', ') ?? 'awaiting input' }}</span>
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

  async onPass(): Promise<void> {
    this.submitting.set(true);
    try {
      this.pass.emit();
    } finally {
      this.submitting.set(false);
    }
  }
}
