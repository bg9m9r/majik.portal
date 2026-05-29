import { Component, computed, input, output } from '@angular/core';
import { CardSnapshot } from '../../../core/match/match.types';
import { CardViewComponent } from '../../../ui/card-view.component';

/**
 * Strip-thumbnail for a player's graveyard. Renders the top card (the
 * most-recently-added — CR 404.1 — last in the cards[] order) at ~1.5x
 * a hand card, with a count badge in the corner. Empty graveyard
 * renders a muted outline + "0".
 *
 * Clicking the pile emits `expand`, which the parent (board) lifts into
 * a full-overlay `GraveyardModalComponent`. Pile itself is read-only:
 * no selection, no drag — just a peek-and-expand affordance.
 *
 * Spec: graveyard-pile.component.spec.ts.
 */
@Component({
  selector: 'app-graveyard-pile',
  standalone: true,
  imports: [CardViewComponent],
  template: `
    <button
      type="button"
      class="graveyard-pile relative flex flex-col items-center gap-0.5 rounded border bg-black/40 p-1 text-xs hover:bg-white/10"
      [class.border-white/20]="count() > 0"
      [class.border-white/10]="count() === 0"
      [class.opacity-40]="count() === 0"
      [attr.aria-label]="ariaLabel()"
      [attr.data-testid]="'graveyard-pile-' + ownerSide()"
      (click)="expand.emit()">
      @if (topCard(); as top) {
        <app-card-view [snapshot]="top" zone="other" />
      } @else {
        <div class="graveyard-pile__empty flex items-center justify-center"
             style="width: var(--majik-card-w, 90px); height: var(--majik-card-h, 140px);">
          <span class="opacity-50">— empty —</span>
        </div>
      }
      <span class="graveyard-pile__count text-[10px] opacity-70">
        Graveyard: {{ count() }}
      </span>
    </button>
  `,
  styles: [`
    /* Slightly smaller than a hand card so the pile fits in the strip
       without crowding HUD / mana. */
    .graveyard-pile {
      --majik-card-w: 70px;
      --majik-card-h: 100px;
    }
  `],
})
export class GraveyardPileComponent {
  readonly cards = input<CardSnapshot[]>([]);
  /** "self" / "opponent" — drives data-testid + aria-label routing. */
  readonly ownerSide = input<'self' | 'opponent'>('self');
  readonly ownerName = input<string>('Player');
  readonly expand = output<void>();

  readonly count = computed(() => this.cards().length);
  /** Most-recently-added card = last index. */
  readonly topCard = computed<CardSnapshot | null>(() => {
    const cs = this.cards();
    return cs.length > 0 ? cs[cs.length - 1] : null;
  });
  readonly ariaLabel = computed(() =>
    `${this.ownerName()} graveyard, ${this.count()} ${this.count() === 1 ? 'card' : 'cards'}, click to expand`);
}
