import { Component, computed, input, output } from '@angular/core';
import { PhaseStops } from '../core/match/game.store';

const PHASES = [
  'Untap',
  'Upkeep',
  'Draw',
  'PreCombatMain',
  'BeginningOfCombat',
  'DeclareAttackers',
  'DeclareBlockers',
  'CombatDamage',
  'EndOfCombat',
  'PostCombatMain',
  'End',
  'Cleanup'
] as const;

// Bucket each phase into one of four visual categories so the bar reads
// as a 4-band rainbow timeline. The active chip in board.scss inherits
// its glow from the matching category via the data attribute below.
type PhaseCategory = 'setup' | 'main' | 'combat' | 'wind';

const PHASE_CATEGORY: Record<string, PhaseCategory> = {
  Untap: 'setup',
  Upkeep: 'setup',
  Draw: 'setup',
  PreCombatMain: 'main',
  BeginningOfCombat: 'combat',
  DeclareAttackers: 'combat',
  DeclareBlockers: 'combat',
  CombatDamage: 'combat',
  EndOfCombat: 'combat',
  PostCombatMain: 'main',
  End: 'wind',
  Cleanup: 'wind',
};

@Component({
  selector: 'app-phase-bar',
  standalone: true,
  template: `
    <div class="flex items-center gap-2 border-b border-white/10 bg-black/30 px-3 py-2 text-xs">
      <span class="text-[10px] uppercase tracking-wider opacity-60">Turn {{ turn() }}</span>
      <span class="mx-2 opacity-30">|</span>
      @for (p of phases; track p) {
        <button
          type="button"
          class="phase-chip relative rounded px-2 py-0.5 font-mono transition-opacity duration-200 hover:opacity-100 focus:outline focus:outline-2 focus:outline-amber-400"
          [class.phase-chip-active]="normalized() === p.toLowerCase()"
          [class.opacity-40]="normalized() !== p.toLowerCase() && !stops()[p]"
          [attr.data-category]="categoryFor(p)"
          [attr.aria-current]="normalized() === p.toLowerCase() ? 'step' : null"
          [attr.aria-label]="ariaLabelFor(p)"
          (click)="stopToggled.emit(p)">
          {{ p }}
          @if (stops()[p]; as owner) {
            <span
              class="phase-stop-badge"
              [class.phase-stop-mine]="owner === 'mine'"
              [class.phase-stop-theirs]="owner === 'theirs'"
              aria-hidden="true">
              {{ owner === 'mine' ? 'M' : 'T' }}
            </span>
          }
        </button>
      }
    </div>
  `
})
export class PhaseBarComponent {
  readonly phase = input<string | null | undefined>(null);
  readonly turn = input<number | string>(0);
  readonly stops = input<PhaseStops>({});
  readonly stopToggled = output<string>();

  readonly phases = PHASES;

  readonly normalized = computed(() => (this.phase() ?? '').toLowerCase());

  categoryFor(phase: string): PhaseCategory {
    return PHASE_CATEGORY[phase] ?? 'wind';
  }

  ariaLabelFor(phase: string): string {
    const stop = this.stops()[phase];
    if (!stop) return `${phase} — click to set priority stop`;
    return `${phase} — priority stop on ${stop === 'mine' ? 'your' : 'opponent'} turn`;
  }
}
