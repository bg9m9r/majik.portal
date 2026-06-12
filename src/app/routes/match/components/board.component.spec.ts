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
    counters: over.counters,
  };
}

// A loyalty ability descriptor — kind 'Loyalty', signed-cost description
// (the engine renders minus with the U+2212 MINUS SIGN).
function loyaltyAbility(id: string, description: string): Ability {
  return { kind: 'Loyalty', description, id };
}

function mountBoardWithCard(
  card: CardSnapshot,
  prompt?: { expectedKinds?: string[]; description?: string } | null,
) {
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
  if (prompt !== undefined) ref.setInput('currentPrompt', prompt);
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

  it('emits activateAbilityRequested for a non-mana permanent in the backline utility bucket (Planeswalker)', () => {
    // Regression coverage for the zoned-layout refactor: an Activated
    // ability on a non-creature non-land permanent (here a
    // planeswalker) lives in .backline__utility, not .frontline. The
    // (cardDoubleClick) handler must still fire from that zone — the
    // template wires onSelfBattlefieldDoubleClick on every bucket.
    const card = permanentCard({
      instanceId: 'pw-1',
      types: ['Planeswalker'],
      abilities: [activatedAbility('pw-loyal-1', '+1: scry 1')],
    });
    const { component } = mountBoardWithCard(card);
    const activateAbilitySpy = vi.fn();
    component.activateAbilityRequested.subscribe(activateAbilitySpy);

    component.onSelfBattlefieldDoubleClick(card);

    expect(activateAbilitySpy).toHaveBeenCalledOnce();
    expect(activateAbilitySpy).toHaveBeenCalledWith({
      permanentInstanceId: 'pw-1',
      abilityId: 'pw-loyal-1',
    });
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

// ---------------------------------------------------------------------------
// BoardComponent — context-menu "Activate ability" entries
//
// Users intuitively right-click a permanent (e.g. Misty Rainforest)
// expecting an Activate entry; the original menu offered only tap /
// details / scryfall and "tap" was visual-only, so the user fell into a
// dead end. Fix: when the right-clicked card is a SELF-owned permanent
// with one or more activated abilities (kind === 'Activated' + non-null
// id), surface one menu entry per ability. Clicking dispatches the same
// activateAbilityRequested output the double-click path uses, so the
// page-level translation is identical.
//
// Opponent permanents and cards with no activated abilities get NO
// Activate entries. The double-click path is unchanged (covered by the
// parallel describe block above).
// ---------------------------------------------------------------------------
describe('BoardComponent — context-menu activate entries', () => {
  it('exposes one ActivatableAbility per self-owned activated ability with an id', () => {
    const card = permanentCard({
      instanceId: 'fetch-1',
      abilities: [activatedAbility('abil-1', '{T}, Pay 1 life, Sacrifice: search')],
    });
    const { component } = mountBoardWithCard(card);

    component.onContextMenu(
      new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      card,
      'self',
    );

    const abilities = component.activeContextActivatableAbilities();
    expect(abilities).toEqual([
      { id: 'abil-1', description: '{T}, Pay 1 life, Sacrifice: search', kind: 'activated' },
    ]);
  });

  it('exposes one ActivatableAbility per ability for a multi-ability permanent', () => {
    const card = permanentCard({
      instanceId: 'pw-1',
      types: ['Planeswalker'],
      abilities: [
        { kind: 'Activated', description: '+1: scry', id: 'pw-1-plus' },
        { kind: 'Activated', description: '-3: bolt', id: 'pw-1-minus' },
      ],
    });
    const { component } = mountBoardWithCard(card);

    component.onContextMenu(
      new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      card,
      'self',
    );

    const abilities = component.activeContextActivatableAbilities();
    expect(abilities).toEqual([
      { id: 'pw-1-plus', description: '+1: scry', kind: 'activated' },
      { id: 'pw-1-minus', description: '-3: bolt', kind: 'activated' },
    ]);
  });

  it('exposes no Activate entries for a self-owned card with no activated abilities', () => {
    const card = permanentCard({ instanceId: 'vanilla' }); // no abilities
    const { component } = mountBoardWithCard(card);

    component.onContextMenu(
      new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      card,
      'self',
    );

    expect(component.activeContextActivatableAbilities()).toEqual([]);
  });

  it('exposes no Activate entries for an opponent permanent (even if it has activated abilities)', () => {
    const card = permanentCard({
      instanceId: 'opp-fetch',
      abilities: [activatedAbility('opp-abil', 'search')],
    });
    const { component } = mountBoardWithCard(card);

    component.onContextMenu(
      new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      card,
      'opponent',
    );

    expect(component.activeContextActivatableAbilities()).toEqual([]);
  });

  it('excludes activated abilities whose id is null (older server build)', () => {
    const card = permanentCard({
      instanceId: 'fetch-no-id',
      abilities: [
        { kind: 'Activated', description: 'search', id: null },
        { kind: 'Activated', description: 'sac', id: 'abil-with-id' },
      ],
    });
    const { component } = mountBoardWithCard(card);

    component.onContextMenu(
      new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      card,
      'self',
    );

    expect(component.activeContextActivatableAbilities()).toEqual([
      { id: 'abil-with-id', description: 'sac', kind: 'activated' },
    ]);
  });

  it('emits activateAbilityRequested with the permanent instanceId + ability id when an Activate entry fires', () => {
    const card = permanentCard({
      instanceId: 'fetch-1',
      abilities: [activatedAbility('abil-1', 'search')],
    });
    const { component } = mountBoardWithCard(card);
    component.onContextMenu(
      new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      card,
      'self',
    );
    const activateSpy = vi.fn();
    component.activateAbilityRequested.subscribe(activateSpy);

    component.onContextActivateAbility({ id: 'abil-1', description: 'search', kind: 'activated' });

    expect(activateSpy).toHaveBeenCalledOnce();
    expect(activateSpy).toHaveBeenCalledWith({
      permanentInstanceId: 'fetch-1',
      abilityId: 'abil-1',
    });
  });

  it('renders the Activate entry inside the rendered <app-card-context-menu>', () => {
    const card = permanentCard({
      instanceId: 'fetch-1',
      abilities: [activatedAbility('abil-1', 'search your library')],
    });
    const { component, fixture } = mountBoardWithCard(card);

    component.onContextMenu(
      new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      card,
      'self',
    );
    fixture.detectChanges();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('app-card-context-menu button'),
    ) as HTMLButtonElement[];
    const labels = buttons.map(b => b.textContent?.trim());
    expect(labels).toContain('Activate search your library');
  });
});

// ---------------------------------------------------------------------------
// BoardComponent — planeswalkers: no Tap, loyalty abilities in context menu
//
// (b) A planeswalker (CR 306) does not tap to any purpose, so the
//     context menu must NOT offer Tap / Untap on one — canTapActiveContext
//     gates on (owner === self AND !isPlaneswalker).
// (c) Loyalty abilities (engine PR #2585: AbilityDto kind === 'Loyalty',
//     signed-cost description) surface as Activate entries, but only when
//     the current prompt advertises the loyalty-activation kind AND the
//     player can afford a −N ability (current loyalty ≥ N from the
//     "Loyalty" counter). Selecting one emits activateLoyaltyAbilityRequested.
// ---------------------------------------------------------------------------
const LOYALTY_PROMPT = { expectedKinds: ['activateLoyaltyAbility'] };

describe('BoardComponent — planeswalker: no Tap entry', () => {
  it('canTapActiveContext is false for a self-owned planeswalker', () => {
    const pw = permanentCard({
      instanceId: 'grist-1',
      types: ['Planeswalker'],
      counters: { Loyalty: 3 },
    });
    const { component } = mountBoardWithCard(pw);
    component.onContextMenu(
      new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      pw,
      'self',
    );
    expect(component.canTapActiveContext()).toBe(false);
  });

  it('canTapActiveContext stays true for a self-owned non-planeswalker permanent', () => {
    const land = permanentCard({ instanceId: 'forest-1', types: ['Land'] });
    const { component } = mountBoardWithCard(land);
    component.onContextMenu(
      new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      land,
      'self',
    );
    expect(component.canTapActiveContext()).toBe(true);
  });

  it('does NOT render a Tap / Untap entry for a planeswalker context menu', () => {
    const pw = permanentCard({
      instanceId: 'grist-1',
      types: ['Planeswalker'],
      counters: { Loyalty: 3 },
    });
    const { component, fixture } = mountBoardWithCard(pw);
    component.onContextMenu(
      new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      pw,
      'self',
    );
    fixture.detectChanges();
    const labels = (Array.from(
      fixture.nativeElement.querySelectorAll('app-card-context-menu button'),
    ) as HTMLButtonElement[]).map(b => b.textContent?.trim());
    expect(labels).not.toContain('Tap / Untap');
  });
});

describe('BoardComponent — planeswalker loyalty abilities in context menu', () => {
  function grist(counters: Record<string, number> = { Loyalty: 3 }): CardSnapshot {
    return permanentCard({
      instanceId: 'grist-1',
      name: 'Grist, the Hunger Tide',
      types: ['Legendary', 'Planeswalker'],
      counters,
      abilities: [
        loyaltyAbility('grist-plus', '+1'),
        loyaltyAbility('grist-minus2', '−2'),
        loyaltyAbility('grist-minus5', '−5'),
      ],
    });
  }

  it('lists all affordable loyalty abilities when the prompt advertises the loyalty kind', () => {
    const pw = grist({ Loyalty: 3 });
    const { component } = mountBoardWithCard(pw, LOYALTY_PROMPT);
    component.onContextMenu(
      new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      pw,
      'self',
    );
    // Loyalty 3: +1 (always), −2 (3 ≥ 2) shown; −5 (3 < 5) hidden.
    expect(component.activeContextActivatableAbilities()).toEqual([
      { id: 'grist-plus', description: '+1', kind: 'loyalty' },
      { id: 'grist-minus2', description: '−2', kind: 'loyalty' },
    ]);
  });

  it('does NOT offer a −N ability the player cannot afford', () => {
    const pw = grist({ Loyalty: 1 });
    const { component } = mountBoardWithCard(pw, LOYALTY_PROMPT);
    component.onContextMenu(
      new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      pw,
      'self',
    );
    // Loyalty 1: only +1 affordable; both minus abilities hidden.
    expect(component.activeContextActivatableAbilities()).toEqual([
      { id: 'grist-plus', description: '+1', kind: 'loyalty' },
    ]);
  });

  it('offers NO loyalty abilities when the prompt does not advertise the loyalty kind', () => {
    const pw = grist({ Loyalty: 3 });
    const { component } = mountBoardWithCard(pw, { expectedKinds: ['none'] });
    component.onContextMenu(
      new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      pw,
      'self',
    );
    expect(component.activeContextActivatableAbilities()).toEqual([]);
  });

  it('emits activateLoyaltyAbilityRequested (not activateAbilityRequested) when a loyalty entry fires', () => {
    const pw = grist({ Loyalty: 3 });
    const { component } = mountBoardWithCard(pw, LOYALTY_PROMPT);
    component.onContextMenu(
      new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      pw,
      'self',
    );
    const loyaltySpy = vi.fn();
    const activatedSpy = vi.fn();
    component.activateLoyaltyAbilityRequested.subscribe(loyaltySpy);
    component.activateAbilityRequested.subscribe(activatedSpy);

    component.onContextActivateAbility({ id: 'grist-minus2', description: '−2', kind: 'loyalty' });

    expect(loyaltySpy).toHaveBeenCalledOnce();
    expect(loyaltySpy).toHaveBeenCalledWith({
      permanentInstanceId: 'grist-1',
      loyaltyAbilityId: 'grist-minus2',
    });
    expect(activatedSpy).not.toHaveBeenCalled();
  });

  it('renders the loyalty abilities as Activate entries in the menu (but no Tap)', () => {
    const pw = grist({ Loyalty: 5 });
    const { component, fixture } = mountBoardWithCard(pw, LOYALTY_PROMPT);
    component.onContextMenu(
      new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      pw,
      'self',
    );
    fixture.detectChanges();
    const labels = (Array.from(
      fixture.nativeElement.querySelectorAll('app-card-context-menu button'),
    ) as HTMLButtonElement[]).map(b => b.textContent?.trim());
    expect(labels).toContain('Activate +1');
    expect(labels).toContain('Activate −2');
    expect(labels).toContain('Activate −5'); // loyalty 5 affords −5
    expect(labels).not.toContain('Tap / Untap');
  });
});

// ---------------------------------------------------------------------------
// BoardComponent — zoned battlefield layout
//
// Frontline (creatures, incl. tokens + Artifact-/Enchantment-Creatures) sits
// adjacent to the centerline. Backline splits lands LEFT / artifacts+
// enchantments+planeswalkers RIGHT. Opp side is a vertical flip of self.
// The whose-turn rim moves to the .battlefield wrapper so it encompasses
// both rows together.
// ---------------------------------------------------------------------------

function permanent(instanceId: string, types: string[], over: Partial<CardSnapshot> = {}): CardSnapshot {
  return {
    instanceId,
    name: over.name ?? instanceId,
    manaCost: over.manaCost ?? '',
    types,
    power: over.power ?? null,
    toughness: over.toughness ?? null,
    tapped: over.tapped ?? false,
    summoningSickness: false,
    producedManaColors: over.producedManaColors ?? '',
    abilities: over.abilities,
  };
}

function mountBoardWithBattlefields(
  selfCards: CardSnapshot[],
  oppCards: CardSnapshot[],
  opts: { activePlayerId?: string } = {},
) {
  const me = player({
    id: 'me',
    name: 'Alice',
    battlefield: { cards: selfCards },
  });
  const opp = player({
    id: 'opp',
    name: 'Bob',
    battlefield: { cards: oppCards },
  });
  const state: GameState = {
    phase: 'Main',
    turnNumber: 1,
    activePlayerId: opts.activePlayerId ?? 'me',
    players: [me, opp],
    stack: [],
    youPlayerId: null,
  };
  return mountBoard(state, ['me']);
}

describe('BoardComponent — zoned battlefield layout', () => {
  it('routes each card to its bucketed zone (self side)', () => {
    const creature = permanent('cr-1', ['Creature']);
    const land = permanent('ld-1', ['Land']);
    const artifact = permanent('art-1', ['Artifact']);
    const enchant = permanent('enc-1', ['Enchantment']);
    const pw = permanent('pw-1', ['Planeswalker']);
    const artCreature = permanent('ac-1', ['Artifact', 'Creature']);
    const { fixture } = mountBoardWithBattlefields(
      [creature, land, artifact, enchant, pw, artCreature],
      [],
    );

    const selfBattlefield = fixture.nativeElement.querySelector(
      '.arena-side--self .battlefield',
    ) as HTMLElement;
    expect(selfBattlefield).toBeTruthy();

    const frontIds = Array.from(
      selfBattlefield.querySelectorAll<HTMLElement>('.frontline [data-card-id]'),
    ).map(el => el.dataset['cardId']);
    const landIds = Array.from(
      selfBattlefield.querySelectorAll<HTMLElement>('.backline__lands [data-card-id]'),
    ).map(el => el.dataset['cardId']);
    const utilIds = Array.from(
      selfBattlefield.querySelectorAll<HTMLElement>('.backline__utility [data-card-id]'),
    ).map(el => el.dataset['cardId']);

    expect(frontIds.sort((a, b) => (a ?? '').localeCompare(b ?? ''))).toEqual(['ac-1', 'cr-1']);
    expect(landIds).toEqual(['ld-1']);
    expect(utilIds.sort((a, b) => (a ?? '').localeCompare(b ?? ''))).toEqual(['art-1', 'enc-1', 'pw-1']);
  });

  it('renders empty zones gracefully — placeholder shows for a fully-empty side', () => {
    const { fixture } = mountBoardWithBattlefields([], []);
    const selfBattlefield = fixture.nativeElement.querySelector(
      '.arena-side--self .battlefield',
    ) as HTMLElement;
    expect(selfBattlefield).toBeTruthy();
    expect(selfBattlefield.textContent).toContain('your battlefield empty');

    const oppBattlefield = fixture.nativeElement.querySelector(
      '.arena-side--foe .battlefield',
    ) as HTMLElement;
    expect(oppBattlefield.textContent).toContain('opponent battlefield empty');
  });

  it('places .frontline before .backline in self side, and .backline before .frontline on opp side (vertical mirror)', () => {
    const selfCreature = permanent('s-c', ['Creature']);
    const selfLand = permanent('s-l', ['Land']);
    const oppCreature = permanent('o-c', ['Creature']);
    const oppLand = permanent('o-l', ['Land']);
    const { fixture } = mountBoardWithBattlefields(
      [selfCreature, selfLand],
      [oppCreature, oppLand],
    );

    const selfBattlefield = fixture.nativeElement.querySelector(
      '.arena-side--self .battlefield',
    ) as HTMLElement;
    const oppBattlefield = fixture.nativeElement.querySelector(
      '.arena-side--foe .battlefield',
    ) as HTMLElement;
    expect(selfBattlefield).toBeTruthy();
    expect(oppBattlefield).toBeTruthy();

    // Direct children — first child = closer to the top of that side.
    const selfChildren = Array.from(selfBattlefield.children).filter(
      el => el.classList.contains('frontline') || el.classList.contains('backline'),
    );
    const oppChildren = Array.from(oppBattlefield.children).filter(
      el => el.classList.contains('frontline') || el.classList.contains('backline'),
    );

    expect(selfChildren[0].classList.contains('frontline')).toBe(true);
    expect(selfChildren[1].classList.contains('backline')).toBe(true);
    // Opp = vertical flip: backline ON TOP, frontline ON BOTTOM.
    expect(oppChildren[0].classList.contains('backline')).toBe(true);
    expect(oppChildren[1].classList.contains('frontline')).toBe(true);
  });

  it('wraps both rows in the active-side rim (rim is on .battlefield, not per-row)', () => {
    const { fixture } = mountBoardWithBattlefields(
      [permanent('c', ['Creature']), permanent('l', ['Land'])],
      [],
      { activePlayerId: 'me' },
    );
    const selfBattlefield = fixture.nativeElement.querySelector(
      '.arena-side--self .battlefield',
    ) as HTMLElement;
    expect(selfBattlefield.classList.contains('battlefield--active-self')).toBe(true);
    // Inner rows must NOT carry the per-row rim class anymore.
    const frontline = selfBattlefield.querySelector('.frontline') as HTMLElement;
    const backline = selfBattlefield.querySelector('.backline') as HTMLElement;
    expect(frontline?.classList.contains('battlefield-row--active-self')).toBe(false);
    expect(backline?.classList.contains('battlefield-row--active-self')).toBe(false);
  });

  it('keeps a single self-battlefield droplist that wraps the whole zoned region', () => {
    const { fixture } = mountBoardWithBattlefields([permanent('c', ['Creature'])], []);
    const droplists = fixture.nativeElement.querySelectorAll('#self-battlefield-droplist');
    expect(droplists.length).toBe(1);
    // The single droplist is the .battlefield wrapper itself — its
    // inner .frontline / .backline don't open new droplists.
    expect(droplists[0].classList.contains('battlefield')).toBe(true);
  });

  it('still emits cardDoubleClick when activating a creature in the frontline', () => {
    const creature = permanent('cr-mana', ['Creature'], { producedManaColors: 'G' });
    const { fixture, component } = mountBoardWithBattlefields([creature], []);
    const activateManaSpy = vi.fn();
    component.activateManaRequested.subscribe(activateManaSpy);

    // The creature is rendered inside .frontline — locate the card and
    // dispatch the same dblclick event that <app-card-view> would emit.
    const frontlineCard = fixture.nativeElement.querySelector(
      '.arena-side--self .frontline [data-card-id="cr-mana"]',
    ) as HTMLElement;
    expect(frontlineCard).toBeTruthy();

    // Use the component-level method directly (same wiring used by all
    // four buckets) — keeps the assertion focused on the event path,
    // not on simulating dblclick through Angular's event harness.
    component.onSelfBattlefieldDoubleClick(creature);
    expect(activateManaSpy).toHaveBeenCalledWith({ card: creature, color: 'G' });
  });
});

// ---------------------------------------------------------------------------
// BoardComponent — self-side DOM ordering & host display.
//
// Regression coverage for the zoned-battlefield layout collapse: when the
// host element renders as `display: inline` (Angular default), the inner
// `flex: 1 1 0; min-height: 0` chain (board-arena → arena-side →
// battlefield) collapses to 0 because there is no height propagating
// down from the section parent. The arena-sides then become 0-tall, the
// inner HUD / hand / battlefield content overflows on top of each
// other, and the self hand renders at the TOP overlapping the opponent
// HUD + stack chip.
//
// The fix is a host `display: flex; flex: 1 1 0; min-height: 0;
// flex-direction: column` so the section's `flex-1` actually applies
// and the inner column-flex chain has a bounded height to divvy up.
//
// We also lock the self-side DOM order (battlefield ABOVE hand-row
// ABOVE arena-strip--self) so a future refactor can't silently send
// the strip back to the top of the side, and we lock the self hand-row
// to face-UP card-view (no `[hidden]`).
// ---------------------------------------------------------------------------
describe('BoardComponent — self-side ordering + host display (zoned layout)', () => {
  it('orders the self side as battlefield → hand-row → arena-strip--self (top → bottom)', () => {
    const { fixture } = mountBoardWithBattlefields([], []);
    const selfSide = fixture.nativeElement.querySelector(
      '.arena-side--self',
    ) as HTMLElement;
    expect(selfSide).toBeTruthy();

    // Filter to the structural anchors only — drag-drop / animate
    // wrappers can inject siblings we don't care about.
    const anchors = Array.from(selfSide.children).filter(el =>
      el.classList.contains('battlefield') ||
      el.classList.contains('hand-row') ||
      el.classList.contains('arena-strip'),
    );
    expect(anchors.length).toBe(3);
    expect(anchors[0].classList.contains('battlefield')).toBe(true);
    expect(anchors[1].classList.contains('hand-row')).toBe(true);
    expect(anchors[2].classList.contains('arena-strip--self')).toBe(true);
  });

  it('renders the self hand-row face-UP (no [hidden] on its app-card-view children)', () => {
    const handCard = permanentCard({
      instanceId: 'forest-hand',
      name: 'Forest',
      types: ['Land'],
    });
    const me: GamePlayer = {
      id: 'me',
      name: 'Alice',
      life: 20,
      mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
      hand: { cards: [handCard] },
      library: { cards: [] },
      graveyard: { cards: [] },
      exile: { cards: [] },
      battlefield: { cards: [] },
    };
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'Main',
      turnNumber: 1,
      activePlayerId: 'me',
      players: [me, opp],
      stack: [],
      youPlayerId: null,
    };
    const { fixture } = mountBoard(state, ['me']);

    // The self hand-row is the cdkDropList one — `.hand-row` without
    // the `--opponent` modifier. Its card-view children must NOT be
    // face-down (`hidden=true` is reserved for the opponent strip).
    const selfHand = Array.from(
      fixture.nativeElement.querySelectorAll('.arena-side--self .hand-row'),
    ).find(el => !(el as HTMLElement).classList.contains('hand-row--opponent')) as
      HTMLElement | undefined;
    expect(selfHand).toBeTruthy();

    const handCardDebugs: DebugElement[] = fixture.debugElement
      .queryAll(By.css('.arena-side--self .hand-row:not(.hand-row--opponent) app-card-view'));
    expect(handCardDebugs.length).toBe(1);
    handCardDebugs.forEach(d => {
      const cv = d.componentInstance as CardViewComponent;
      expect(cv.hidden()).toBe(false);
    });
  });

  it('sets the host to a column flex item so the inner flex-1 chain has a constrained height to divvy up', () => {
    // Without a proper host display the `<section class="flex-1">`
    // wrapper in match.ts has no flex child to grow into, the
    // .board-arena collapses to content-height, and the two
    // .arena-side { flex: 1 1 0; min-height: 0 } items collapse to 0
    // — pushing all inner HUD / hand / battlefield content into an
    // overlapping pile at the top of the page. Lock the host shape
    // so a future refactor can't silently reintroduce the regression.
    const { fixture } = mountBoardWithBattlefields([], []);
    const host = fixture.nativeElement as HTMLElement;
    const style = window.getComputedStyle(host);
    // jsdom doesn't fully resolve the `flex` shorthand into its
    // grow/shrink/basis longhands, so we lock the two properties that
    // actually swap the host out of `display: inline` (the default for
    // unknown elements) and put it into a column-flex shape. The
    // accompanying `flex: 1 1 0; min-height: 0` declarations are
    // pinned in the inline source by board.component.ts's `styles:`
    // block and exercised end-to-end at build + visual-inspect time.
    expect(style.display).toBe('flex');
    expect(style.flexDirection).toBe('column');
  });
});

// ---------------------------------------------------------------------------
// BoardComponent — symmetric non-battlefield footprint across the two sides
//
// Regression coverage for the "self battlefield visibly shorter than opp"
// layout bug. Each arena-side is flex: 1 1 0, but the inner stack ABOVE the
// centerline used to be asymmetric: opp = one .arena-strip (HUD + mana +
// shrunk hand), self = (.hand-row full-size) + (.arena-strip--self HUD +
// mana). Net opp-non-bf < self-non-bf, so opp .battlefield got more
// vertical space and the self board looked clipped.
//
// The fix locks the three non-battlefield elements to fixed heights:
//   opp .arena-strip height == self .hand-row height + self .arena-strip--self height
// so each side's .battlefield consumes the same remaining flex space.
//
// These layout rules live in board.component.ts's inline `styles:` block
// so jsdom can resolve them in unit tests. The card and spacing tokens
// come from styles/tokens.scss which is NOT loaded in unit tests; the
// component falls back to defaults via var(name, default) so the math
// resolves predictably here.
// ---------------------------------------------------------------------------
describe('BoardComponent — equal arena-strip footprint across both sides', () => {
  // tokens.scss isn't loaded in unit tests, so the component uses the
  // var(name, default) fallback literals (140px card-h, 8px space-2)
  // when computing arena-strip heights. Mirror that math here.
  const HAND_H = 140 + 8 * 2;        // = 156px
  const INFO_H = 8 * 4;              // = 32px
  const STRIP_H = HAND_H + INFO_H;   // = 188px

  it('locks the opp .arena-strip to a fixed height equal to self hand-row + arena-strip--self', () => {
    const { fixture } = mountBoardWithBattlefields([], []);
    const oppStrip = fixture.nativeElement.querySelector(
      '.arena-side--foe .arena-strip',
    ) as HTMLElement;
    expect(oppStrip).toBeTruthy();
    const style = window.getComputedStyle(oppStrip);
    expect(style.minHeight).toBe(`${STRIP_H}px`);
    expect(style.maxHeight).toBe(`${STRIP_H}px`);
    expect(style.flexBasis).toBe(`${STRIP_H}px`);
  });

  it('locks the self .hand-row to the full-size hand-card-row height', () => {
    const { fixture } = mountBoardWithBattlefields([], []);
    const selfHandRow = Array.from(
      fixture.nativeElement.querySelectorAll('.arena-side--self > .hand-row'),
    ).find(el => !(el as HTMLElement).classList.contains('hand-row--opponent')) as
      HTMLElement | undefined;
    expect(selfHandRow).toBeTruthy();
    const style = window.getComputedStyle(selfHandRow!);
    expect(style.minHeight).toBe(`${HAND_H}px`);
    expect(style.maxHeight).toBe(`${HAND_H}px`);
    expect(style.flexBasis).toBe(`${HAND_H}px`);
  });

  it('locks the self .arena-strip--self (HUD + mana) to the small info-row height', () => {
    const { fixture } = mountBoardWithBattlefields([], []);
    const selfStrip = fixture.nativeElement.querySelector(
      '.arena-side--self > .arena-strip--self',
    ) as HTMLElement;
    expect(selfStrip).toBeTruthy();
    const style = window.getComputedStyle(selfStrip);
    expect(style.minHeight).toBe(`${INFO_H}px`);
    expect(style.maxHeight).toBe(`${INFO_H}px`);
    expect(style.flexBasis).toBe(`${INFO_H}px`);
  });

  it('makes opp .arena-strip height === self .hand-row height + self .arena-strip--self height (the equalization invariant)', () => {
    const { fixture } = mountBoardWithBattlefields([], []);
    const oppStrip = fixture.nativeElement.querySelector(
      '.arena-side--foe .arena-strip',
    ) as HTMLElement;
    const selfHandRow = Array.from(
      fixture.nativeElement.querySelectorAll('.arena-side--self > .hand-row'),
    ).find(el => !(el as HTMLElement).classList.contains('hand-row--opponent')) as
      HTMLElement | undefined;
    const selfStrip = fixture.nativeElement.querySelector(
      '.arena-side--self > .arena-strip--self',
    ) as HTMLElement;

    const oppH = parseInt(window.getComputedStyle(oppStrip).flexBasis, 10);
    const selfHandH = parseInt(window.getComputedStyle(selfHandRow!).flexBasis, 10);
    const selfStripH = parseInt(window.getComputedStyle(selfStrip).flexBasis, 10);

    expect(oppH).toBe(selfHandH + selfStripH);
    // Both .battlefield wrappers are flex: 1 1 0 inside their arena-side
    // (also flex: 1 1 0 of the board area), so equal non-bf footprint
    // implies equal battlefield height.
  });
});

describe('BoardComponent — stack chip auto-expand', () => {
  it('AUTO-EXPANDS the chip whenever the stack is non-empty (a cast is not hidden)', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'Main',
      turnNumber: 1,
      activePlayerId: 'me',
      players: [me, opp],
      stack: [
        { id: 's-spell', kind: 'Spell', description: 'Lightning Bolt' },
      ],
      youPlayerId: null,
    };
    const { fixture, component } = mountBoard(state, ['me']);

    const chip = fixture.nativeElement.querySelector('.stack-chip') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.classList.contains('stack-chip--populated')).toBe(true);
    // Non-empty stack ⇒ open by default so the spell is visible.
    const toggle = chip.querySelector('.stack-chip__toggle') as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(component.stackExpanded()).toBe(true);

    // User can still manually collapse it; the override holds.
    component.toggleStack();
    fixture.detectChanges();
    expect(component.stackExpanded()).toBe(false);
    expect(
      (fixture.nativeElement.querySelector('.stack-chip__toggle') as HTMLElement)
        .getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('stays collapsed when the stack is EMPTY (reclaims battlefield space)', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'Main',
      turnNumber: 1,
      activePlayerId: 'me',
      players: [me, opp],
      stack: [],
      youPlayerId: null,
    };
    const { fixture, component } = mountBoard(state, ['me']);

    expect(component.stackExpanded()).toBe(false);
    const toggle = fixture.nativeElement.querySelector('.stack-chip__toggle') as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});

// Pass-priority button gate. match.ts forwards `currentPrompt` only
// when a prompt is addressed to THIS viewer, so within the board a
// non-null prompt already means "the engine awaits me". The Pass
// button must be ENABLED only during a genuine priority window
// (expectedKinds advertises PassPriorityCommand) and DISABLED for
// non-priority sub-prompts (target/surveil/yes-no/etc.) and when no
// prompt is pending.
describe('BoardComponent — Pass-priority button gate', () => {
  function mountWithPrompt(prompt: { expectedKinds?: string[]; description?: string } | null) {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'PreCombatMain', turnNumber: 1, activePlayerId: 'me',
      players: [me, opp], stack: [], youPlayerId: 'me',
    };
    TestBed.configureTestingModule({ imports: [BoardComponent] });
    const fixture = TestBed.createComponent(BoardComponent);
    const ref: ComponentRef<BoardComponent> = fixture.componentRef;
    ref.setInput('state', state);
    ref.setInput('selfPlayerIds', ['me']);
    ref.setInput('currentPrompt', prompt);
    fixture.detectChanges();
    return fixture;
  }

  function passButton(fixture: ReturnType<typeof mountWithPrompt>): HTMLButtonElement {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const btn = buttons.find(b => b.textContent?.includes('Pass priority'));
    if (!btn) throw new Error('Pass priority button not found');
    return btn;
  }

  it('ENABLED for a priority window [Pass, PlayLand, CastSpell]', () => {
    const fixture = mountWithPrompt({
      expectedKinds: ['PassPriorityCommand', 'PlayLandCommand', 'CastSpellCommand'],
    });
    expect(fixture.componentInstance.canPass()).toBe(true);
    expect(passButton(fixture).disabled).toBe(false);
  });

  it('ENABLED for a pass-only priority prompt', () => {
    const fixture = mountWithPrompt({ expectedKinds: ['PassPriorityCommand'] });
    expect(fixture.componentInstance.canPass()).toBe(true);
    expect(passButton(fixture).disabled).toBe(false);
  });

  it('DISABLED when no prompt is pending (opponent window / between turns / engine resolving)', () => {
    const fixture = mountWithPrompt(null);
    expect(fixture.componentInstance.canPass()).toBe(false);
    expect(passButton(fixture).disabled).toBe(true);
  });

  it('DISABLED during a target sub-prompt (own UI; Pass is not the action)', () => {
    const fixture = mountWithPrompt({ expectedKinds: ['ChooseTargetsCommand'] });
    expect(fixture.componentInstance.canPass()).toBe(false);
    expect(passButton(fixture).disabled).toBe(true);
  });

  it.each([
    'ChooseSurveilCommand',
    'ChooseYesNoCommand',
    'MulliganCommand',
  ])('DISABLED during a %s sub-prompt', (kind) => {
    const fixture = mountWithPrompt({ expectedKinds: [kind] });
    expect(fixture.componentInstance.canPass()).toBe(false);
    expect(passButton(fixture).disabled).toBe(true);
  });
});

// =============================================================
// Stack visibility — the prominent "a spell is on the stack and the
// engine is waiting on YOU" callout + opponent-object highlighting.
// The callout reuses the same priority gate as the Pass button (#123):
// a non-null currentPrompt advertising PassPriorityCommand means the
// engine awaits THIS viewer. It must appear ONLY when there's also at
// least one object on the stack.
// =============================================================
describe('BoardComponent — stack priority callout', () => {
  function mountStack(opts: {
    stack: GameState['stack'];
    prompt: { expectedKinds?: string[]; description?: string } | null;
    youPlayerId?: string | null;
  }) {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'PreCombatMain',
      turnNumber: 1,
      activePlayerId: 'opp',
      players: [me, opp],
      stack: opts.stack,
      youPlayerId: opts.youPlayerId ?? 'me',
    };
    TestBed.configureTestingModule({ imports: [BoardComponent] });
    const fixture = TestBed.createComponent(BoardComponent);
    const ref: ComponentRef<BoardComponent> = fixture.componentRef;
    ref.setInput('state', state);
    ref.setInput('selfPlayerIds', ['me']);
    ref.setInput('currentPrompt', opts.prompt);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  }

  const priorityPrompt = { expectedKinds: ['PassPriorityCommand'] };

  it('shows the callout when the OPPONENT cast a spell and it is my priority window', () => {
    const { fixture, component } = mountStack({
      stack: [
        { id: 's-bolt', kind: 'Spell', description: 'Lightning Bolt', controllerId: 'opp', cardName: 'Lightning Bolt' },
      ],
      prompt: priorityPrompt,
    });

    const callout = fixture.nativeElement.querySelector('.stack-callout') as HTMLElement;
    expect(callout).toBeTruthy();
    expect(callout.getAttribute('aria-live')).toBe('assertive');
    // Opponent-controlled ⇒ louder foe variant + names the spell + caster.
    expect(callout.classList.contains('stack-callout--opponent')).toBe(true);
    expect(callout.textContent).toContain('Lightning Bolt');
    expect(callout.textContent).toContain('Bob');
    expect(component.stackPriorityCallout()?.opponent).toBe(true);
  });

  it('shows a calmer (non-opponent) callout when only MY own object is on the stack', () => {
    const { fixture, component } = mountStack({
      stack: [
        { id: 's-mine', kind: 'Spell', description: 'Opt', controllerId: 'me', cardName: 'Opt' },
      ],
      prompt: priorityPrompt,
    });

    const callout = fixture.nativeElement.querySelector('.stack-callout') as HTMLElement;
    expect(callout).toBeTruthy();
    expect(callout.classList.contains('stack-callout--opponent')).toBe(false);
    expect(component.stackPriorityCallout()?.opponent).toBe(false);
  });

  it('does NOT show the callout when the stack is EMPTY (even with my priority)', () => {
    const { fixture, component } = mountStack({ stack: [], prompt: priorityPrompt });
    expect(fixture.nativeElement.querySelector('.stack-callout')).toBeNull();
    expect(component.stackPriorityCallout()).toBeNull();
  });

  it('does NOT show the callout when it is NOT my priority window (no prompt forwarded)', () => {
    const { fixture, component } = mountStack({
      stack: [
        { id: 's-bolt', kind: 'Spell', description: 'Lightning Bolt', controllerId: 'opp', cardName: 'Lightning Bolt' },
      ],
      prompt: null,
    });
    expect(fixture.nativeElement.querySelector('.stack-callout')).toBeNull();
    expect(component.stackPriorityCallout()).toBeNull();
  });

  it('does NOT show the callout during a non-priority sub-prompt (e.g. target)', () => {
    const { fixture } = mountStack({
      stack: [
        { id: 's-bolt', kind: 'Spell', description: 'Lightning Bolt', controllerId: 'opp', cardName: 'Lightning Bolt' },
      ],
      prompt: { expectedKinds: ['ChooseTargetsCommand'] },
    });
    expect(fixture.nativeElement.querySelector('.stack-callout')).toBeNull();
  });
});

describe('BoardComponent — stack item controller distinction', () => {
  it('marks the OPPONENT\'s stack objects with stack-item--opponent + data attribute', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'Main',
      turnNumber: 1,
      activePlayerId: 'opp',
      players: [me, opp],
      stack: [
        { id: 's-opp', kind: 'Spell', description: 'Counterspell', controllerId: 'opp', cardName: 'Counterspell' },
        { id: 's-mine', kind: 'Spell', description: 'Opt', controllerId: 'me', cardName: 'Opt' },
      ],
      youPlayerId: 'me',
    };
    const { fixture } = mountBoard(state, ['me']);

    const items: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.stack-item'),
    );
    const oppItem = items.find(el => el.getAttribute('data-stack-controller') === 'opponent');
    const myItem = items.find(el => el.getAttribute('data-stack-controller') === 'self');
    expect(oppItem).toBeTruthy();
    expect(myItem).toBeTruthy();
    expect(oppItem!.classList.contains('stack-item--opponent')).toBe(true);
    expect(myItem!.classList.contains('stack-item--opponent')).toBe(false);
    expect(myItem!.classList.contains('stack-item--mine')).toBe(true);
    // The opponent's card name surfaces in the (auto-expanded) chip.
    expect(oppItem!.textContent).toContain('Counterspell');
  });
});
