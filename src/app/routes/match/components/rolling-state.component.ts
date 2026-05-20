import { Component, input } from '@angular/core';
import { Match } from '../../../core/match/match.types';

@Component({
  selector: 'app-rolling-state',
  standalone: true,
  template: `
    <div class="mx-auto flex max-w-xl flex-col items-center gap-6 p-8">
      <h2 class="majik-h3">{{ stateLabel() }}</h2>

      <div class="flex items-center gap-8">
        <div class="flex flex-col items-center gap-1">
          <span class="text-xs opacity-60">{{ match().creator.handle }}</span>
          <div class="flex h-16 w-16 items-center justify-center rounded border border-[color:var(--majik-line)] text-3xl majik-mono">
            {{ creatorRoll() }}
          </div>
        </div>

        <span class="majik-h3 opacity-40">vs</span>

        <div class="flex flex-col items-center gap-1">
          <span class="text-xs opacity-60">{{ match().opponent?.handle ?? '???' }}</span>
          <div class="flex h-16 w-16 items-center justify-center rounded border border-[color:var(--majik-line)] text-3xl majik-mono">
            {{ opponentRoll() }}
          </div>
        </div>
      </div>

      @if (match().roll; as r) {
        <p class="text-sm opacity-70">
          Winner: <span class="text-[color:var(--majik-accent)]">{{ winnerHandle() }}</span>
        </p>
      } @else {
        <p class="text-sm opacity-50">Rolling dice…</p>
      }
    </div>
  `,
})
export class RollingStateComponent {
  readonly match = input.required<Match>();

  stateLabel(): string {
    const s = this.match().state;
    if (s === 'Joined') return 'Opponent joined';
    if (s === 'Starting') return 'Starting…';
    return 'Roll for first player';
  }

  creatorRoll(): string {
    return this.match().roll ? String(this.match().roll!.creatorRoll) : '—';
  }

  opponentRoll(): string {
    return this.match().roll ? String(this.match().roll!.opponentRoll) : '—';
  }

  winnerHandle(): string {
    const r = this.match().roll;
    if (!r) return '';
    const m = this.match();
    if (r.winnerSub === m.creator.sub) return m.creator.handle;
    if (m.opponent && r.winnerSub === m.opponent.sub) return m.opponent.handle;
    return r.winnerSub;
  }
}
