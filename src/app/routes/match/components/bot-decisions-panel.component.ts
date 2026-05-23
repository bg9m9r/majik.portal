import { Component, computed, input, signal } from '@angular/core';
import { BotDecision } from '../../../core/match/match.types';

/**
 * Unobtrusive corner-of-board diagnostics panel that lists the last N
 * bot decisions received over SignalR. Collapsed by default — the
 * toggle button is the only thing visible until the user opens it, so
 * the panel never competes with the action bar or board for vertical
 * space.
 *
 * Each row is a single line summarising the chosen action + score +
 * top alternative + its score. The full JSON of a decision (context
 * bag, all losing candidates) is intentionally NOT dumped here; the
 * panel is a "why did the bot just do X" surface, not a structured-log
 * viewer. Power users can pop the browser devtools and inspect
 * SignalrService.botDecisions$ if they want everything.
 */
@Component({
  selector: 'app-bot-decisions-panel',
  standalone: true,
  template: `
    <div class="pointer-events-none fixed bottom-2 right-2 z-30 flex flex-col items-end gap-1">
      <button
        type="button"
        class="pointer-events-auto rounded border border-white/15 bg-black/70 px-2 py-1 text-[10px] uppercase tracking-wider text-white/80 backdrop-blur transition hover:border-[color:var(--majik-accent)] hover:text-[color:var(--majik-accent)]"
        [attr.aria-expanded]="open()"
        aria-controls="bot-decisions-panel"
        (click)="toggle()">
        bot decisions
        @if (decisions().length > 0) {
          <span class="ml-1 inline-block rounded-full bg-[color:var(--majik-accent)]/30 px-1.5 text-[9px] text-[color:var(--majik-accent)]">
            {{ decisions().length }}
          </span>
        }
      </button>
      @if (open()) {
        <section
          id="bot-decisions-panel"
          role="log"
          aria-live="polite"
          aria-label="recent bot decisions"
          class="pointer-events-auto w-[min(28rem,90vw)] max-h-[40vh] overflow-y-auto rounded border border-white/15 bg-black/85 p-2 text-xs text-white/90 shadow-xl backdrop-blur">
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
        </section>
      }
    </div>
  `,
})
export class BotDecisionsPanelComponent {
  readonly decisions = input.required<BotDecision[]>();
  // Collapsed by default — the panel must not steal screen real estate
  // from the board on first load. Users opt in via the toggle button.
  readonly open = signal(false);

  toggle(): void {
    this.open.update(v => !v);
  }

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
