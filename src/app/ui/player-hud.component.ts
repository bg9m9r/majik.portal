import { Component, computed, effect, input, signal } from '@angular/core';
import { CardSnapshot, GamePlayer } from '../core/match/match.types';

// Side input — "self" tints the active rim emerald, "opponent" tints
// red. Lets the HUD echo the friend/foe ambient used on the
// battlefield rows so a glance at either side of the table reads as
// the same player.
export type HudSide = 'self' | 'opponent';

// Letters in a CardSnapshot.manaCost map to deck-identity colors via
// a parse of the engine's curly-brace token format ("{1}{G}", "{W/U}",
// etc.). Hybrid / Phyrexian symbols count both halves so a deck reads
// as multi-color even before the player visibly casts both halves.
const COLOR_LETTERS: ReadonlyArray<'W' | 'U' | 'B' | 'R' | 'G'> = ['W', 'U', 'B', 'R', 'G'];

function manaColorsIn(cost: string | undefined | null): Set<string> {
  const out = new Set<string>();
  if (!cost) return out;
  for (const ch of cost.toUpperCase()) {
    if (COLOR_LETTERS.includes(ch as never)) out.add(ch);
  }
  return out;
}

@Component({
  selector: 'app-player-hud',
  standalone: true,
  template: `
    @if (player(); as p) {
      <div
        class="player-hud relative flex items-center gap-4 overflow-hidden rounded border px-3 py-2 text-sm"
        [class.player-hud--self]="side() === 'self'"
        [class.player-hud--foe]="side() === 'opponent'"
        [class.player-hud--active]="active()"
        [attr.aria-label]="label() + ' ' + p.name + ' life ' + p.life"
        aria-live="polite">
        <!-- Deck-color identity strip — derived from the union of all
             visible cards' mana costs. Empty for a deck we haven't
             seen anything from yet (e.g. brand new opponent). -->
        @if (deckColors().length > 0) {
          <span
            class="player-hud__color-strip"
            [style.background]="deckColorGradient()"
            [attr.aria-hidden]="true"></span>
        }

        <div class="flex flex-col">
          <span class="text-xs uppercase tracking-wider opacity-60">{{ label() }}</span>
          <span class="font-semibold">
            {{ p.name }}
            <!-- Colorblind alt cue: triangle disambiguates self/opponent
                 for protanopes who cannot reliably distinguish the
                 green/red HUD rim. Hidden from assistive tech because
                 the host element aria-label already announces the
                 side via the label input. -->
            <span class="player-hud__side-glyph" aria-hidden="true">{{ sideGlyph() }}</span>
          </span>
        </div>
        <div class="ml-auto flex items-center gap-4 font-mono text-xs">
          <span
            title="Life"
            class="player-hud__life relative text-base font-bold inline-flex items-center gap-1"
            [class.player-hud__life--healthy]="lifeTier() === 'healthy'"
            [class.player-hud__life--warn]="lifeTier() === 'warn'"
            [class.player-hud__life--crit]="lifeTier() === 'crit'"
            [class.life-flash-loss]="lifeFlash() === 'loss'"
            [class.life-flash-gain]="lifeFlash() === 'gain'">
            <span aria-hidden="true">♥</span>
            <span>{{ p.life }}</span>
            @if (numeral(); as n) {
              <span
                class="life-numeral"
                [class.life-numeral--loss]="n.delta < 0"
                [class.life-numeral--gain]="n.delta > 0"
                [style.left.%]="50"
                [style.top.px]="-4"
                aria-hidden="true">{{ n.delta > 0 ? '+' : '' }}{{ n.delta }}</span>
            }
          </span>
          <span title="Library" class="player-hud__pip player-hud__pip--library">
            <span class="player-hud__pip-glyph" aria-hidden="true">L</span> {{ p.library.cards.length }}
          </span>
          <span title="Hand" class="player-hud__pip player-hud__pip--hand">
            <span class="player-hud__pip-glyph" aria-hidden="true">H</span> {{ p.hand.cards.length }}
          </span>
          <span title="Graveyard" class="player-hud__pip player-hud__pip--graveyard">
            <span class="player-hud__pip-glyph" aria-hidden="true">G</span> {{ p.graveyard.cards.length }}
          </span>
          <span title="Exile" class="player-hud__pip player-hud__pip--exile">
            <span class="player-hud__pip-glyph" aria-hidden="true">X</span> {{ p.exile.cards.length }}
          </span>
        </div>
      </div>
    }
  `
})
export class PlayerHudComponent {
  readonly player = input<GamePlayer | null>(null);
  readonly active = input<boolean>(false);
  readonly label = input<string>('player');
  readonly side = input<HudSide>('self');

  // Drives the .life-flash-* class. Reset to null after the keyframe
  // duration so a follow-up change in the same direction re-triggers.
  // Setting to null between flashes is required because Angular won't
  // restart a CSS animation on the same class — the toggle is what
  // re-fires the keyframes.
  readonly lifeFlash = signal<'gain' | 'loss' | null>(null);
  // Floating numeral that drifts off the life total when life changes.
  // `id` re-keys the DOM node so back-to-back deltas (e.g. two hits in
  // one combat) replay the keyframe instead of getting swallowed.
  readonly numeral = signal<{ id: number; delta: number } | null>(null);
  private numeralSeq = 0;
  private lastLife: number | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private numeralTimer: ReturnType<typeof setTimeout> | null = null;

  // Static life-tier classification. 'crit' adds a slow breathing
  // pulse so a dying player visually screams; 'healthy' fades the
  // number so a fresh board doesn't drown out other signals.
  readonly lifeTier = computed<'healthy' | 'warn' | 'crit'>(() => {
    const life = this.player()?.life ?? 0;
    if (life <= 5) return 'crit';
    if (life <= 10) return 'warn';
    return 'healthy';
  });

  // Color identity of the player's deck, derived from every visible
  // card. We sample hand + battlefield + graveyard + exile; library
  // is masked face-down so it has no usable manaCost. For the
  // opponent this means the strip lights up as the game progresses,
  // which doubles as a tell for what colors they've revealed.
  readonly deckColors = computed<string[]>(() => {
    const p = this.player();
    if (!p) return [];
    const seen = new Set<string>();
    const visible: CardSnapshot[] = [
      ...p.hand.cards,
      ...p.battlefield.cards,
      ...p.graveyard.cards,
      ...p.exile.cards,
    ];
    for (const c of visible) {
      for (const color of manaColorsIn(c.manaCost)) seen.add(color);
    }
    // Stable order — W U B R G — so a Bant deck always reads
    // green→white→blue from left to right, not whatever appeared
    // first in the snapshot.
    return COLOR_LETTERS.filter(l => seen.has(l));
  });

  readonly deckColorGradient = computed<string>(() => {
    const colors = this.deckColors();
    if (colors.length === 0) return 'transparent';
    const stops = colors.map(l => `var(--mana-${l.toLowerCase()})`);
    if (stops.length === 1) return stops[0];
    // Hard stops so each color owns its slice — gradient is wide
    // enough to read as bands rather than smear.
    const step = 100 / stops.length;
    const parts: string[] = [];
    stops.forEach((c, i) => {
      const start = (i * step).toFixed(2);
      const end = ((i + 1) * step).toFixed(2);
      parts.push(`${c} ${start}%`, `${c} ${end}%`);
    });
    return `linear-gradient(to bottom, ${parts.join(', ')})`;
  });

  // Colorblind-safe alt cue paired with the friend/foe rim color.
  // ▲ self / ▼ opponent — paired with the rim's emerald/red so a
  // protanope still has a non-color cue.
  readonly sideGlyph = computed<string>(() =>
    this.side() === 'self' ? '▲' : '▼');

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
      const delta = cur - prev;
      const next: 'gain' | 'loss' = delta > 0 ? 'gain' : 'loss';
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

      // Floating numeral — replaces any in-flight numeral so a fast
      // sequence reads as separate beats. Clears after 280ms (matches
      // the keyframe duration in board.scss).
      if (this.numeralTimer) clearTimeout(this.numeralTimer);
      this.numeral.set(null);
      const id = ++this.numeralSeq;
      setTimeout(() => this.numeral.set({ id, delta }), 0);
      this.numeralTimer = setTimeout(() => {
        // Only clear if a newer numeral hasn't already replaced ours.
        if (this.numeral()?.id === id) this.numeral.set(null);
      }, 320);
    });
  }
}
