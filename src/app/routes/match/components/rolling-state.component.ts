import { Component, computed, inject, input } from '@angular/core';
import { Match } from '../../../core/match/match.types';
import { AuthUserStore } from '../../../core/auth/auth-user.store';

@Component({
  selector: 'app-rolling-state',
  standalone: true,
  template: `
    <div class="mx-auto flex max-w-xl flex-col items-center gap-6 p-8">
      <h2 class="majik-h3">{{ stateLabel() }}</h2>

      <div class="flex items-center gap-8">
        <div class="flex flex-col items-center gap-1">
          <span class="text-xs opacity-60">You</span>
          <div class="flex h-16 w-16 items-center justify-center rounded border border-[color:var(--majik-line)] text-3xl majik-mono">
            {{ ownRollDisplay() }}
          </div>
        </div>

        <span class="majik-h3 opacity-40">vs</span>

        <div class="flex flex-col items-center gap-1">
          <span class="text-xs opacity-60">Opponent</span>
          <div class="flex h-16 w-16 items-center justify-center rounded border border-[color:var(--majik-line)] text-3xl majik-mono">
            {{ opponentRollDisplay() }}
          </div>
        </div>
      </div>

      @if (winnerHandle(); as w) {
        <p class="text-sm opacity-70">
          Winner: <span class="text-[color:var(--majik-accent)]">{{ w }}</span>
        </p>
      } @else {
        <p class="text-sm opacity-50">Waiting for both rolls…</p>
      }
    </div>
  `,
})
export class RollingStateComponent {
  private readonly auth = inject(AuthUserStore);

  readonly match = input.required<Match>();

  stateLabel(): string {
    const s = this.match().state;
    if (s === 'Joined') return 'Opponent joined';
    if (s === 'Starting') return 'Starting…';
    return 'Roll for first player';
  }

  private isCreator(): boolean {
    const sub = this.auth.principal()?.sub;
    return !!sub && sub === this.match().creator.sub;
  }

  ownRollDisplay(): string {
    const r = this.match().roll;
    if (!r) return '—';
    const val = this.isCreator() ? r.creatorRoll : r.opponentRoll;
    return val != null ? String(val) : '—';
  }

  opponentRollDisplay(): string {
    const r = this.match().roll;
    if (!r) return '—';
    const val = this.isCreator() ? r.opponentRoll : r.creatorRoll;
    return val != null ? String(val) : '—';
  }

  winnerHandle(): string | null {
    const r = this.match().roll;
    if (!r?.winnerSub) return null;
    const m = this.match();
    if (r.winnerSub === m.creator.sub) return m.creator.handle;
    if (m.opponent && r.winnerSub === m.opponent.sub) return m.opponent.handle;
    return r.winnerSub;
  }
}
