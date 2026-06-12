import { Component, input, output } from '@angular/core';
import { GamePlayer } from '../../../core/match/match.types';
import { ZoneKind, ZonePileComponent } from './zone-pile.component';

/**
 * A player's off-battlefield zone cluster: Library (count), Graveyard
 * (count + browse) and Exile (count + browse), grouped as one tidy rail
 * that lives at the outer edge of that player's half of the board.
 *
 * Rationale: before this, the graveyard pile was crammed into the
 * HUD/mana strip and library + exile only showed as tiny pips inside the
 * HUD — three off-battlefield zones with three inconsistent treatments.
 * Grouping them as a labelled rail gives the player one place to read
 * "where are my cards that aren't in play" and makes exile a first-class,
 * browsable zone matching the graveyard.
 *
 * The rail is owner-aware (`self` / `opponent`) so it can mirror the
 * friend/foe colour language and sit on the correct edge. Browsing a
 * zone re-emits `browse` with the zone kind; the board lifts that into
 * the shared zone-browse modal.
 *
 * Spec: zone-rail.component.spec.ts.
 */
@Component({
  selector: 'app-zone-rail',
  standalone: true,
  imports: [ZonePileComponent],
  template: `
    @if (player(); as p) {
      <aside
        class="zone-rail"
        [class.zone-rail--self]="ownerSide() === 'self'"
        [class.zone-rail--foe]="ownerSide() === 'opponent'"
        [attr.data-testid]="'zone-rail-' + ownerSide()"
        [attr.aria-label]="p.name + ' off-battlefield zones'">
        <app-zone-pile
          kind="library"
          [cards]="p.library.cards"
          [ownerSide]="ownerSide()"
          [ownerName]="p.name" />
        <app-zone-pile
          kind="graveyard"
          [cards]="p.graveyard.cards"
          [ownerSide]="ownerSide()"
          [ownerName]="p.name"
          (expand)="browse.emit('graveyard')" />
        <app-zone-pile
          kind="exile"
          [cards]="p.exile.cards"
          [ownerSide]="ownerSide()"
          [ownerName]="p.name"
          (expand)="browse.emit('exile')" />
      </aside>
    }
  `,
})
export class ZoneRailComponent {
  readonly player = input<GamePlayer | null>(null);
  readonly ownerSide = input<'self' | 'opponent'>('self');
  /** Re-emits the zone kind the user asked to browse (graveyard | exile). */
  readonly browse = output<ZoneKind>();
}
