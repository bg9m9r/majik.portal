import { Component, computed, input } from '@angular/core';

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

@Component({
  selector: 'app-phase-bar',
  standalone: true,
  template: `
    <div class="flex items-center gap-2 border-b border-white/10 bg-black/30 px-3 py-2 text-xs">
      <span class="text-[10px] uppercase tracking-wider opacity-60">Turn {{ turn() }}</span>
      <span class="mx-2 opacity-30">|</span>
      @for (p of phases; track p) {
        <span
          class="rounded px-2 py-0.5 font-mono"
          [class.bg-emerald-700]="normalized() === p.toLowerCase()"
          [class.opacity-40]="normalized() !== p.toLowerCase()"
          [attr.aria-current]="normalized() === p.toLowerCase() ? 'step' : null">
          {{ p }}
        </span>
      }
    </div>
  `
})
export class PhaseBarComponent {
  readonly phase = input<string | null | undefined>(null);
  readonly turn = input<number | string>(0);

  readonly phases = PHASES;

  readonly normalized = computed(() => (this.phase() ?? '').toLowerCase());
}
