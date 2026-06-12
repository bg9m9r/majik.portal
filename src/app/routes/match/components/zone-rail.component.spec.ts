import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { ZoneRailComponent } from './zone-rail.component';
import { ZoneKind } from './zone-pile.component';
import { CardSnapshot, GamePlayer } from '../../../core/match/match.types';

function card(id: string): CardSnapshot {
  return {
    instanceId: id,
    name: id,
    manaCost: '1G',
    types: ['Creature'],
    power: 2,
    toughness: 2,
    tapped: false,
    summoningSickness: false,
    producedManaColors: '',
  };
}

function player(over: Partial<GamePlayer> & Pick<GamePlayer, 'id' | 'name'>): GamePlayer {
  return {
    id: over.id,
    name: over.name,
    life: over.life ?? 20,
    mana: over.mana ?? { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
    hand: over.hand ?? { cards: [] },
    library: over.library ?? { cards: [] },
    graveyard: over.graveyard ?? { cards: [] },
    exile: over.exile ?? { cards: [] },
    battlefield: over.battlefield ?? { cards: [] },
  };
}

function mount(p: GamePlayer | null, side: 'self' | 'opponent' = 'self') {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [ZoneRailComponent] });
  const fixture = TestBed.createComponent(ZoneRailComponent);
  const ref: ComponentRef<ZoneRailComponent> = fixture.componentRef;
  ref.setInput('player', p);
  ref.setInput('ownerSide', side);
  fixture.detectChanges();
  return { component: fixture.componentInstance, fixture };
}

describe('ZoneRailComponent — off-battlefield zone cluster', () => {
  it('renders library, graveyard AND exile tiles for the player', () => {
    const p = player({
      id: 'me',
      name: 'Alice',
      library: { cards: [card('l1'), card('l2'), card('l3')] },
      graveyard: { cards: [card('g1')] },
      exile: { cards: [card('x1'), card('x2')] },
    });
    const { fixture } = mount(p, 'self');
    expect(fixture.nativeElement.querySelector('[data-testid="zone-pile-library-self"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="zone-pile-graveyard-self"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="zone-pile-exile-self"]')).not.toBeNull();
  });

  it('passes each zone its own card list (counts are independent)', () => {
    const p = player({
      id: 'me',
      name: 'Alice',
      library: { cards: [card('l1'), card('l2'), card('l3')] },
      graveyard: { cards: [card('g1')] },
      exile: { cards: [card('x1'), card('x2')] },
    });
    const { fixture } = mount(p, 'self');
    const countOf = (kind: ZoneKind) =>
      (fixture.nativeElement.querySelector(
        `[data-testid="zone-pile-${kind}-self"] [data-testid="zone-pile-count"]`,
      ) as HTMLElement).textContent?.trim();
    expect(countOf('library')).toBe('3');
    expect(countOf('graveyard')).toBe('1');
    expect(countOf('exile')).toBe('2');
  });

  it('re-emits browse("graveyard") when the graveyard tile is clicked', () => {
    const p = player({ id: 'me', name: 'Alice', graveyard: { cards: [card('g1')] } });
    const { component, fixture } = mount(p, 'self');
    const events: ZoneKind[] = [];
    component.browse.subscribe(k => events.push(k));
    (fixture.nativeElement.querySelector(
      '[data-testid="zone-pile-graveyard-self"]',
    ) as HTMLButtonElement).click();
    expect(events).toEqual(['graveyard']);
  });

  it('re-emits browse("exile") when the exile tile is clicked', () => {
    const p = player({ id: 'me', name: 'Alice', exile: { cards: [card('x1')] } });
    const { component, fixture } = mount(p, 'opponent');
    const events: ZoneKind[] = [];
    component.browse.subscribe(k => events.push(k));
    (fixture.nativeElement.querySelector(
      '[data-testid="zone-pile-exile-opponent"]',
    ) as HTMLButtonElement).click();
    expect(events).toEqual(['exile']);
  });

  it('does not emit when the (non-browsable) library tile is clicked', () => {
    const p = player({ id: 'me', name: 'Alice', library: { cards: [card('l1')] } });
    const { component, fixture } = mount(p, 'self');
    const events: ZoneKind[] = [];
    component.browse.subscribe(k => events.push(k));
    (fixture.nativeElement.querySelector(
      '[data-testid="zone-pile-library-self"]',
    ) as HTMLElement).click();
    expect(events).toEqual([]);
  });

  it('owner side drives the rail accent + testid (self vs opponent)', () => {
    const p = player({ id: 'opp', name: 'Bob' });
    const { fixture } = mount(p, 'opponent');
    const rail = fixture.nativeElement.querySelector('[data-testid="zone-rail-opponent"]') as HTMLElement;
    expect(rail).not.toBeNull();
    expect(rail.classList.contains('zone-rail--foe')).toBe(true);
  });

  it('renders nothing when there is no player', () => {
    const { fixture } = mount(null, 'self');
    expect(fixture.nativeElement.querySelector('.zone-rail')).toBeNull();
  });
});
