import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DeckApi } from '../../../../core/deck/deck.api';
import { DeckCardEntry, DeckError, ParsedDeck } from '../../../../core/deck/deck.types';

@Component({
  selector: 'app-deck-import-dialog',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div role="dialog" aria-modal="true" aria-labelledby="import-title"
         class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6">
      <div class="flex w-full max-w-2xl flex-col gap-3 rounded border border-[color:var(--majik-line)] bg-[color:var(--majik-bg)] p-4">
        <h2 id="import-title" class="majik-h2">Import deck</h2>
        <p class="text-xs opacity-60">Paste Arena or MTGO format. Headers (Deck / Sideboard) or a blank line split mainboard and sideboard.</p>

        <textarea
          rows="10"
          class="w-full rounded border border-[color:var(--majik-line)] bg-black/30 px-3 py-2 font-mono text-xs"
          placeholder="4 Lightning Bolt&#10;20 Mountain&#10;&#10;Sideboard&#10;3 Searing Blaze"
          [ngModel]="text()"
          (ngModelChange)="text.set($event)"
          aria-label="Deck text"></textarea>

        @if (error(); as e) {
          <p class="text-xs text-red-300">{{ humanError(e) }}</p>
        }

        @if (result(); as r) {
          <div class="flex flex-col gap-2 rounded border border-[color:var(--majik-line-faint)] p-3 text-sm">
            <p>Mainboard: {{ totalCount(r.mainboard) }} cards</p>
            <p>Sideboard: {{ totalCount(r.sideboard) }} cards</p>
            @if (r.unknown.length > 0) {
              <div class="rounded border border-red-400/50 bg-red-950/20 p-2 text-xs">
                <p class="font-semibold text-red-200">Unknown cards (skipped):</p>
                <ul class="ml-4 list-disc">
                  @for (name of r.unknown; track name) {
                    <li>{{ name }}</li>
                  }
                </ul>
              </div>
            }
            @if (r.warnings.length > 0) {
              <div class="rounded border border-amber-400/50 bg-amber-950/20 p-2 text-xs">
                <p class="font-semibold text-amber-200">Warnings:</p>
                <ul class="ml-4 list-disc">
                  @for (w of r.warnings; track w) {
                    <li>{{ w }}</li>
                  }
                </ul>
              </div>
            }
          </div>
        }

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" data-action="cancel"
                  class="rounded border border-[color:var(--majik-line)] px-3 py-1 text-sm hover:border-white/40"
                  (click)="onCancel()">Cancel</button>
          <button type="button" data-action="parse"
                  class="rounded border border-[color:var(--majik-line)] px-3 py-1 text-sm hover:border-[color:var(--majik-accent)] disabled:opacity-40"
                  [disabled]="!canParse()"
                  (click)="onParse()">{{ parsing() ? 'Parsing…' : 'Parse' }}</button>
          <button type="button" data-action="apply"
                  class="rounded border border-[color:var(--majik-accent)] px-3 py-1 text-sm text-[color:var(--majik-accent)] hover:bg-[color:var(--majik-accent)]/10 disabled:opacity-40"
                  [disabled]="!result()"
                  (click)="onApply()">Apply</button>
        </div>
      </div>
    </div>
  `,
})
export class DeckImportDialogComponent {
  private readonly api = inject(DeckApi);

  readonly apply = output<{ mainboard: DeckCardEntry[]; sideboard: DeckCardEntry[] }>();
  readonly cancel = output<void>();

  readonly text = signal('');
  readonly parsing = signal(false);
  readonly result = signal<ParsedDeck | null>(null);
  readonly error = signal<DeckError | null>(null);

  readonly canParse = computed(() => !this.parsing() && this.text().trim().length > 0);

  totalCount(entries: DeckCardEntry[]): number {
    return entries.reduce((a, e) => a + e.count, 0);
  }

  humanError(e: DeckError): string {
    switch (e.code) {
      case 'empty-text': return 'Paste some text to import.';
      case 'too-large': return 'Text too large; max 100,000 chars.';
      case 'mongo-not-configured': return 'Card database unavailable.';
      case 'network': return 'Connection lost. Retry.';
      default: return e.detail ?? 'Parse failed.';
    }
  }

  async onParse(): Promise<void> {
    this.parsing.set(true);
    this.error.set(null);
    try {
      const parsed = await firstValueFrom(this.api.parse(this.text()));
      this.result.set(parsed);
    } catch (err) {
      this.error.set(err as DeckError);
      this.result.set(null);
    } finally {
      this.parsing.set(false);
    }
  }

  onApply(): void {
    const r = this.result();
    if (!r) return;
    this.apply.emit({ mainboard: r.mainboard, sideboard: r.sideboard });
  }

  onCancel(): void {
    this.cancel.emit();
  }
}
