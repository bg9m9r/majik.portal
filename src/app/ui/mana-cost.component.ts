import { Component, computed, input } from '@angular/core';

/**
 * Renders a mana cost string (e.g. "{2}{U}{B}") using the Mana font
 * (Andrew Gioia). Each symbol maps to an `ms ms-<token>` class — the
 * mana-font stylesheet ships every WUBRG/colorless/hybrid/phyrexian
 * glyph Scryfall recognises. Costs come straight from the engine's
 * card-snapshot DTO.
 */
@Component({
  selector: 'app-mana-cost',
  standalone: true,
  template: `
    <span class="inline-flex items-center gap-0.5 align-middle text-base">
      @for (sym of symbols(); track $index) {
        <i [class]="'ms ms-cost ms-shadow ' + sym.cssClass" [attr.aria-label]="sym.aria"></i>
      }
    </span>
  `
})
export class ManaCostComponent {
  readonly cost = input<string>('');

  readonly symbols = computed<ManaSymbol[]>(() => {
    const raw = this.cost();
    if (!raw) return [];
    return Array.from(raw.matchAll(/\{[^}]+\}/g)).map(m => toSymbol(m[0].slice(1, -1)));
  });
}

interface ManaSymbol { cssClass: string; aria: string }

function toSymbol(token: string): ManaSymbol {
  // Lowercased, slashes become hyphens — matches mana-font's class naming
  // (e.g. {2/W} → ms-2w, {W/P} → ms-wp, {W/U} → ms-wu, {T} → ms-tap).
  const lower = token.toLowerCase();
  const aria = `mana ${token}`;
  if (lower === 't') return { cssClass: 'ms-tap', aria };
  if (lower === 'q') return { cssClass: 'ms-untap', aria };
  // Numeric generic: {0}-{20}, etc — mana-font supports each.
  if (/^\d+$/.test(lower)) return { cssClass: `ms-${lower}`, aria };
  // Strip slashes for hybrid/phyrexian variants: {2/W} → ms-2w, {W/P} → ms-wp.
  return { cssClass: `ms-${lower.replace(/\//g, '')}`, aria };
}
