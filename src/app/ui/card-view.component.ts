import { Component, computed, effect, inject, input } from '@angular/core';
import { CardSnapshot } from '../core/match/match.types';
import { ScryfallImageCache } from '../core/card/scryfall-image-cache.service';
import { ManaCostComponent } from './mana-cost.component';

// Where this card view is rendered. Summoning-sickness only applies to
// permanents on the battlefield (CR 302.1 / 716.1 — sickness is a
// property of being a creature that's been under its controller's
// control since the start of its turn), so the dot is suppressed in
// hand / stack / library views even if the engine snapshot still
// carries `summoningSickness: true`.
export type CardViewZone = 'battlefield' | 'hand' | 'stack' | 'other';

@Component({
  selector: 'app-card-view',
  standalone: true,
  imports: [ManaCostComponent],
  template: `
    <div
      class="card relative overflow-hidden flex flex-col justify-between p-1 text-[10px] text-stone-900"
      [class.is-tapped]="snapshot()?.tapped"
      [class.is-hidden]="hidden()"
      [title]="ariaLabel()"
      [attr.aria-label]="ariaLabel()"
      role="img">
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
          @if (showSummoningSickness()) {
            <span class="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" title="Summoning sickness"></span>
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
          @if (showSummoningSickness()) {
            <span class="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" title="Summoning sickness"></span>
          }
        }
      }
    </div>
  `
})
export class CardViewComponent {
  readonly snapshot = input<CardSnapshot | null>(null);
  readonly hidden = input<boolean>(false);
  // Defaults to 'other' so the summoning-sickness dot stays suppressed
  // unless the caller opts in by setting zone="battlefield".
  readonly zone = input<CardViewZone>('other');

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
}
