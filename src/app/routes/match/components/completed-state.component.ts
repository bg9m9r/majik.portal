import { Component, input } from '@angular/core';
import { Match } from '../../../core/match/match.types';

@Component({
  selector: 'app-completed-state',
  standalone: true,
  template: `
    <div class="mx-auto flex max-w-xl flex-col items-center gap-6 p-8">
      <h2 class="majik-display-2">{{ match().state === 'Abandoned' ? 'Abandoned' : 'Match over' }}</h2>

      @if (winnerHandle(); as w) {
        <p class="majik-h3 text-[color:var(--majik-accent)]">{{ w }} wins</p>
      }

      <dl class="flex flex-col gap-2 text-sm">
        @if (reason(); as r) {
          <div class="flex items-center justify-between gap-8">
            <dt class="opacity-60">Reason</dt>
            <dd class="majik-mono">{{ r }}</dd>
          </div>
        }
        <div class="flex items-center justify-between gap-8">
          <dt class="opacity-60">State</dt>
          <dd class="majik-mono">{{ match().state }}</dd>
        </div>
      </dl>
    </div>
  `,
})
export class CompletedStateComponent {
  readonly match = input.required<Match>();

  winnerHandle(): string | null {
    const m = this.match();
    if (!m.winnerSub) return null;
    if (m.winnerSub === m.creator.sub) return m.creator.handle;
    if (m.opponent && m.winnerSub === m.opponent.sub) return m.opponent.handle;
    return m.winnerSub;
  }

  reason(): string | null {
    const m = this.match();
    if (m.timeoutLoserSub) return 'timeout';
    if (m.state === 'Abandoned') return 'abandoned';
    if (m.winnerSub) return 'engine';
    return null;
  }
}
