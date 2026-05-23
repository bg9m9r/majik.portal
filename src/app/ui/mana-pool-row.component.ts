import { Component, computed, input } from '@angular/core';
import { GamePlayer } from '../core/match/match.types';

// Mana-pool entry: which color slot, the in-pool count, and the
// design-token slug that drives the pip color. Generic mana doesn't
// have a `--mana-generic-*` token consistent with WUBRG so we reuse
// `--mana-generic` directly; the `cssVar` field carries the actual
// CSS variable string so the template can stay dumb.
interface ManaEntry {
  symbol: string;   // glyph rendered inside the pip
  label: string;    // accessible name for screen readers / tooltip
  cssVar: string;   // CSS variable for the pip background
  count: number;
}

@Component({
  selector: 'app-mana-pool-row',
  standalone: true,
  template: `
    @if (player(); as p) {
      <div class="mana-pool-row" role="group" [attr.aria-label]="ariaLabel()">
        @for (m of entries(); track m.symbol) {
          <span
            class="mana-pool-row__pip majik-mana-pip"
            [class.mana-pool-row__pip--empty]="m.count === 0"
            [style.background]="'var(' + m.cssVar + ')'"
            [title]="m.label + ': ' + m.count">
            <span class="mana-pool-row__glyph" aria-hidden="true">{{ m.symbol }}</span>
            @if (m.count > 1) {
              <span class="mana-pool-row__count" aria-hidden="true">{{ m.count }}</span>
            }
          </span>
        }
      </div>
    }
  `
})
export class ManaPoolRowComponent {
  readonly player = input<GamePlayer | null>(null);

  // All seven pool slots, always rendered (zero counts dim out at 25%
  // opacity via the empty modifier). Order locked WUBRG + C + generic
  // so the row always reads identically — muscle memory wins.
  readonly entries = computed<ManaEntry[]>(() => {
    const p = this.player();
    const m = p?.mana ?? {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0,
    };
    const num = (v: number | string) => (typeof v === 'number' ? v : Number(v) || 0);
    return [
      { symbol: 'W', label: 'white',     cssVar: '--mana-w',       count: num(m.white) },
      { symbol: 'U', label: 'blue',      cssVar: '--mana-u',       count: num(m.blue) },
      { symbol: 'B', label: 'black',     cssVar: '--mana-b',       count: num(m.black) },
      { symbol: 'R', label: 'red',       cssVar: '--mana-r',       count: num(m.red) },
      { symbol: 'G', label: 'green',     cssVar: '--mana-g',       count: num(m.green) },
      { symbol: 'C', label: 'colorless', cssVar: '--mana-c',       count: num(m.colorless) },
      { symbol: '*', label: 'generic',   cssVar: '--mana-generic', count: num(m.generic) },
    ];
  });

  readonly ariaLabel = computed<string>(() => {
    const parts = this.entries()
      .filter(e => e.count > 0)
      .map(e => `${e.count} ${e.label}`);
    return parts.length ? `mana pool: ${parts.join(', ')}` : 'mana pool: empty';
  });
}
