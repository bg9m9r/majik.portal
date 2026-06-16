import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PlayerHudComponent } from './player-hud.component';
import type { GamePlayer } from '../core/match/match.types';

function player(id: string): GamePlayer {
  return {
    id,
    name: 'A',
    life: 20,
    mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
    hand: { cards: [] },
    library: { cards: [] },
    graveyard: { cards: [] },
    exile: { cards: [] },
    battlefield: { cards: [] },
  };
}

function mount(inputs: Record<string, unknown>) {
  const f = TestBed.createComponent(PlayerHudComponent);
  for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
  f.detectChanges();
  const hud = (f.nativeElement as HTMLElement).querySelector('.player-hud')!;
  return { f, hud };
}

describe('PlayerHudComponent — targeting affordance', () => {
  it('stamps the player id on the HUD root', () => {
    const { hud } = mount({ player: player('pA'), side: 'opponent' });
    expect(hud.getAttribute('data-player-id')).toBe('pA');
  });

  it('marks the HUD targetable', () => {
    const { hud } = mount({ player: player('pA'), side: 'opponent', targetable: true });
    expect(hud.getAttribute('data-targetable')).toBe('true');
  });

  it('marks the HUD dimmed', () => {
    const { hud } = mount({ player: player('pA'), dimmed: true });
    expect(hud.getAttribute('data-dimmed')).toBe('true');
  });

  it('marks the HUD selected', () => {
    const { hud } = mount({ player: player('pA'), selectedForTarget: true });
    expect(hud.getAttribute('data-selected')).toBe('true');
  });

  it('omits the affordance attrs when not targeting (null, not "false")', () => {
    const { hud } = mount({ player: player('pA') });
    expect(hud.getAttribute('data-targetable')).toBeNull();
    expect(hud.getAttribute('data-dimmed')).toBeNull();
    expect(hud.getAttribute('data-selected')).toBeNull();
  });
});
