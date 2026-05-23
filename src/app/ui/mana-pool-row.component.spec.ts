import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ManaPoolRowComponent } from './mana-pool-row.component';
import { GamePlayer, ManaPool } from '../core/match/match.types';

function makePool(over: Partial<ManaPool> = {}): ManaPool {
  return {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0,
    ...over,
  };
}

function makePlayer(mana: ManaPool): GamePlayer {
  return {
    id: 'p1',
    name: 'Alice',
    life: 20,
    mana,
    hand: { cards: [] },
    library: { cards: [] },
    graveyard: { cards: [] },
    exile: { cards: [] },
    battlefield: { cards: [] },
  };
}

function render(player: GamePlayer | null) {
  TestBed.configureTestingModule({ imports: [ManaPoolRowComponent] });
  const fixture = TestBed.createComponent(ManaPoolRowComponent);
  fixture.componentRef.setInput('player', player);
  fixture.detectChanges();
  return fixture;
}

describe('ManaPoolRowComponent', () => {
  it('renders all seven pool slots (WUBRG + C + generic) regardless of count', () => {
    const fixture = render(makePlayer(makePool()));
    const pips = fixture.nativeElement.querySelectorAll('.mana-pool-row__pip');
    expect(pips.length).toBe(7);
  });

  it('renders the WUBRG + C + generic glyphs in stable order', () => {
    const fixture = render(makePlayer(makePool()));
    const glyphs = Array.from(
      fixture.nativeElement.querySelectorAll('.mana-pool-row__glyph')
    ).map(el => (el as HTMLElement).textContent?.trim());
    expect(glyphs).toEqual(['W', 'U', 'B', 'R', 'G', 'C', '*']);
  });

  it('dims zero-count slots via the --empty modifier and shows non-zero slots at full opacity', () => {
    const fixture = render(makePlayer(makePool({ white: 2, red: 1 })));
    const pips = fixture.nativeElement.querySelectorAll('.mana-pool-row__pip');
    // W is index 0, U=1, B=2, R=3, G=4, C=5, generic=6
    expect((pips[0] as HTMLElement).classList.contains('mana-pool-row__pip--empty')).toBe(false);
    expect((pips[1] as HTMLElement).classList.contains('mana-pool-row__pip--empty')).toBe(true);
    expect((pips[3] as HTMLElement).classList.contains('mana-pool-row__pip--empty')).toBe(false);
    expect((pips[6] as HTMLElement).classList.contains('mana-pool-row__pip--empty')).toBe(true);
  });

  it('shows the count badge only when count > 1', () => {
    const fixture = render(makePlayer(makePool({ white: 1, blue: 3 })));
    const pips = fixture.nativeElement.querySelectorAll('.mana-pool-row__pip');
    // White = 1 → no count badge
    expect((pips[0] as HTMLElement).querySelector('.mana-pool-row__count')).toBeNull();
    // Blue = 3 → count badge present with the text "3"
    const blueCount = (pips[1] as HTMLElement).querySelector('.mana-pool-row__count');
    expect(blueCount).not.toBeNull();
    expect(blueCount?.textContent?.trim()).toBe('3');
  });

  it('builds an accessible aria-label summarising non-zero pools', () => {
    const fixture = render(makePlayer(makePool({ white: 2, green: 1 })));
    const host = fixture.nativeElement.querySelector('.mana-pool-row');
    expect(host?.getAttribute('aria-label')).toBe('mana pool: 2 white, 1 green');
  });

  it('uses "empty" wording in the aria-label when every pool is zero', () => {
    const fixture = render(makePlayer(makePool()));
    const host = fixture.nativeElement.querySelector('.mana-pool-row');
    expect(host?.getAttribute('aria-label')).toBe('mana pool: empty');
  });

  it('renders nothing when player is null', () => {
    const fixture = render(null);
    const host = fixture.nativeElement.querySelector('.mana-pool-row');
    expect(host).toBeNull();
  });
});
