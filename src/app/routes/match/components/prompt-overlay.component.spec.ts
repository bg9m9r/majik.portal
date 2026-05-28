import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { PromptOverlayComponent, PromptDecision } from './prompt-overlay.component';
import {
  CardSnapshot,
  GamePlayer,
  GameState,
} from '../../../core/match/match.types';

// These unit tests cover the two combat prompts the engine emits via
// RemoteAgent.DeclareAttackersAsync / DeclareBlockersAsync. The server
// PR (#154) wires the agent so PromptDto.ExpectedKinds carries
// "DeclareAttackersCommand" or "DeclareBlockersCommand"; the overlay's
// detectKind must route both to their dedicated UI, and the confirm
// handlers must shape the PromptDecision so MatchPage.translateDecision
// produces a wire-correct DeclareAttackers/DeclareBlockers command.

function card(over: Partial<CardSnapshot>): CardSnapshot {
  return {
    instanceId: over.instanceId ?? `id-${Math.random()}`,
    name: over.name ?? 'Bear',
    manaCost: over.manaCost ?? '1G',
    types: over.types ?? ['Creature'],
    power: over.power ?? 2,
    toughness: over.toughness ?? 2,
    tapped: over.tapped ?? false,
    summoningSickness: over.summoningSickness ?? false,
    producedManaColors: over.producedManaColors ?? '',
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

function mountOverlay(
  state: GameState | null,
  kinds: string[],
  selfPlayerIds: string[],
  promptExtras: {
    candidates?: CardSnapshot[];
    label?: string;
    libraryView?: CardSnapshot[];
    surveilView?: CardSnapshot[];
    yesNoView?: {
      question: string;
      yesLabel?: string;
      noLabel?: string;
      sourceCardName?: string | null;
    };
  } = {},
) {
  TestBed.configureTestingModule({ imports: [PromptOverlayComponent] });
  const fixture = TestBed.createComponent(PromptOverlayComponent);
  const ref: ComponentRef<PromptOverlayComponent> = fixture.componentRef;
  ref.setInput('state', state);
  ref.setInput('prompt', { expectedKinds: kinds, ...promptExtras });
  ref.setInput('selfPlayerIds', selfPlayerIds);
  fixture.detectChanges();
  return { component: fixture.componentInstance, fixture };
}

describe('PromptOverlayComponent — combat prompts', () => {
  it('detects attackers kind from server "DeclareAttackersCommand" envelope', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = { phase: 'DeclareAttackers', turnNumber: 1, activePlayerId: 'me', players: [me, opp], stack: [], youPlayerId: null };

    const { component } = mountOverlay(state, ['DeclareAttackersCommand'], ['me']);

    expect(component.kind()).toBe('attackers');
    expect(component.titleFor(component.kind())).toBe('Declare attackers');
  });

  it('detects blockers kind from server "DeclareBlockersCommand" envelope', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [], youPlayerId: null };

    const { component } = mountOverlay(state, ['DeclareBlockersCommand'], ['me']);

    expect(component.kind()).toBe('blockers');
    expect(component.titleFor(component.kind())).toBe('Declare blockers');
  });

  it('confirmAttackers emits decision shaped for the wire DeclareAttackersCommand', () => {
    const bear = card({ instanceId: 'bear-1', name: 'Grizzly Bears' });
    const goblin = card({ instanceId: 'goblin-2', name: 'Goblin' });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [bear, goblin] } });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = { phase: 'DeclareAttackers', turnNumber: 1, activePlayerId: 'me', players: [me, opp], stack: [], youPlayerId: null };

    const { component } = mountOverlay(state, ['DeclareAttackersCommand'], ['me']);
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    // Select both creatures, then confirm.
    component.toggle(bear.instanceId);
    component.toggle(goblin.instanceId);
    component.confirmAttackers();

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      kind: 'attackers',
      attackers: [
        { attackerInstanceId: 'bear-1', defenderId: 'opp' },
        { attackerInstanceId: 'goblin-2', defenderId: 'opp' },
      ],
    });
  });

  it('confirmAttackers with no selection emits empty list ("skip combat")', () => {
    // Mirrors CR 508.2 / RemoteAgentTests.DeclareAttackers_EmptyCommand_*:
    // declaring no attackers is a legal plan that just advances combat.
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [card({ instanceId: 'bear' })] } });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = { phase: 'DeclareAttackers', turnNumber: 1, activePlayerId: 'me', players: [me, opp], stack: [], youPlayerId: null };

    const { component } = mountOverlay(state, ['DeclareAttackersCommand'], ['me']);
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.confirmAttackers();

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({ kind: 'attackers', attackers: [] });
  });

  it('confirmBlockers emits decision shaped for the wire DeclareBlockersCommand (single assignment)', () => {
    const oppAtk = card({ instanceId: 'atk-1', name: 'Bear', tapped: true });
    const myBlocker = card({ instanceId: 'block-1', name: 'Goblin' });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [myBlocker] } });
    const opp = player({ id: 'opp', name: 'Bob', battlefield: { cards: [oppAtk] } });
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [], youPlayerId: null };

    const { component } = mountOverlay(state, ['DeclareBlockersCommand'], ['me']);
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.toggleBlockerAssignment('block-1', 'atk-1');
    component.confirmBlockers();

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      kind: 'blockers',
      blockers: [{ attackerInstanceId: 'atk-1', blockerInstanceId: 'block-1' }],
    });
  });

  it('confirmBlockers supports multiple blockers on a single attacker (CR 509.1)', () => {
    // Defender ganging two creatures onto one attacker is the canonical
    // case the old single-<select> UI couldn't express. The wire DTO
    // takes a flat list of {attacker, blocker} pairs, so two entries
    // sharing the same attackerInstanceId is the correct encoding.
    const oppAtk = card({ instanceId: 'atk-big', name: 'Serra Angel', tapped: true });
    const b1 = card({ instanceId: 'block-1', name: 'Goblin' });
    const b2 = card({ instanceId: 'block-2', name: 'Scout' });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [b1, b2] } });
    const opp = player({ id: 'opp', name: 'Bob', battlefield: { cards: [oppAtk] } });
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [], youPlayerId: null };

    const { component } = mountOverlay(state, ['DeclareBlockersCommand'], ['me']);
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.toggleBlockerAssignment('block-1', 'atk-big');
    component.toggleBlockerAssignment('block-2', 'atk-big');
    component.confirmBlockers();

    expect(captured).toHaveLength(1);
    const blockers = captured[0].blockers ?? [];
    expect(blockers).toHaveLength(2);
    expect(blockers).toEqual(expect.arrayContaining([
      { attackerInstanceId: 'atk-big', blockerInstanceId: 'block-1' },
      { attackerInstanceId: 'atk-big', blockerInstanceId: 'block-2' },
    ]));
  });

  it('reassigning a blocker to a different attacker removes the prior assignment', () => {
    // A creature can block at most one attacker (CR 509.1: the defending
    // player declares which attacker each chosen blocker blocks — singular).
    // The UI's mutual-exclusion guarantees the wire command never carries
    // duplicate blockerInstanceIds.
    const atkA = card({ instanceId: 'atk-a', name: 'Bear', tapped: true });
    const atkB = card({ instanceId: 'atk-b', name: 'Wolf', tapped: true });
    const b1 = card({ instanceId: 'block-1', name: 'Goblin' });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [b1] } });
    const opp = player({ id: 'opp', name: 'Bob', battlefield: { cards: [atkA, atkB] } });
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [], youPlayerId: null };

    const { component } = mountOverlay(state, ['DeclareBlockersCommand'], ['me']);
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    // First assign block-1 to atk-a, then reassign to atk-b. The grid's
    // toggle handler removes the prior pairing when the same blocker is
    // checked against a new attacker.
    component.toggleBlockerAssignment('block-1', 'atk-a');
    expect(component.isAssigned('block-1', 'atk-a')).toBe(true);
    component.toggleBlockerAssignment('block-1', 'atk-b');
    expect(component.isAssigned('block-1', 'atk-a')).toBe(false);
    expect(component.isAssigned('block-1', 'atk-b')).toBe(true);

    component.confirmBlockers();

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      kind: 'blockers',
      blockers: [{ attackerInstanceId: 'atk-b', blockerInstanceId: 'block-1' }],
    });
  });

  it('toggling the same cell twice clears the assignment ("no block" for that pairing)', () => {
    const atk = card({ instanceId: 'atk-1', name: 'Bear', tapped: true });
    const b1 = card({ instanceId: 'block-1', name: 'Goblin' });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [b1] } });
    const opp = player({ id: 'opp', name: 'Bob', battlefield: { cards: [atk] } });
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [], youPlayerId: null };

    const { component } = mountOverlay(state, ['DeclareBlockersCommand'], ['me']);

    component.toggleBlockerAssignment('block-1', 'atk-1');
    expect(component.isAssigned('block-1', 'atk-1')).toBe(true);
    component.toggleBlockerAssignment('block-1', 'atk-1');
    expect(component.isAssigned('block-1', 'atk-1')).toBe(false);
  });

  it('confirmBlockers with no assignments emits empty list ("everything through")', () => {
    const oppAtk = card({ instanceId: 'atk-1', name: 'Bear', tapped: true });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [] } });
    const opp = player({ id: 'opp', name: 'Bob', battlefield: { cards: [oppAtk] } });
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [], youPlayerId: null };

    const { component } = mountOverlay(state, ['DeclareBlockersCommand'], ['me']);
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.confirmBlockers();

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({ kind: 'blockers', blockers: [] });
  });

  it('eligibleBlockers excludes tapped creatures (a tapped creature cannot block, CR 509.1b)', () => {
    const atk = card({ instanceId: 'atk-1', name: 'Bear', tapped: true });
    const ready = card({ instanceId: 'block-ready', name: 'Goblin', tapped: false });
    const exhausted = card({ instanceId: 'block-tapped', name: 'Tired Goblin', tapped: true });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [ready, exhausted] } });
    const opp = player({ id: 'opp', name: 'Bob', battlefield: { cards: [atk] } });
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [], youPlayerId: null };

    const { component } = mountOverlay(state, ['DeclareBlockersCommand'], ['me']);

    const ids = component.eligibleBlockers().map(c => c.instanceId);
    expect(ids).toEqual(['block-ready']);
  });

  it('mulligan kind renders no Cancel button (CR 103.4 — no opt-out)', () => {
    // Every player must answer keep-or-mulligan; there is no third option.
    // The overlay header normally renders a Cancel button to dismiss the
    // prompt, but mulligan must suppress it so the player cannot escape
    // the decision.
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = { phase: 'BeginningOfGame', turnNumber: 0, activePlayerId: 'me', players: [me, opp], stack: [], youPlayerId: null };

    const { component, fixture } = mountOverlay(state, ['MulliganCommand'], ['me']);
    expect(component.kind()).toBe('mulligan');

    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    const labels = Array.from(buttons).map(b => (b.textContent ?? '').trim());
    expect(labels).toEqual(expect.arrayContaining(['Keep', 'Mulligan']));
    expect(labels).not.toContain('Cancel');
  });

  // ---- Cancel-button audit (CR 601.2) ---------------------------------
  // The Cancel affordance is reserved for mid-spell-cast prompts where
  // the user may legitimately abort the cast before the spell is fully
  // announced (target picker, X picker, mode picker, mana payment).
  // Every other prompt kind hides Cancel — there is no take-back for a
  // resolved tutor, no opt-out from a mulligan, no "skip" for combat
  // declarations (the player declares an empty set to skip), no escape
  // from a yes/no "may" prompt the engine is waiting on.

  const noCancelKinds: ReadonlyArray<{ label: string; kinds: string[]; expect: string }> = [
    { label: 'attackers',  kinds: ['DeclareAttackersCommand'], expect: 'attackers' },
    { label: 'blockers',   kinds: ['DeclareBlockersCommand'],  expect: 'blockers' },
    { label: 'bottom',     kinds: ['ChooseCardsToBottomCommand'], expect: 'bottom' },
    { label: 'libraryPick',kinds: ['ChooseLibraryPickCommand'], expect: 'libraryPick' },
    { label: 'surveil',    kinds: ['ChooseSurveilCommand'],     expect: 'surveil' },
    { label: 'yesNo',      kinds: ['ChooseYesNoCommand'],       expect: 'yesNo' },
  ];

  for (const { label, kinds, expect: expectedKind } of noCancelKinds) {
    it(`hides Cancel for "${label}" prompts (no mid-cast abort path)`, () => {
      const me = player({ id: 'me', name: 'Alice' });
      const opp = player({ id: 'opp', name: 'Bob' });
      const state: GameState = { phase: 'PreCombatMain', turnNumber: 1, activePlayerId: 'me', players: [me, opp], stack: [], youPlayerId: null };

      const { component, fixture } = mountOverlay(state, kinds, ['me']);
      expect(component.kind()).toBe(expectedKind);
      expect(component.showCancelButton()).toBe(false);

      const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
      const labels = Array.from(buttons).map(b => (b.textContent ?? '').trim());
      expect(labels).not.toContain('Cancel');
    });
  }

  const cancelKinds: ReadonlyArray<{ label: string; kinds: string[]; expect: string }> = [
    { label: 'targets', kinds: ['ChooseTargetsCommand'], expect: 'targets' },
    { label: 'x',       kinds: ['ChooseXCommand'],       expect: 'x' },
    { label: 'mode',    kinds: ['ChooseModeCommand'],    expect: 'mode' },
    { label: 'mana',    kinds: ['ChooseManaCommand'],    expect: 'mana' },
  ];

  for (const { label, kinds, expect: expectedKind } of cancelKinds) {
    it(`renders Cancel for "${label}" prompts (mid-spell-cast abort, CR 601.2)`, () => {
      const me = player({ id: 'me', name: 'Alice' });
      const opp = player({ id: 'opp', name: 'Bob' });
      const state: GameState = { phase: 'PreCombatMain', turnNumber: 1, activePlayerId: 'me', players: [me, opp], stack: [], youPlayerId: null };

      const { component, fixture } = mountOverlay(state, kinds, ['me']);
      expect(component.kind()).toBe(expectedKind);
      expect(component.showCancelButton()).toBe(true);

      const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
      const labels = Array.from(buttons).map(b => (b.textContent ?? '').trim());
      expect(labels).toContain('Cancel');
    });
  }

  it('moves focus to the first focusable element on mount (targets prompt)', async () => {
    // A11y: opening the prompt overlay should land focus inside the dialog
    // so a keyboard user doesn't have to chase it. Mirrors WAI-ARIA modal
    // dialog pattern — focus jumps to the first focusable child (the
    // Confirm button for targets / attackers / blockers prompts).
    const bear = card({ instanceId: 'bear-1', name: 'Grizzly Bears' });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [bear] } });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'PreCombatMain', turnNumber: 1, activePlayerId: 'me',
      players: [me, opp], stack: [], youPlayerId: null,
    };

    const { component, fixture } = mountOverlay(state, ['ChooseTargetsCommand'], ['me']);
    // ngAfterViewInit defers focus into a rAF — call directly for
    // deterministic test behaviour.
    component.focusFirstFocusable();
    fixture.detectChanges();
    const root = (fixture.nativeElement as HTMLElement).querySelector('.prompt-overlay') as HTMLElement;
    expect(root).toBeTruthy();
    // First focusable inside the overlay is the Cancel button (in the
    // header) — verify focus landed somewhere inside the dialog.
    const active = document.activeElement as HTMLElement | null;
    expect(active).toBeTruthy();
    expect(root.contains(active)).toBe(true);
  });

  it('tryConfirmPrimary emits a targets decision when at least one selected', () => {
    // The Enter shortcut in match.ts calls tryConfirmPrimary() on the
    // overlay. With no selection it must be a no-op; with one or more
    // it must fire the same decision shape confirmTargets does.
    const bear = card({ instanceId: 'bear-1', name: 'Grizzly Bears' });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [bear] } });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'PreCombatMain', turnNumber: 1, activePlayerId: 'me',
      players: [me, opp], stack: [], youPlayerId: null,
    };

    const { component } = mountOverlay(state, ['ChooseTargetsCommand'], ['me']);
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    // No selection — confirm refused.
    expect(component.tryConfirmPrimary()).toBe(false);
    expect(captured).toHaveLength(0);

    // Select then confirm.
    component.toggle('bear-1');
    expect(component.tryConfirmPrimary()).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({ kind: 'targets', targetInstanceIds: ['bear-1'] });
  });

  it('Tab on the last focusable wraps to the first (focus trap)', () => {
    // The dialog implements a Tab trap so keyboard focus can't escape
    // the overlay while a prompt is open. Synthesise the last element
    // focused and dispatch Tab; the trap should pull focus back to the
    // first focusable inside the overlay.
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [card({ instanceId: 'b' })] } });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'DeclareAttackers', turnNumber: 1, activePlayerId: 'me',
      players: [me, opp], stack: [], youPlayerId: null,
    };

    const { component, fixture } = mountOverlay(state, ['DeclareAttackersCommand'], ['me']);
    const root = (fixture.nativeElement as HTMLElement).querySelector('.prompt-overlay') as HTMLElement;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter(n => !n.hasAttribute('disabled'));
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    expect(document.activeElement).toBe(last);

    const evt = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    component.onOverlayKeydown(evt);
    // Tab forward from last → first.
    expect(document.activeElement).toBe(first);
  });

  it('Shift+Tab on the first focusable wraps to the last (focus trap, reverse)', () => {
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [card({ instanceId: 'b' })] } });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'DeclareAttackers', turnNumber: 1, activePlayerId: 'me',
      players: [me, opp], stack: [], youPlayerId: null,
    };

    const { component, fixture } = mountOverlay(state, ['DeclareAttackersCommand'], ['me']);
    const root = (fixture.nativeElement as HTMLElement).querySelector('.prompt-overlay') as HTMLElement;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter(n => !n.hasAttribute('disabled'));
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first.focus();

    const evt = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true });
    component.onOverlayKeydown(evt);
    expect(document.activeElement).toBe(last);
  });

  it('detects mana kind from server "ChooseManaCommand" envelope', () => {
    // Pairs with majik.core #438: the cast flow now triggers a
    // ChooseMana prompt for the unpaid deficit after the floating pool
    // is consumed first. PromptDto.ExpectedKinds carries the C# type
    // name verbatim (see GameFacade.BuildPrompt), so detectKind must
    // route it to the dedicated mana UI.
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = { phase: 'PreCombatMain', turnNumber: 1, activePlayerId: 'me', players: [me, opp], stack: [], youPlayerId: null };

    const { component } = mountOverlay(state, ['ChooseManaCommand'], ['me']);

    expect(component.kind()).toBe('mana');
    expect(component.titleFor(component.kind())).toBe('Pay mana cost');
  });

  it('confirmMana emits an empty source list (server auto-pays the deficit)', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = { phase: 'PreCombatMain', turnNumber: 1, activePlayerId: 'me', players: [me, opp], stack: [], youPlayerId: null };

    const { component } = mountOverlay(state, ['ChooseManaCommand'], ['me']);
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.confirmMana();

    expect(captured).toEqual([{ kind: 'mana', sourceInstanceIds: [] }]);
  });

  it('cancelMana emits a mana-cancel decision (translated to cancelCast on the wire)', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = { phase: 'PreCombatMain', turnNumber: 1, activePlayerId: 'me', players: [me, opp], stack: [], youPlayerId: null };

    const { component } = mountOverlay(state, ['ChooseManaCommand'], ['me']);
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.cancelMana();

    expect(captured).toEqual([{ kind: 'mana-cancel' }]);
  });

  it('attackerList only includes tapped opponent creatures (post-attack-declared timing)', () => {
    // CombatFlow taps each attacker before firing the defender's
    // DeclareBlockersAsync prompt (CombatFlow.cs:56-66), so the overlay's
    // heuristic "tapped opponent creature" filter is the closest signal
    // for "is this an attacker" the UI has today. Sanity-check it.
    const attackedBear = card({ instanceId: 'atk-1', name: 'Bear', tapped: true });
    const untappedScout = card({ instanceId: 'scout-1', name: 'Scout', tapped: false });
    const tappedLand = card({ instanceId: 'land-1', name: 'Forest', tapped: true, types: ['Land'] });

    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({
      id: 'opp', name: 'Bob',
      battlefield: { cards: [attackedBear, untappedScout, tappedLand] },
    });
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [], youPlayerId: null };

    const { component } = mountOverlay(state, ['DeclareBlockersCommand'], ['me']);

    const list = component.attackerList();
    expect(list).toHaveLength(1);
    expect(list[0].instanceId).toBe('atk-1');
  });
});

// CR 701.19a — library-search picker (Green Sun's Zenith, Mystical
// Tutor, Path to Exile, …). Server PR adds ChooseLibraryPickCommand on
// the wire + ships the engine-filtered candidate list + a kindLabel on
// the prompt envelope (the library is hidden in GameState under
// CR 706, so the portal has no other way to render the choice). These
// tests cover detectKind, candidate forwarding, name-filter, and the
// two confirm paths (pick / find-nothing).
describe('PromptOverlayComponent — library pick prompt', () => {
  function makeMe() {
    return player({ id: 'me', name: 'Alice' });
  }
  function makeState(): GameState {
    return { phase: 'Main', turnNumber: 3, activePlayerId: 'me', players: [makeMe()], stack: [], youPlayerId: null };
  }

  it('detects libraryPick kind from server "ChooseLibraryPickCommand" envelope', () => {
    const { component } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates: [], label: 'green creature card with mana value 2 or less' },
    );

    expect(component.kind()).toBe('libraryPick');
    expect(component.titleFor(component.kind())).toBe('Search your library');
  });

  it('exposes envelope candidates to the picker computed', () => {
    const elf = card({ instanceId: 'elf-1', name: 'Llanowar Elves', manaCost: '{G}' });
    const bop = card({ instanceId: 'bop-1', name: 'Birds of Paradise', manaCost: '{G}' });
    const { component } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates: [elf, bop], label: 'green creature card with mana value 1 or less' },
    );

    expect(component.libraryCandidates()).toHaveLength(2);
    expect(component.libraryCandidates()[0].instanceId).toBe('elf-1');
    // Empty filter → full set passes through.
    expect(component.filteredLibraryCandidates()).toHaveLength(2);
  });

  it('filteredLibraryCandidates narrows by case-insensitive name substring', () => {
    const elf = card({ instanceId: 'elf-1', name: 'Llanowar Elves' });
    const bop = card({ instanceId: 'bop-1', name: 'Birds of Paradise' });
    const noble = card({ instanceId: 'nh-1', name: 'Noble Hierarch' });
    const { component } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates: [elf, bop, noble], label: 'green creature card' },
    );

    component.libraryPickFilter.set('noble');
    const matched = component.filteredLibraryCandidates();
    expect(matched).toHaveLength(1);
    expect(matched[0].instanceId).toBe('nh-1');

    // Case insensitive — uppercase + partial substring still match.
    component.libraryPickFilter.set('BIRDS');
    const matched2 = component.filteredLibraryCandidates();
    expect(matched2).toHaveLength(1);
    expect(matched2[0].instanceId).toBe('bop-1');
  });

  it('confirmLibraryPick emits decision with the selected InstanceId', () => {
    const elf = card({ instanceId: 'elf-1', name: 'Llanowar Elves' });
    const bop = card({ instanceId: 'bop-1', name: 'Birds of Paradise' });
    const { component } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates: [elf, bop], label: 'green creature card' },
    );
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.selectLibraryCandidate('bop-1');
    expect(component.selectedLibraryInstanceId()).toBe('bop-1');
    component.confirmLibraryPick();

    expect(captured).toEqual([
      { kind: 'libraryPick', selectedInstanceId: 'bop-1' },
    ]);
    // Confirmation resets local selection state so a stale highlight
    // doesn't bleed across into the next prompt.
    expect(component.selectedLibraryInstanceId()).toBeNull();
    expect(component.libraryPickFilter()).toBe('');
  });

  it('confirmLibraryPickNothing emits null for the legal "find nothing" branch', () => {
    // CR 701.19a — a player may decline to choose from a successful
    // search. Wire shape is `selectedInstanceId: null`; the server's
    // ChooseLibraryPickCommand handler maps it to a no-pick (e.g.
    // Green Sun's Zenith resolves without tutoring, but still shuffles
    // itself back into the library).
    const elf = card({ instanceId: 'elf-1', name: 'Llanowar Elves' });
    const { component } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates: [elf], label: 'creature card' },
    );
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.confirmLibraryPickNothing();

    expect(captured).toEqual([
      { kind: 'libraryPick', selectedInstanceId: null },
    ]);
  });

  it('selectLibraryCandidate twice on the same id clears selection (toggle)', () => {
    const elf = card({ instanceId: 'elf-1', name: 'Llanowar Elves' });
    const { component } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates: [elf], label: 'creature card' },
    );

    component.selectLibraryCandidate('elf-1');
    expect(component.selectedLibraryInstanceId()).toBe('elf-1');
    component.selectLibraryCandidate('elf-1');
    expect(component.selectedLibraryInstanceId()).toBeNull();
  });
});

// CR 701.19a — full library-view grid (companion core PR). When the server
// ships `libraryView` alongside `candidates`, the overlay renders ALL 60
// cards in deck order: eligible cards (in candidates) are highlighted and
// clickable; ineligible cards are muted and not interactive.
describe('PromptOverlayComponent — full library-view grid', () => {
  function makeMe() {
    return player({ id: 'me', name: 'Alice' });
  }
  function makeState(): GameState {
    return { phase: 'Main', turnNumber: 3, activePlayerId: 'me', players: [makeMe()], stack: [], youPlayerId: null };
  }

  // Build a libraryView of `total` cards and a candidates subset of `eligibleIds`.
  function makeLibrary(total: number, eligibleIds: string[]): CardSnapshot[] {
    return Array.from({ length: total }, (_, i) => card({
      instanceId: `lib-${i}`,
      name: eligibleIds.includes(`lib-${i}`) ? `Forest ${i}` : `Plains ${i}`,
    }));
  }

  it('renders ALL libraryView cards (10 total) with 3 eligible, 7 muted', () => {
    const eligibleIds = ['lib-0', 'lib-3', 'lib-7'];
    const libraryView = makeLibrary(10, eligibleIds);
    const candidates = libraryView.filter(c => eligibleIds.includes(c.instanceId));

    const { component, fixture } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates, libraryView, label: 'Forest card' },
    );

    expect(component.hasLibraryView()).toBe(true);
    expect(component.libraryView()).toHaveLength(10);

    const el = fixture.nativeElement as HTMLElement;
    const eligibleButtons = el.querySelectorAll('[data-eligible="true"]');
    const mutedCards = el.querySelectorAll('[data-muted="true"]');

    expect(eligibleButtons.length).toBe(3);
    expect(mutedCards.length).toBe(7);
  });

  it('clicking an eligible card updates selectedLibraryInstanceId and emits pick on confirm', () => {
    const eligibleIds = ['lib-0', 'lib-3', 'lib-7'];
    const libraryView = makeLibrary(10, eligibleIds);
    const candidates = libraryView.filter(c => eligibleIds.includes(c.instanceId));

    const { component, fixture } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates, libraryView },
    );
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    const el = fixture.nativeElement as HTMLElement;
    const eligibleButton = el.querySelector('[data-eligible="true"]') as HTMLButtonElement;
    expect(eligibleButton).toBeTruthy();
    eligibleButton.click();
    fixture.detectChanges();

    // Should have selected the eligible card's instanceId.
    expect(component.selectedLibraryInstanceId()).not.toBeNull();

    component.confirmLibraryPick();
    expect(captured).toHaveLength(1);
    expect(captured[0].kind).toBe('libraryPick');
    expect(typeof captured[0].selectedInstanceId).toBe('string');
    expect(eligibleIds).toContain(captured[0].selectedInstanceId);
  });

  it('clicking a muted card does NOT update selection', () => {
    const eligibleIds = ['lib-0'];
    const libraryView = makeLibrary(10, eligibleIds);
    const candidates = libraryView.filter(c => eligibleIds.includes(c.instanceId));

    const { component, fixture } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates, libraryView },
    );
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    const el = fixture.nativeElement as HTMLElement;
    // Muted cards are divs, not buttons — they have no click handler.
    const mutedEl = el.querySelector('[data-muted="true"]') as HTMLElement;
    expect(mutedEl).toBeTruthy();
    // Simulate click (div with no handler should not change state).
    mutedEl.click();
    fixture.detectChanges();

    expect(component.selectedLibraryInstanceId()).toBeNull();
    expect(captured).toHaveLength(0);
  });

  it('filter narrows across the full libraryView (not just candidates)', () => {
    // 10 cards: lib-0..lib-4 named "Forest N", lib-5..lib-9 named "Plains N".
    // Only lib-0 is eligible. Filtering "Forest" should show 5 cards, all Forests.
    const eligibleIds = ['lib-0'];
    const libraryView = Array.from({ length: 10 }, (_, i) =>
      card({ instanceId: `lib-${i}`, name: i < 5 ? `Forest ${i}` : `Plains ${i}` })
    );
    const candidates = libraryView.filter(c => eligibleIds.includes(c.instanceId));

    const { component } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates, libraryView },
    );

    component.libraryPickFilter.set('Forest');
    const filtered = component.filteredLibraryView();
    expect(filtered).toHaveLength(5);
    expect(filtered.every(c => c.name.toLowerCase().includes('forest'))).toBe(true);

    // The single eligible Forest (lib-0) should appear in the filtered set.
    expect(filtered.some(c => c.instanceId === 'lib-0')).toBe(true);
  });

  it('eligible count reflects filter — "eligible: X / Y" counter', () => {
    // 4 eligible Forests out of 8 total Forests. Filter "Forest" → 8 shown, 4 eligible.
    const eligibleIds = ['lib-0', 'lib-1', 'lib-2', 'lib-3'];
    const libraryView = Array.from({ length: 12 }, (_, i) =>
      card({ instanceId: `lib-${i}`, name: i < 8 ? `Forest ${i}` : `Plains ${i}` })
    );
    const candidates = libraryView.filter(c => eligibleIds.includes(c.instanceId));

    const { component } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates, libraryView },
    );

    component.libraryPickFilter.set('Forest');
    // 8 Forests match the filter; 4 of those are eligible.
    expect(component.filteredLibraryView()).toHaveLength(8);
    expect(component.visibleEligibleCount()).toBe(4);
  });

  it('envelope WITHOUT libraryView falls back to flat candidates list (regression guard)', () => {
    // Older server builds do not ship libraryView. The overlay must not
    // break — it falls back to the existing flat-candidates behaviour.
    const elf = card({ instanceId: 'elf-1', name: 'Llanowar Elves' });
    const bop = card({ instanceId: 'bop-1', name: 'Birds of Paradise' });

    const { component, fixture } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates: [elf, bop], label: 'green creature' },
    );

    // hasLibraryView must be false when libraryView is absent.
    expect(component.hasLibraryView()).toBe(false);

    // The legacy flat list should still be rendered (no data-eligible / data-muted attributes).
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-eligible]').length).toBe(0);
    expect(el.querySelectorAll('[data-muted]').length).toBe(0);

    // The two candidates should render as buttons.
    // Find buttons containing the candidate names.
    const buttons = Array.from(el.querySelectorAll('button')) as HTMLButtonElement[];
    const names = buttons.map(b => b.textContent ?? '');
    expect(names.some(t => t.includes('Llanowar Elves'))).toBe(true);
    expect(names.some(t => t.includes('Birds of Paradise'))).toBe(true);
  });

  it('decline button (Pick nothing) still emits the existing decline decision', () => {
    const eligibleIds = ['lib-0'];
    const libraryView = makeLibrary(5, eligibleIds);
    const candidates = libraryView.filter(c => eligibleIds.includes(c.instanceId));

    const { component } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates, libraryView },
    );
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.confirmLibraryPickNothing();

    expect(captured).toEqual([{ kind: 'libraryPick', selectedInstanceId: null }]);
  });
});

// -----------------------------------------------------------------------
// CR 701.42 — surveil prompts (Underground Mortuary ETB et al.)
// -----------------------------------------------------------------------

describe('PromptOverlayComponent — surveil prompt (CR 701.42)', () => {
  function me(): GamePlayer {
    return player({ id: 'me', name: 'Alice' });
  }
  function state(): GameState {
    return {
      phase: 'Main', turnNumber: 3, activePlayerId: 'me',
      players: [me()], stack: [], youPlayerId: null,
    };
  }

  it('detects surveil kind from server "ChooseSurveilCommand" envelope', () => {
    const peeked = [card({ instanceId: 'top-1', name: 'Forest' })];
    const { component } = mountOverlay(
      state(),
      ['ChooseSurveilCommand'],
      ['me'],
      { surveilView: peeked, label: 'surveil 1' },
    );

    expect(component.kind()).toBe('surveil');
    expect(component.titleFor(component.kind())).toBe('Surveil');
  });

  it('exposes envelope surveilView to the modal computed', () => {
    const a = card({ instanceId: 'a', name: 'Forest' });
    const b = card({ instanceId: 'b', name: 'Mountain' });
    const { component } = mountOverlay(
      state(),
      ['ChooseSurveilCommand'],
      ['me'],
      { surveilView: [a, b], label: 'surveil 2' },
    );

    expect(component.surveilPeeked()).toHaveLength(2);
    expect(component.surveilPeeked()[0].instanceId).toBe('a');
    expect(component.surveilReady()).toBe(false);
  });

  it('confirm is disabled until every peeked card has a decision', () => {
    const a = card({ instanceId: 'a', name: 'Forest' });
    const b = card({ instanceId: 'b', name: 'Mountain' });
    const { component } = mountOverlay(
      state(),
      ['ChooseSurveilCommand'],
      ['me'],
      { surveilView: [a, b], label: 'surveil 2' },
    );

    component.setSurveilDecision('a', 'graveyard');
    expect(component.surveilReady()).toBe(false);
    component.setSurveilDecision('b', 'top');
    expect(component.surveilReady()).toBe(true);
  });

  it('toggling the same choice clears it (forcing the player to re-pick before Confirm)', () => {
    const a = card({ instanceId: 'a', name: 'Forest' });
    const { component } = mountOverlay(
      state(),
      ['ChooseSurveilCommand'],
      ['me'],
      { surveilView: [a], label: 'surveil 1' },
    );

    component.setSurveilDecision('a', 'graveyard');
    expect(component.surveilDecisions()['a']).toBe('graveyard');
    component.setSurveilDecision('a', 'graveyard');
    expect(component.surveilDecisions()['a']).toBeUndefined();
    expect(component.surveilReady()).toBe(false);
  });

  it('confirmSurveil emits the partition and resets decision state', () => {
    // Peeked order: a, b, c (top-to-bottom). Player keeps b on top,
    // sends a + c to graveyard. Wire payload preserves topOrder in the
    // peeked-list's natural order so index 0 of topOrderInstanceIds
    // becomes the new top of library.
    const a = card({ instanceId: 'a', name: 'Forest' });
    const b = card({ instanceId: 'b', name: 'Mountain' });
    const c = card({ instanceId: 'c', name: 'Island' });
    const { component } = mountOverlay(
      state(),
      ['ChooseSurveilCommand'],
      ['me'],
      { surveilView: [a, b, c], label: 'surveil 3' },
    );
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.setSurveilDecision('a', 'graveyard');
    component.setSurveilDecision('b', 'top');
    component.setSurveilDecision('c', 'graveyard');
    component.confirmSurveil();

    expect(captured).toEqual([
      {
        kind: 'surveil',
        toGraveyardInstanceIds: ['a', 'c'],
        topOrderInstanceIds: ['b'],
      },
    ]);
    // Resets so a subsequent surveil prompt starts clean.
    expect(component.surveilDecisions()).toEqual({});
  });

  it('all-to-graveyard partition: empty topOrder, every peeked id in toGraveyard', () => {
    // Common shape for bot-default behaviour and "no upside" hands.
    const a = card({ instanceId: 'a', name: 'Forest' });
    const b = card({ instanceId: 'b', name: 'Mountain' });
    const { component } = mountOverlay(
      state(),
      ['ChooseSurveilCommand'],
      ['me'],
      { surveilView: [a, b], label: 'surveil 2' },
    );
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.setSurveilDecision('a', 'graveyard');
    component.setSurveilDecision('b', 'graveyard');
    component.confirmSurveil();

    expect(captured).toEqual([
      {
        kind: 'surveil',
        toGraveyardInstanceIds: ['a', 'b'],
        topOrderInstanceIds: [],
      },
    ]);
  });
});

// -----------------------------------------------------------------------
// CR 117.x / 605.1 — Yes/No "may" prompts (shock-land "pay 2 life?" et al.)
// -----------------------------------------------------------------------

describe('PromptOverlayComponent — yes/no prompt (CR 117.x / 605.1)', () => {
  function me(): GamePlayer {
    return player({ id: 'me', name: 'Alice' });
  }
  function state(): GameState {
    return {
      phase: 'Main', turnNumber: 3, activePlayerId: 'me',
      players: [me()], stack: [], youPlayerId: null,
    };
  }

  function mountYesNo(view: {
    question: string;
    sourceCardName?: string | null;
    yesLabel?: string;
    noLabel?: string;
  }) {
    return mountOverlay(
      state(),
      ['ChooseYesNoCommand'],
      ['me'],
      { yesNoView: view },
    );
  }

  it('detects yesNo kind from server "ChooseYesNoCommand" envelope', () => {
    const { component } = mountYesNo({
      question: 'Pay 2 life for Overgrown Tomb to enter untapped?',
      sourceCardName: 'Overgrown Tomb',
    });

    expect(component.kind()).toBe('yesNo');
  });

  it('titles modal after the source card name when provided', () => {
    const { component } = mountYesNo({
      question: 'Pay 2 life for Overgrown Tomb to enter untapped?',
      sourceCardName: 'Overgrown Tomb',
    });

    expect(component.titleFor(component.kind())).toBe('Overgrown Tomb');
  });

  it('falls back to generic "Choose" title when no source card provided', () => {
    const { component } = mountYesNo({
      question: 'Cast it for its alternative cost?',
      sourceCardName: null,
    });

    expect(component.titleFor(component.kind())).toBe('Choose');
  });

  it('exposes the question text + default Yes/No labels via computeds', () => {
    const { component } = mountYesNo({
      question: 'Pay 2 life for Steam Vents to enter untapped?',
      sourceCardName: 'Steam Vents',
    });

    expect(component.yesNoQuestion()).toBe(
      'Pay 2 life for Steam Vents to enter untapped?',
    );
    expect(component.yesNoYesLabel()).toBe('Yes');
    expect(component.yesNoNoLabel()).toBe('No');
  });

  it('respects engine-supplied yes/no label overrides', () => {
    const { component } = mountYesNo({
      question: 'Choose your fate.',
      yesLabel: 'Pay 2 life',
      noLabel: 'Enter tapped',
    });

    expect(component.yesNoYesLabel()).toBe('Pay 2 life');
    expect(component.yesNoNoLabel()).toBe('Enter tapped');
  });

  it('answerYesNo emits a yesNo decision with the bool answer (true)', () => {
    const { component } = mountYesNo({
      question: 'Pay 2 life for Overgrown Tomb to enter untapped?',
      sourceCardName: 'Overgrown Tomb',
    });
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.answerYesNo(true);

    expect(captured).toEqual([{ kind: 'yesNo', answer: true }]);
  });

  it('answerYesNo emits a yesNo decision with the bool answer (false)', () => {
    const { component } = mountYesNo({
      question: 'Pay 2 life for Overgrown Tomb to enter untapped?',
      sourceCardName: 'Overgrown Tomb',
    });
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.answerYesNo(false);

    expect(captured).toEqual([{ kind: 'yesNo', answer: false }]);
  });

  it('clicking the Yes button emits answer: true', async () => {
    const { component, fixture } = mountYesNo({
      question: 'Pay 2 life for Overgrown Tomb to enter untapped?',
      sourceCardName: 'Overgrown Tomb',
    });
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    const yesBtn = fixture.nativeElement.querySelector(
      '[data-yesno-action="yes"]') as HTMLButtonElement | null;
    expect(yesBtn).not.toBeNull();
    yesBtn!.click();

    expect(captured).toEqual([{ kind: 'yesNo', answer: true }]);
  });

  it('clicking the No button emits answer: false', async () => {
    const { component, fixture } = mountYesNo({
      question: 'Pay 2 life for Overgrown Tomb to enter untapped?',
      sourceCardName: 'Overgrown Tomb',
    });
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    const noBtn = fixture.nativeElement.querySelector(
      '[data-yesno-action="no"]') as HTMLButtonElement | null;
    expect(noBtn).not.toBeNull();
    noBtn!.click();

    expect(captured).toEqual([{ kind: 'yesNo', answer: false }]);
  });
});
