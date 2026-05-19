import { Component, computed, input } from '@angular/core';
import { CardSnapshotDto } from '../core/api/models/card-snapshot-dto';
import { ManaCostComponent } from './mana-cost.component';

@Component({
  selector: 'app-card-view',
  standalone: true,
  imports: [ManaCostComponent],
  template: `
    <div
      class="card flex flex-col justify-between p-1 text-[10px] text-stone-900"
      [class.is-tapped]="snapshot()?.tapped"
      [class.is-hidden]="hidden()"
      [title]="ariaLabel()"
      [attr.aria-label]="ariaLabel()"
      role="img">
      @if (hidden()) {
        <span class="m-auto text-stone-300/70">?</span>
      } @else if (snapshot(); as c) {
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
        @if (c.summoningSickness) {
          <span class="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" title="Summoning sickness"></span>
        }
      }
    </div>
  `
})
export class CardViewComponent {
  readonly snapshot = input<CardSnapshotDto | null>(null);
  readonly hidden = input<boolean>(false);

  readonly typeLine = computed(() => (this.snapshot()?.types ?? []).join(' '));

  readonly ariaLabel = computed(() => {
    if (this.hidden()) return 'face-down card';
    const c = this.snapshot();
    if (!c) return '';
    const parts = [c.name];
    if (c.manaCost) parts.push(`cost ${c.manaCost}`);
    if (c.types?.length) parts.push(c.types.join(' '));
    if (c.power !== null && c.toughness !== null) parts.push(`${c.power}/${c.toughness}`);
    if (c.tapped) parts.push('tapped');
    if (c.summoningSickness) parts.push('summoning sickness');
    return parts.join(', ');
  });
}
