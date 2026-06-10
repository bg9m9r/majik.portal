import { Component, ElementRef, EventEmitter, Output, computed, effect, inject, input } from '@angular/core';
import { CardSnapshot } from '../core/match/match.types';
import { Card } from '../core/card/card.types';
import { ScryfallImageCache } from '../core/card/scryfall-image-cache.service';
import { CardPopoverService } from './card-popover.service';
import { ManaCostComponent } from './mana-cost.component';

// Where this card view is rendered. Summoning-sickness only applies to
// permanents on the battlefield (CR 302.1 / 716.1 — sickness is a
// property of being a creature that's been under its controller's
// control since the start of its turn), so the ring is suppressed in
// hand / stack / library views even if the engine snapshot still
// carries `summoningSickness: true`.
export type CardViewZone = 'battlefield' | 'hand' | 'stack' | 'other';

// A rendered counter badge. `variant` drives colour (green +1/+1, red
// -1/-1, blue loyalty, amber everything else); `label` is the short
// on-card text; `title` is the verbose tooltip/aria phrasing.
export interface CounterPip {
  kind: string;
  variant: 'plus' | 'minus' | 'loyalty' | 'other';
  label: string;
  title: string;
}

/**
 * Map an engine counter-type name + count to a renderable pip. The engine
 * keys +1/+1 and -1/-1 counters as the literal strings "+1/+1" / "-1/-1"
 * (CR 122 / 704.5q), loyalty as "Loyalty" (CR 306.5b). We special-case
 * those three and fall back to "Name ×N" for charge / age / fade / etc.
 * Case-insensitive on the well-known names so a server casing change
 * doesn't silently downgrade the styling.
 */
export function makeCounterPip(kind: string, count: number): CounterPip {
  const lower = kind.toLowerCase();
  if (lower === '+1/+1') {
    return { kind, variant: 'plus', label: `+1/+1 ×${count}`, title: `${count} +1/+1 counter${count === 1 ? '' : 's'}` };
  }
  if (lower === '-1/-1') {
    const n = Math.abs(count);
    return { kind, variant: 'minus', label: `-1/-1 ×${n}`, title: `${n} -1/-1 counter${n === 1 ? '' : 's'}` };
  }
  if (lower === 'loyalty') {
    return { kind, variant: 'loyalty', label: String(count), title: `loyalty ${count}` };
  }
  return { kind, variant: 'other', label: `${kind} ×${count}`, title: `${count} ${kind} counter${count === 1 ? '' : 's'}` };
}

@Component({
  selector: 'app-card-view',
  standalone: true,
  imports: [ManaCostComponent],
  template: `
    <div class="flex flex-col items-stretch">
    <div #host
      class="card relative overflow-hidden flex flex-col justify-between p-1 text-[10px] text-stone-900"
      [class.is-tapped]="snapshot()?.tapped"
      [class.is-hidden]="hidden()"
      [class.is-sick]="showSummoningSickness()"
      [class.card--castable]="castable()"
      [title]="ariaLabel()"
      [attr.aria-label]="ariaLabel()"
      role="img"
      (mouseenter)="onHover()"
      (mouseleave)="onLeave()"
      (dblclick)="onDoubleClick()">
      @if (snapshot()?.tapped && !hidden()) {
        <span class="card__tap-pin" aria-hidden="true">TAP</span>
      }
      @if (!hidden() && counterPips().length) {
        <div class="card__counters" role="group" [attr.aria-label]="countersAriaLabel()">
          @for (pip of counterPips(); track pip.kind) {
            <span class="card__counter-pip"
                  [class.card__counter-pip--plus]="pip.variant === 'plus'"
                  [class.card__counter-pip--minus]="pip.variant === 'minus'"
                  [class.card__counter-pip--loyalty]="pip.variant === 'loyalty'"
                  [class.card__counter-pip--other]="pip.variant === 'other'"
                  [title]="pip.title"
                  aria-hidden="true">{{ pip.label }}</span>
          }
        </div>
      }
      @if (hidden()) {
        <span class="m-auto text-stone-300/70">?</span>
      } @else if (snapshot(); as c) {
        @if (imageUrl()) {
          <img
            class="absolute inset-0 h-full w-full object-cover"
            [src]="imageUrl()"
            [alt]="c.name"
            loading="lazy"
            referrerpolicy="no-referrer" />
          @if (c.power !== null && c.toughness !== null) {
            <span class="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[10px] text-stone-100">{{ c.power }}/{{ c.toughness }}</span>
          }
        } @else {
          <div class="flex items-start justify-between gap-1">
            <span class="line-clamp-2 font-semibold leading-tight">{{ c.name }}</span>
            <app-mana-cost [cost]="c.manaCost" />
          </div>
          <div class="flex items-end justify-between">
            <span class="truncate opacity-70">{{ typeLine() }}</span>
            @if (c.power !== null && c.toughness !== null) {
              <span class="rounded bg-black/40 px-1 font-mono text-stone-100">{{ c.power }}/{{ c.toughness }}</span>
            }
          </div>
        }
      }
    </div>
    @if (imprintedCards().length) {
      <div class="card__imprints mt-0.5 flex flex-wrap items-center justify-center gap-0.5"
           role="list"
           [attr.aria-label]="imprintsAriaLabel()">
        @for (im of imprintedCards(); track im.instanceId) {
          <span class="card__imprint-chip max-w-full truncate rounded-sm bg-stone-900/80 px-1 py-px text-[8px] leading-tight text-amber-200/90 ring-1 ring-amber-400/30"
                role="listitem"
                [title]="im.name">{{ im.name }}</span>
        }
      </div>
    }
    </div>
  `
})
export class CardViewComponent {
  readonly snapshot = input<CardSnapshot | null>(null);
  readonly hidden = input<boolean>(false);
  // Defaults to 'other' so the summoning-sickness ring stays suppressed
  // unless the caller opts in by setting zone="battlefield".
  readonly zone = input<CardViewZone>('other');
  // Castable hint — board.component computes this for the viewer's own
  // hand based on priority + mana availability. Defaults to false so
  // non-hand renderings stay neutral.
  readonly castable = input<boolean>(false);

  @Output() readonly cardDoubleClick = new EventEmitter<CardSnapshot>();

  onDoubleClick(): void {
    const snap = this.snapshot();
    if (snap) this.cardDoubleClick.emit(snap);
  }

  readonly showSummoningSickness = computed<boolean>(() => {
    if (this.zone() !== 'battlefield') return false;
    const c = this.snapshot();
    if (!c?.summoningSickness) return false;
    // Only creatures can have summoning sickness. The engine's snapshot
    // already encodes the "became a creature this turn" case as
    // `types` containing "Creature" (e.g. an animated land flips its
    // type bit on activation), so a type check here is sufficient.
    return (c.types ?? []).some(t => t.toLowerCase() === 'creature');
  });

  private readonly cache = inject(ScryfallImageCache);
  private readonly popover = inject(CardPopoverService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;

  // Cards exiled WITH this permanent (e.g. creatures imprinted under
  // Agatha's Soul Cauldron — the engine surfaces them on
  // CardSnapshotDto.imprintedCards). They grant the permanent extra
  // abilities, so we render their names as chips beneath the tile to
  // show the player where those abilities come from. Empty/undefined
  // for ordinary permanents (and detached to plain exile when the
  // host leaves the battlefield, so non-battlefield views show none).
  readonly imprintedCards = computed<CardSnapshot[]>(() => this.snapshot()?.imprintedCards ?? []);

  readonly imprintsAriaLabel = computed<string>(() => {
    const names = this.imprintedCards().map(c => c.name);
    return names.length ? `exiled with this permanent: ${names.join(', ')}` : '';
  });

  // Counters on this permanent (engine CardSnapshotDto.Counters / the
  // CounterAddedEvent display patch). Rendered as small pips on the card
  // so the player sees WHY a creature is bigger than its printed P/T —
  // the P/T badge stays authoritative (already counter-inclusive) and the
  // pips are shown IN ADDITION. Zero/negative-cleared entries are dropped
  // so an emptied counter map (e.g. all +1/+1 removed) shows nothing.
  // +1/+1 and -1/-1 get a compact "±N" label and distinct colours; loyalty
  // shows the bare number; every other counter type shows "Name ×N".
  readonly counterPips = computed<CounterPip[]>(() => {
    const counters = this.snapshot()?.counters;
    if (!counters) return [];
    const pips: CounterPip[] = [];
    for (const [kind, count] of Object.entries(counters)) {
      if (!count) continue;
      pips.push(makeCounterPip(kind, count));
    }
    return pips;
  });

  readonly countersAriaLabel = computed<string>(() => {
    const pips = this.counterPips();
    return pips.length ? `counters: ${pips.map(p => p.title).join(', ')}` : '';
  });

  readonly typeLine = computed(() => (this.snapshot()?.types ?? []).join(' '));

  readonly imageUrl = computed(() => {
    // Re-read when the cache version bumps so newly-resolved URLs propagate.
    this.cache.version();
    if (this.hidden()) return null;
    const name = this.snapshot()?.name;
    if (!name) return null;
    return this.cache.get(name);
  });

  readonly ariaLabel = computed(() => {
    if (this.hidden()) return 'face-down card';
    const c = this.snapshot();
    if (!c) return '';
    const parts = [c.name];
    if (c.manaCost) parts.push(`cost ${c.manaCost}`);
    if (c.types?.length) parts.push(c.types.join(' '));
    if (c.power !== null && c.toughness !== null) parts.push(`${c.power}/${c.toughness}`);
    if (c.tapped) parts.push('tapped');
    if (this.showSummoningSickness()) parts.push('summoning sickness');
    const pips = this.counterPips();
    if (pips.length) parts.push(`counters: ${pips.map(p => p.title).join(', ')}`);
    return parts.join(', ');
  });

  constructor() {
    effect(() => {
      if (this.hidden()) return;
      const name = this.snapshot()?.name;
      if (!name) return;
      // Touch version() so this effect re-runs after a batch resolves and
      // handles snapshot name changes mid-life.
      this.cache.version();
      if (!this.cache.get(name)) this.cache.request([name]);
    });
  }

  /**
   * Open the detail popover on hover with a 250ms delay so accidental
   * mouse passes don't spam show/hide.
   *
   * Eligible zones: battlefield, hand, other. The face-down opponent
   * hand (`hidden=true`) is suppressed — we don't reveal opaque cards.
   * Stack-zone renderings are also suppressed; the stack panel has its
   * own dedicated readout.
   */
  onHover(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    if (this.hidden()) return;
    const snap = this.snapshot();
    if (!snap) return;
    const z = this.zone();
    if (z !== 'battlefield' && z !== 'hand' && z !== 'other') return;
    this.hoverTimer = setTimeout(() => {
      const rect = this.host.nativeElement.getBoundingClientRect();
      this.popover.show(snapshotToCard(snap), rect);
    }, 250);
  }

  onLeave(): void {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    this.popover.hide();
  }
}

/**
 * Adapter from the in-game CardSnapshot wire shape to the static Card
 * shape the popover renders. The snapshot doesn't carry oracle text or
 * a derived CMC — the popover falls back to displaying just the
 * mana-cost string + types + P/T when oracleText is missing.
 *
 * Exported so other components that surface a snapshot through the
 * popover (board's right-click "View details" action) reuse the same
 * mapping without duplicating it.
 */
export function snapshotToCard(snap: CardSnapshot): Card {
  return {
    name: snap.name,
    manaCost: snap.manaCost,
    types: snap.types,
    power: snap.power,
    toughness: snap.toughness,
    isImplemented: true,
    cmc: null,
    colors: [],
    oracleText: null,
  };
}
