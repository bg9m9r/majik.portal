import { Component, EventEmitter, Input, Output, computed, input, output } from '@angular/core';
import { CardSnapshot } from '../../../core/match/match.types';
import { CardViewComponent } from '../../../ui/card-view.component';

/**
 * CR 706.2 — graveyards are a public zone; both players (and spectators)
 * can browse them at any time. This modal renders every card in the
 * supplied graveyard as a scrollable grid; read-only (no selection, no
 * action). Card-view tiles inherit their normal hover-popover behaviour
 * for oracle text via CardPopoverService.
 *
 * Why a separate modal (vs. inline expand on the pile): graveyard order
 * matters mechanically (delve / dredge / Lurrus / Snapcaster all reference
 * top-most), and pile thumbnails only show the most-recent. The modal is
 * the canonical "look through the whole pile" surface.
 *
 * Spec: graveyard-modal.component.spec.ts.
 */
@Component({
  selector: 'app-graveyard-modal',
  standalone: true,
  imports: [CardViewComponent],
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="title()"
      (click)="onBackdropClick($event)"
      data-testid="graveyard-modal-backdrop">
      <div
        class="relative max-h-[80vh] w-full max-w-4xl overflow-hidden rounded-lg border border-white/15 bg-zinc-900 shadow-2xl"
        (click)="$event.stopPropagation()">
        <div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 class="text-sm font-semibold text-white">
            {{ title() }}
            <span class="ml-2 opacity-60">({{ cards().length }})</span>
          </h2>
          <button
            type="button"
            data-testid="graveyard-modal-close"
            class="rounded border border-white/20 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
            (click)="closed.emit()">
            Close
          </button>
        </div>
        <div class="max-h-[70vh] overflow-y-auto p-4">
          @if (cards().length === 0) {
            <p data-testid="graveyard-modal-empty" class="text-center text-sm opacity-50">
              Graveyard empty.
            </p>
          } @else {
            <div
              class="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3"
              data-testid="graveyard-modal-grid"
              role="list"
              [attr.aria-label]="title() + ' contents'">
              @for (c of cards(); track c.instanceId; let i = $index) {
                <div role="listitem" class="flex flex-col items-center gap-1">
                  <span class="text-[10px] opacity-50">#{{ i + 1 }}</span>
                  <app-card-view [snapshot]="c" zone="other" />
                </div>
              }
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class GraveyardModalComponent {
  /** Owner name — e.g. "Alice's graveyard". */
  readonly ownerName = input<string>('Player');
  /** Cards in graveyard. Order = most-recently-added at the END (CR 404). */
  readonly cards = input<CardSnapshot[]>([]);
  /** Emitted on close (backdrop click or Close button). */
  readonly closed = output<void>();

  readonly title = computed(() => `${this.ownerName()}'s graveyard`);

  onBackdropClick(_evt: Event): void {
    this.closed.emit();
  }
}
