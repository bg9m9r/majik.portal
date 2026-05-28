import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComponentRef, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { BoardComponent } from './board.component';
import { CardViewComponent } from '../../../ui/card-view.component';
import {
  Ability,
  CardSnapshot,
  GamePlayer,
  GameState,
} from '../../../core/match/match.types';

// Regression coverage for the "Opp hand: 0" portal bug. The server now
// emits the opponent's hand as N "(hidden)" placeholder cards via the
// per-viewer mask in Majik.Core.Api.StateSnapshotter (CR 706). The
// board must:
//   1) render one face-down <app-card-view hidden="true" /> per
//      placeholder so the count is visually obvious; and
//   2) NEVER expose placeholder names/types in user-facing strings.

function hiddenCard(index: number): CardSnapshot {
  // Mirrors the wire shape of StateSnapshotter.HiddenZone — empty
  // mana cost, empty types, the literal "(hidden)" name, and a
  // synthetic instanceId so Angular's @for trackBy stays stable.
  return {
    instanceId: `hidden-${index}`,
    name: '(hidden)',
    manaCost: '',
    types: [],
    power: null,
    toughness: null,
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

function mountBoard(state: GameState, selfPlayerIds: string[]) {
  TestBed.configureTestingModule({ imports: [BoardComponent] });
  const fixture = TestBed.createComponent(BoardComponent);
  const ref: ComponentRef<BoardComponent> = fixture.componentRef;
  ref.setInput('state', state);
  ref.setInput('selfPlayerIds', selfPlayerIds);
  fixture.detectChanges();
  return { component: fixture.componentInstance, fixture };
}

describe('BoardComponent — opponent hand rendering', () => {
  it('renders one face-down card per server-emitted placeholder', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({
      id: 'opp',
      name: 'Bob',
      hand: { cards: [0, 1, 2, 3, 4, 5, 6].map(hiddenCard) },
    });
    const state: GameState = {
      phase: 'Main',
      turnNumber: 1,
      activePlayerId: 'me',
      players: [me, opp],
      stack: [],
      youPlayerId: null,
    };

    const { fixture } = mountBoard(state, ['me']);

    // Opponent hand row carries one card-view per placeholder.
    const oppHandRow = fixture.nativeElement.querySelector('.hand-row--opponent');
    expect(oppHandRow).toBeTruthy();

    // Query the actual CardViewComponent instances inside the opponent
    // hand row so we can probe the typed `hidden` input (the DOM-level
    // `ng-reflect-*` attribute is not emitted in test mode).
    const handCardDebugs: DebugElement[] = fixture.debugElement
      .queryAll(By.css('.hand-row--opponent app-card-view'));
    expect(handCardDebugs.length).toBe(7);

    handCardDebugs.forEach(d => {
      const card = d.componentInstance as CardViewComponent;
      expect(card.hidden()).toBe(true);
    });

    // Hidden-zone placeholders carry the literal name "(hidden)" on
    // the wire — that string must not bleed into the rendered DOM.
    expect(fixture.nativeElement.textContent).not.toContain('(hidden)');
  });

  it('shows "opponent hand empty" only when the opponent has zero cards', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' }); // empty hand
    const state: GameState = {
      phase: 'Main',
      turnNumber: 1,
      activePlayerId: 'me',
      players: [me, opp],
      stack: [],
      youPlayerId: null,
    };

    const { fixture } = mountBoard(state, ['me']);

    const oppHandRow = fixture.nativeElement.querySelector('.hand-row--opponent');
    expect(oppHandRow.textContent).toContain('opponent hand empty');
    expect(oppHandRow.querySelectorAll('app-card-view').length).toBe(0);
  });

  it('exposes opponent hand count to assistive tech via aria-label', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({
      id: 'opp',
      name: 'Bob',
      hand: { cards: [0, 1, 2, 3, 4].map(hiddenCard) },
    });
    const state: GameState = {
      phase: 'Main',
      turnNumber: 1,
      activePlayerId: 'me',
      players: [me, opp],
      stack: [],
      youPlayerId: null,
    };

    const { fixture } = mountBoard(state, ['me']);

    const oppHandRow = fixture.nativeElement.querySelector('.hand-row--opponent');
    expect(oppHandRow.getAttribute('aria-label')).toBe('opponent hand, 5 cards');
  });
});

describe('BoardComponent — stack viewer trigger highlight', () => {
  it('marks TriggeredAbility items with stack-item--trigger so the user notices them', () => {
    // Bug repro coverage: when an ETB trigger lands on the stack the
    // stack item needs a visible marker so the user sees it before any
    // auto-pass resolves it (the timing side of the fix lives in the
    // shouldAutoPass guard). This test pins the class name the stylesheet
    // hooks the amber pulse onto.
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'Main',
      turnNumber: 1,
      activePlayerId: 'me',
      players: [me, opp],
      stack: [
        { id: 's-trigger', kind: 'TriggeredAbility', description: 'ETB trigger' },
        { id: 's-spell', kind: 'Spell', description: 'Lightning Bolt' },
      ],
      youPlayerId: null,
    };

    const { fixture } = mountBoard(state, ['me']);

    const items: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.stack-item'),
    );
    expect(items.length).toBe(2);

    const trigger = items.find(el => el.getAttribute('data-stack-kind') === 'TriggeredAbility');
    const spell = items.find(el => el.getAttribute('data-stack-kind') === 'Spell');
    expect(trigger).toBeTruthy();
    expect(spell).toBeTruthy();
    expect(trigger!.classList.contains('stack-item--trigger')).toBe(true);
    expect(spell!.classList.contains('stack-item--trigger')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BoardComponent — onSelfBattlefieldDoubleClick: non-mana activated abilities
//
// Covers the Verdant Catacombs / fetchland use-case where a permanent has
// abilities[].kind === 'Activated' with a server-supplied id but an empty
// producedManaColors string.
// ---------------------------------------------------------------------------

function activatedAbility(id: string, description = 'Search your library'): Ability {
  return { kind: 'Activated', description, id };
}

function permanentCard(over: Partial<CardSnapshot> & Pick<CardSnapshot, 'instanceId'>): CardSnapshot {
  return {
    instanceId: over.instanceId,
    name: over.name ?? over.instanceId,
    manaCost: over.manaCost ?? '',
    types: over.types ?? ['Land'],
    power: null,
    toughness: null,
    tapped: over.tapped ?? false,
    summoningSickness: false,
    producedManaColors: over.producedManaColors ?? '',
    abilities: over.abilities,
  };
}

function mountBoardWithCard(card: CardSnapshot) {
  const me = {
    id: 'me',
    name: 'Alice',
    life: 20,
    mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
    hand: { cards: [] },
    library: { cards: [] },
    graveyard: { cards: [] },
    exile: { cards: [] },
    battlefield: { cards: [card] },
  };
  const opp = { ...me, id: 'opp', name: 'Bob', battlefield: { cards: [] } };
  const state: GameState = {
    phase: 'Main',
    turnNumber: 1,
    activePlayerId: 'me',
    players: [me, opp],
    stack: [],
    youPlayerId: null,
  };
  TestBed.configureTestingModule({ imports: [BoardComponent] });
  const fixture = TestBed.createComponent(BoardComponent);
  const ref: ComponentRef<BoardComponent> = fixture.componentRef;
  ref.setInput('state', state);
  ref.setInput('selfPlayerIds', ['me']);
  fixture.detectChanges();
  return { component: fixture.componentInstance, fixture };
}

describe('BoardComponent — onSelfBattlefieldDoubleClick: non-mana activated ability', () => {
  it('emits activateAbilityRequested (not activateManaRequested) for a non-mana permanent with an Activated ability id', () => {
    const card = permanentCard({
      instanceId: 'fetch-1',
      abilities: [activatedAbility('abil-1', '{T}, Pay 1 life, Sacrifice: search')],
    });
    const { component } = mountBoardWithCard(card);
    const activateAbilitySpy = vi.fn();
    const activateManaSpy = vi.fn();
    component.activateAbilityRequested.subscribe(activateAbilitySpy);
    component.activateManaRequested.subscribe(activateManaSpy);

    component.onSelfBattlefieldDoubleClick(card);

    expect(activateAbilitySpy).toHaveBeenCalledOnce();
    expect(activateAbilitySpy).toHaveBeenCalledWith({
      permanentInstanceId: 'fetch-1',
      abilityId: 'abil-1',
    });
    expect(activateManaSpy).not.toHaveBeenCalled();
  });

  it('emits activateManaRequested (not activateAbilityRequested) for a single-color mana producer', () => {
    const card = permanentCard({
      instanceId: 'forest-1',
      producedManaColors: 'G',
      abilities: [activatedAbility('abil-g', '{T}: Add {G}')],
    });
    const { component } = mountBoardWithCard(card);
    const activateAbilitySpy = vi.fn();
    const activateManaSpy = vi.fn();
    component.activateAbilityRequested.subscribe(activateAbilitySpy);
    component.activateManaRequested.subscribe(activateManaSpy);

    component.onSelfBattlefieldDoubleClick(card);

    expect(activateManaSpy).toHaveBeenCalledOnce();
    expect(activateManaSpy).toHaveBeenCalledWith({ card, color: 'G' });
    expect(activateAbilitySpy).not.toHaveBeenCalled();
  });

  it('is a no-op when the card is tapped (both paths suppressed)', () => {
    const card = permanentCard({
      instanceId: 'tapped-fetch',
      tapped: true,
      abilities: [activatedAbility('abil-1')],
    });
    const { component } = mountBoardWithCard(card);
    const activateAbilitySpy = vi.fn();
    const activateManaSpy = vi.fn();
    component.activateAbilityRequested.subscribe(activateAbilitySpy);
    component.activateManaRequested.subscribe(activateManaSpy);

    component.onSelfBattlefieldDoubleClick(card);

    expect(activateAbilitySpy).not.toHaveBeenCalled();
    expect(activateManaSpy).not.toHaveBeenCalled();
  });

  it('is a no-op for a card with no abilities and no mana colors', () => {
    const card = permanentCard({ instanceId: 'vanilla-1' }); // no abilities, no mana
    const { component } = mountBoardWithCard(card);
    const activateAbilitySpy = vi.fn();
    const activateManaSpy = vi.fn();
    component.activateAbilityRequested.subscribe(activateAbilitySpy);
    component.activateManaRequested.subscribe(activateManaSpy);

    component.onSelfBattlefieldDoubleClick(card);

    expect(activateAbilitySpy).not.toHaveBeenCalled();
    expect(activateManaSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when the Activated ability has a null id (core PR not yet deployed)', () => {
    const card = permanentCard({
      instanceId: 'fetch-no-id',
      abilities: [{ kind: 'Activated', description: 'search', id: null }],
    });
    const { component } = mountBoardWithCard(card);
    const activateAbilitySpy = vi.fn();
    component.activateAbilityRequested.subscribe(activateAbilitySpy);

    component.onSelfBattlefieldDoubleClick(card);

    expect(activateAbilitySpy).not.toHaveBeenCalled();
  });

  it('picks the first Activated ability with an id when multiple are present', () => {
    const card = permanentCard({
      instanceId: 'multi-ability',
      abilities: [
        { kind: 'Activated', description: 'first', id: 'id-first' },
        { kind: 'Activated', description: 'second', id: 'id-second' },
      ],
    });
    const { component } = mountBoardWithCard(card);
    const activateAbilitySpy = vi.fn();
    component.activateAbilityRequested.subscribe(activateAbilitySpy);

    component.onSelfBattlefieldDoubleClick(card);

    expect(activateAbilitySpy).toHaveBeenCalledOnce();
    expect(activateAbilitySpy).toHaveBeenCalledWith({
      permanentInstanceId: 'multi-ability',
      abilityId: 'id-first',
    });
  });
});
