import { Component, computed, effect, input, signal } from '@angular/core';
import { GamePlayer } from '../core/match/match.types';

@Component({
  selector: 'app-player-hud',
  standalone: true,
  template: `
    @if (player(); as p) {
      <div
        class="flex items-center gap-4 rounded border border-white/10 px-3 py-2 text-sm"
        [class.border-amber-400]="active()"
        [class.bg-amber-900/10]="active()"
        [attr.aria-label]="label() + ' ' + p.name + ' life ' + p.life"
        aria-live="polite">
        <div class="flex flex-col">
          <span class="text-xs uppercase tracking-wider opacity-60">{{ label() }}</span>
          <span class="font-semibold">{{ p.name }}</span>
        </div>
        <div class="ml-auto flex items-center gap-4 font-mono text-xs">
          <span
            title="Life"
            class="text-base font-bold inline-block"
            [class.life-flash-loss]="lifeFlash() === 'loss'"
            [class.life-flash-gain]="lifeFlash() === 'gain'">♥ {{ p.life }}</span>
          <span title="Library">L {{ p.library.cards.length }}</span>
          <span title="Hand">H {{ p.hand.cards.length }}</span>
          <span title="Graveyard">G {{ p.graveyard.cards.length }}</span>
          <span title="Exile" class="opacity-60">X {{ p.exile.cards.length }}</span>
        </div>
        <div class="flex items-center gap-1 font-mono text-xs">
          @for (m of manaPips(); track m.color) {
            @if (m.count > 0) {
              <span class="rounded bg-black/40 px-1" [title]="m.color">{{ m.symbol }}{{ m.count > 1 ? m.count : '' }}</span>
            }
          }
        </div>
      </div>
    }
  `
})
export class PlayerHudComponent {
  readonly player = input<GamePlayer | null>(null);
  readonly active = input<boolean>(false);
  readonly label = input<string>('player');

  // Drives the .life-flash-* class. Reset to null after the keyframe
  // duration so a follow-up change in the same direction re-triggers.
  // Setting to null between flashes is required because Angular won't
  // restart a CSS animation on the same class — the toggle is what
  // re-fires the keyframes.
  readonly lifeFlash = signal<'gain' | 'loss' | null>(null);
  private lastLife: number | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  readonly manaPips = computed(() => {
    const p = this.player();
    if (!p) return [];
    const m = p.mana;
    const num = (v: number | string) => (typeof v === 'number' ? v : Number(v));
    return [
      { color: 'white', symbol: 'W', count: num(m.white) },
      { color: 'blue', symbol: 'U', count: num(m.blue) },
      { color: 'black', symbol: 'B', count: num(m.black) },
      { color: 'red', symbol: 'R', count: num(m.red) },
      { color: 'green', symbol: 'G', count: num(m.green) },
      { color: 'colorless', symbol: 'C', count: num(m.colorless) },
      { color: 'generic', symbol: '*', count: num(m.generic) }
    ];
  });

  constructor() {
    effect(() => {
      const p = this.player();
      if (!p) {
        this.lastLife = null;
        return;
      }
      const cur = p.life;
      const prev = this.lastLife;
      // First sighting: seed the tracker, no flash. Avoids a fake gain
      // animation on the initial board mount when life pops from null
      // to the engine's starting 20.
      if (prev === null) {
        this.lastLife = cur;
        return;
      }
      if (cur === prev) return;
      const next: 'gain' | 'loss' = cur > prev ? 'gain' : 'loss';
      this.lastLife = cur;
      // Re-arm: clear first so toggling re-triggers the keyframe even
      // if we're already in the same direction (e.g. 2 damage events
      // back-to-back).
      if (this.flashTimer) clearTimeout(this.flashTimer);
      this.lifeFlash.set(null);
      // Defer one tick so the class actually toggles off→on. A 0ms
      // setTimeout is enough; rAF would also work but adds a frame.
      setTimeout(() => this.lifeFlash.set(next), 0);
      this.flashTimer = setTimeout(() => this.lifeFlash.set(null), 750);
    });
  }
}
