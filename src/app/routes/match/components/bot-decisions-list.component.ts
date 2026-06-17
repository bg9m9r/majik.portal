import { Component, input } from '@angular/core';
import { BotDecision } from '../../../core/match/match.types';

/**
 * Presentational list of the last N bot decisions received over SignalR
 * (most recent first). Each row summarises the chosen action + score +
 * the top losing alternative. The full JSON of a decision (context bag,
 * all losing candidates) is intentionally NOT dumped here — this is a
 * "why did the bot just do X" surface, not a structured-log viewer.
 *
 * List-only: visibility / positioning are owned by the host (the
 * InfoDrawer's bottom pane behind the Bot-Decisions tab). The previous
 * fixed-position toggle chrome (which floated over the action bar's Pass
 * button) is gone — that overlap is exactly what the drawer fixes.
 */
@Component({
  selector: 'app-bot-decisions-list',
  standalone: true,
  template: `
    <div
      role="log"
      aria-live="polite"
      aria-label="recent bot decisions"
      class="bot-decisions-list h-full overflow-y-auto text-xs text-white/90">
      @if (decisions().length === 0) {
        <p class="opacity-50">No bot decisions yet.</p>
      } @else {
        <ol class="flex flex-col gap-1">
          @for (d of decisions(); track d.receivedAt + d.chosen) {
            <li class="border-b border-white/5 py-1 last:border-b-0">
              <div class="flex items-baseline justify-between gap-2">
                <span class="font-mono text-[10px] uppercase tracking-wider text-[color:var(--majik-accent)]">{{ d.decisionType }}</span>
                <span class="font-mono text-[10px] opacity-50">{{ formatScore(d.chosenScore) }}</span>
              </div>
              <div class="truncate text-[11px]" [title]="d.chosen">{{ d.chosen }}</div>
              @if (topAlternative(d); as alt) {
                <div class="truncate text-[10px] opacity-60" [title]="alt.name">
                  vs {{ alt.name }} ({{ formatScore(alt.score) }})
                </div>
              }
            </li>
          }
        </ol>
      }
    </div>
  `,
})
export class BotDecisionsListComponent {
  readonly decisions = input.required<BotDecision[]>();

  /** Top losing candidate by score (the list is already sorted on the
   * server — see PriorityPolicy / CombatSearch). Returns undefined when
   * the chosen action was the only option, in which case we render the
   * decision without an alternatives line. */
  topAlternative(d: BotDecision) {
    return d.alternatives.length > 0 ? d.alternatives[0] : undefined;
  }

  // Compact score formatting: two decimals for normal eval values; the
  // EV scale used by HeuristicStrategy comfortably fits in that range.
  // Negative scores get a leading minus naturally via toFixed.
  formatScore(n: number): string {
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(2);
  }
}
