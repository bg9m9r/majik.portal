import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { CardSnapshot } from '../../../core/match/match.types';
import { CardViewComponent } from '../../../ui/card-view.component';

/**
 * Kind of off-battlefield zone this pile represents. Drives the label,
 * the single-letter glyph, the colour accent class, and whether the pile
 * is browsable (library is a hidden zone — CR 401 / 706 — so it has no
 * click-to-expand affordance; graveyard + exile are public — CR 406.3 /
 * 706.2 — and expand into a browse modal).
 */
export type ZoneKind = 'library' | 'graveyard' | 'exile';

interface ZoneMeta {
  label: string;
  glyph: string;
  browsable: boolean;
}

const ZONE_META: Record<ZoneKind, ZoneMeta> = {
  // Library is face-down/hidden — count only, never browsable.
  library: { label: 'Library', glyph: 'L', browsable: false },
  // Graveyard is public + ordered (delve/dredge/flashback care). Browse.
  graveyard: { label: 'Graveyard', glyph: 'G', browsable: true },
  // Exile is public for face-up exiles (the snapshot only carries the
  // cards the viewer is allowed to see). Browse.
  exile: { label: 'Exile', glyph: 'X', browsable: true },
};

/**
 * One off-battlefield zone, rendered as a compact tile: a single-letter
 * glyph chip, the zone label, and the card count. Browsable zones
 * (graveyard / exile) preview the top card as a small thumbnail and act
 * as a button that emits `expand` (the board lifts that into a
 * full-overlay browse modal). The library is count-only — no preview, no
 * expand — because it's a hidden zone.
 *
 * The tile colour-accents per zone kind AND per owner side (`self` /
 * `opponent`) so the cluster reads as "my zones" vs. "their zones" at a
 * glance, echoing the friend/foe rim used elsewhere on the board.
 *
 * Spec: zone-pile.component.spec.ts.
 */
@Component({
  selector: 'app-zone-pile',
  standalone: true,
  imports: [CardViewComponent, NgTemplateOutlet],
  template: `
    @if (browsable()) {
      <button
        type="button"
        class="zone-pile zone-pile--browsable"
        [class.zone-pile--empty]="count() === 0"
        [attr.data-zone-kind]="kind()"
        [attr.data-zone-side]="ownerSide()"
        [attr.data-testid]="'zone-pile-' + kind() + '-' + ownerSide()"
        [attr.aria-label]="ariaLabel()"
        (click)="expand.emit()">
        <ng-container [ngTemplateOutlet]="body" />
      </button>
    } @else {
      <div
        class="zone-pile zone-pile--static"
        [class.zone-pile--empty]="count() === 0"
        [attr.data-zone-kind]="kind()"
        [attr.data-zone-side]="ownerSide()"
        [attr.data-testid]="'zone-pile-' + kind() + '-' + ownerSide()"
        role="status"
        [attr.aria-label]="ariaLabel()">
        <ng-container [ngTemplateOutlet]="body" />
      </div>
    }

    <ng-template #body>
      <span class="zone-pile__glyph" aria-hidden="true">{{ glyph() }}</span>
      <span class="zone-pile__meta">
        <span class="zone-pile__label">{{ label() }}</span>
        <span class="zone-pile__count" data-testid="zone-pile-count">{{ count() }}</span>
      </span>
      @if (browsable() && topCard(); as top) {
        <span class="zone-pile__thumb" aria-hidden="true">
          <app-card-view [snapshot]="top" zone="other" />
        </span>
      }
    </ng-template>
  `,
})
export class ZonePileComponent {
  readonly kind = input.required<ZoneKind>();
  readonly cards = input<CardSnapshot[]>([]);
  /** "self" / "opponent" — drives data-testid + the friend/foe accent. */
  readonly ownerSide = input<'self' | 'opponent'>('self');
  readonly ownerName = input<string>('Player');
  /** Emitted on click (browsable zones only). */
  readonly expand = output<void>();

  readonly count = computed(() => this.cards().length);
  readonly label = computed(() => ZONE_META[this.kind()].label);
  readonly glyph = computed(() => ZONE_META[this.kind()].glyph);
  readonly browsable = computed(() => ZONE_META[this.kind()].browsable);

  /** Most-recently-added card = last index (CR 404.1 ordering). */
  readonly topCard = computed<CardSnapshot | null>(() => {
    const cs = this.cards();
    return cs.length > 0 ? cs[cs.length - 1] : null;
  });

  readonly ariaLabel = computed(() => {
    const n = this.count();
    const noun = n === 1 ? 'card' : 'cards';
    const base = `${this.ownerName()} ${this.label().toLowerCase()}, ${n} ${noun}`;
    return this.browsable() ? `${base}, click to view` : base;
  });
}
