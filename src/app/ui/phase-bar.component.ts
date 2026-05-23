import {
  AfterViewInit,
  Component,
  ElementRef,
  QueryList,
  ViewChildren,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
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
    <div #bar class="phase-bar relative flex items-center gap-2 border-b border-white/10 bg-black/30 px-3 py-2 text-xs">
      <!--
        Sliding "cursor" that tracks the active chip. Position + width
        are measured from the DOM via @ViewChildren so the gold pill
        glides instead of flipping. transform/width are both
        transitioned in board.scss → .phase-cursor.
      -->
      @if (cursor(); as c) {
        <span
          class="phase-cursor"
          [attr.data-category]="cursorCategory()"
          aria-hidden="true"
          [style.transform]="'translateX(' + c.left + 'px)'"
          [style.width.px]="c.width">
        </span>
      }

      <span class="text-[10px] uppercase tracking-wider opacity-60">Turn {{ turn() }}</span>
      <span class="mx-2 opacity-30">|</span>
      @for (p of phases; track p) {
        <button
          #chip
          type="button"
          class="phase-chip relative rounded px-2 py-0.5 font-mono transition-opacity duration-200 hover:opacity-100 focus:outline focus:outline-2 focus:outline-amber-400"
          [class.phase-chip-active]="normalized() === p.toLowerCase()"
          [class.opacity-40]="normalized() !== p.toLowerCase() && !stops()[p]"
          [attr.data-category]="categoryFor(p)"
          [attr.data-phase]="p"
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
export class PhaseBarComponent implements AfterViewInit {
  readonly phase = input<string | null | undefined>(null);
  readonly turn = input<number | string>(0);
  readonly stops = input<PhaseStops>({});
  readonly stopToggled = output<string>();

  readonly phases = PHASES;

  readonly normalized = computed(() => (this.phase() ?? '').toLowerCase());

  // Cursor geometry — pixel offsets relative to the .phase-bar host.
  // `null` while the view hasn't mounted (avoids FLOUC on first paint;
  // the cursor pops in once we have a real bounding rect).
  readonly cursor = signal<{ left: number; width: number } | null>(null);

  readonly cursorCategory = computed<PhaseCategory>(() => {
    const active = this.phases.find(p => p.toLowerCase() === this.normalized());
    return active ? this.categoryFor(active) : 'wind';
  });

  @ViewChildren('chip') private chips!: QueryList<ElementRef<HTMLElement>>;

  constructor() {
    // Re-measure whenever the active phase changes. afterNextRender would
    // be a cleaner hook but a manual rAF defer gives us cheaper measurement
    // without bringing in the renderer-tap machinery; the chip list rarely
    // mutates so a single rAF is enough to catch the next layout.
    effect(() => {
      // Touch the dependencies so this re-runs on phase / stops change.
      this.normalized();
      this.stops();
      this.scheduleMeasure();
    });
  }

  ngAfterViewInit(): void {
    this.measure();
    // If chips reflow (e.g. host font load, theme switch), keep cursor synced.
    this.chips.changes.subscribe(() => this.scheduleMeasure());
  }

  private scheduleMeasure(): void {
    // Defer one rAF so the chip the active class just landed on has its
    // updated layout. If we measured synchronously inside the effect we'd
    // sometimes capture the *previous* chip's rect.
    if (typeof requestAnimationFrame === 'undefined') {
      this.measure();
      return;
    }
    requestAnimationFrame(() => this.measure());
  }

  private measure(): void {
    if (!this.chips) return;
    const active = this.chips.find(
      c => (c.nativeElement.getAttribute('data-phase') ?? '').toLowerCase() === this.normalized()
    );
    if (!active) return;
    const chipEl = active.nativeElement;
    const host = chipEl.parentElement;
    if (!host) return;
    const chipRect = chipEl.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    // Width zero usually means layout hasn't settled — bail and try next rAF.
    if (chipRect.width === 0) {
      this.scheduleMeasure();
      return;
    }
    this.cursor.set({
      left: chipRect.left - hostRect.left,
      width: chipRect.width,
    });
  }

  categoryFor(phase: string): PhaseCategory {
    return PHASE_CATEGORY[phase] ?? 'wind';
  }

  ariaLabelFor(phase: string): string {
    const stop = this.stops()[phase];
    if (!stop) return `${phase} — click to set priority stop`;
    return `${phase} — priority stop on ${stop === 'mine' ? 'your' : 'opponent'} turn`;
  }
}
