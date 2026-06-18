import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComponentRef, signal } from '@angular/core';
import { PromptOverlayComponent, PromptDecision, detectKind } from './prompt-overlay.component';
import { SelectionService } from '../../../core/match/selection.service';
import { ViewportService } from '../../../core/ui/viewport.service';
import {
  CardSnapshot,
  GamePlayer,
  GameState,
  PromptEnvelope,
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
    scryView?: CardSnapshot[];
    yesNoView?: {
      question: string;
      yesLabel?: string;
      noLabel?: string;
      sourceCardName?: string | null;
    };
    revealView?: {
      revealed: CardSnapshot[];
      eligibleInstanceIds: string[];
      optional: boolean;
      label: string;
    };
    bottomCount?: number;
    choiceView?: {
      kind: string;
      min: number;
      max: number;
    };
  } = {},
) {
  TestBed.configureTestingModule({
    imports: [PromptOverlayComponent],
    providers: [SelectionService],
  });
  const fixture = TestBed.createComponent(PromptOverlayComponent);
  const ref: ComponentRef<PromptOverlayComponent> = fixture.componentRef;
  ref.setInput('state', state);
  ref.setInput('prompt', { expectedKinds: kinds, ...promptExtras });
  ref.setInput('selfPlayerIds', selfPlayerIds);
  fixture.detectChanges();
  const selection = TestBed.inject(SelectionService);
  return { component: fixture.componentInstance, fixture, selection };
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
    { label: 'scry',       kinds: ['ChooseScryCommand'],        expect: 'scry' },
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

// CR 115.3 / 608.2c — a TARGET prompt must offer ONLY the engine's legal
// target pool. The server ships that pool on PromptDto.Candidates (server
// PR #2582); the overlay must restrict the picker to those instanceIds and
// must NOT render illegal permanents (enemy lands/creatures for a "target
// land you control"-style restriction). When the envelope ships no
// candidate list (description-only target), the overlay falls back to the
// broad battlefield set so the player isn't locked out.
describe('PromptOverlayComponent — target prompt legal candidates', () => {
  function twoPlayerState(meCards: CardSnapshot[], oppCards: CardSnapshot[]): GameState {
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: meCards } });
    const opp = player({ id: 'opp', name: 'Bob', battlefield: { cards: oppCards } });
    return {
      phase: 'PreCombatMain', turnNumber: 1, activePlayerId: 'me',
      players: [me, opp], stack: [], youPlayerId: null,
    };
  }

  it('offers ONLY the prompt Candidates, omitting illegal battlefield permanents', () => {
    const myLand = card({ instanceId: 'my-land', name: 'Forest', types: ['Land'] });
    const enemyLand = card({ instanceId: 'enemy-land', name: 'Island', types: ['Land'] });
    const enemyBear = card({ instanceId: 'enemy-bear', name: 'Grizzly Bears' });
    const state = twoPlayerState([myLand], [enemyLand, enemyBear]);

    // Engine restricts to "target land you control" -> only myLand legal.
    const { component, fixture } = mountOverlay(
      state, ['ChooseTargetsCommand'], ['me'], { candidates: [myLand] },
    );

    const offered = component.candidates().map(c => c.card.instanceId);
    expect(offered).toEqual(['my-land']);
    expect(offered).not.toContain('enemy-land');
    expect(offered).not.toContain('enemy-bear');

    // The illegal permanents must not be clickable in the rendered grid.
    const el = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(el.querySelectorAll('[data-kind="targets"] .grid button'));
    const labels = buttons.map(b => (b.textContent ?? '').trim());
    expect(labels.some(t => t.includes('Forest'))).toBe(true);
    expect(labels.some(t => t.includes('Island'))).toBe(false);
    expect(labels.some(t => t.includes('Grizzly Bears'))).toBe(false);
  });

  it('resolves zone + controller for envelope candidates from the visible state', () => {
    const myLand = card({ instanceId: 'my-land', name: 'Forest', types: ['Land'] });
    const enemyBear = card({ instanceId: 'enemy-bear', name: 'Grizzly Bears' });
    const state = twoPlayerState([myLand], [enemyBear]);

    // A removal spell can target either creature/permanent — both legal.
    const { component } = mountOverlay(
      state, ['ChooseTargetsCommand'], ['me'], { candidates: [myLand, enemyBear] },
    );

    const resolved = component.candidates();
    expect(resolved.find(c => c.card.instanceId === 'my-land')?.controllerName).toBe('Alice');
    expect(resolved.find(c => c.card.instanceId === 'enemy-bear')?.controllerName).toBe('Bob');
    expect(resolved.every(c => c.zone === 'battlefield')).toBe(true);
  });

  it('empty Candidates renders no choices (no fallback to broad battlefield)', () => {
    const myLand = card({ instanceId: 'my-land', name: 'Forest', types: ['Land'] });
    const enemyBear = card({ instanceId: 'enemy-bear', name: 'Grizzly Bears' });
    const state = twoPlayerState([myLand], [enemyBear]);

    // Engine shipped an explicit empty legal pool — nothing is targetable.
    const { component } = mountOverlay(
      state, ['ChooseTargetsCommand'], ['me'], { candidates: [] },
    );

    expect(component.candidates()).toHaveLength(0);
  });

  it('falls back to broad battlefield set when the envelope ships NO candidates', () => {
    const myLand = card({ instanceId: 'my-land', name: 'Forest', types: ['Land'] });
    const enemyBear = card({ instanceId: 'enemy-bear', name: 'Grizzly Bears' });
    const state = twoPlayerState([myLand], [enemyBear]);

    // Description-only target prompt (no machine-readable pool) — preserve
    // legacy behaviour so the player isn't locked out.
    const { component } = mountOverlay(state, ['ChooseTargetsCommand'], ['me']);

    const offered = component.candidates().map(c => c.card.instanceId).sort();
    expect(offered).toEqual(['enemy-bear', 'my-land']);
  });

  it('still offers a candidate not present in any visible zone (hidden-zone target)', () => {
    const state = twoPlayerState([], []);
    const exiledCard = card({ instanceId: 'exiled-1', name: 'Snapcaster Mage' });

    const { component } = mountOverlay(
      state, ['ChooseTargetsCommand'], ['me'], { candidates: [exiledCard] },
    );

    const resolved = component.candidates();
    expect(resolved).toHaveLength(1);
    expect(resolved[0].card.instanceId).toBe('exiled-1');
    expect(resolved[0].controllerName).toBe('');
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

  // -----------------------------------------------------------------------
  // CR 701.19a — zero-candidate prompts (companion to engine LibrarySearch
  // refactor). The engine now prompts the agent even when the pre-filtered
  // candidate list is empty (e.g. Green Sun's Zenith into a deck with no
  // green creatures). The portal must surface this clearly with a banner +
  // single Acknowledge button — not the dual Search-and-pick / Pick-nothing
  // pair that would confuse the player when there's nothing eligible.
  // -----------------------------------------------------------------------

  it('zero eligible candidates: shows empty-search banner', () => {
    const libraryView = makeLibrary(10, []);
    const candidates: CardSnapshot[] = [];

    const { fixture } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates, libraryView, label: 'green creature card' },
    );

    const el = fixture.nativeElement as HTMLElement;
    const banner = el.querySelector('[data-testid="library-pick-empty-banner"]');
    expect(banner).toBeTruthy();
    expect((banner as HTMLElement).textContent).toContain('No matching cards');
  });

  it('zero eligible candidates: all libraryView cards rendered muted, none clickable', () => {
    const libraryView = makeLibrary(10, []); // 0 eligible
    const candidates: CardSnapshot[] = [];

    const { fixture } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates, libraryView, label: 'basic land card' },
    );

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-eligible="true"]').length).toBe(0);
    expect(el.querySelectorAll('[data-muted="true"]').length).toBe(10);
  });

  it('zero eligible candidates: shows OK acknowledge button, hides Search-and-pick / Pick-nothing', () => {
    const libraryView = makeLibrary(10, []);
    const candidates: CardSnapshot[] = [];

    const { fixture } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates, libraryView, label: 'green creature card' },
    );

    const el = fixture.nativeElement as HTMLElement;
    const ackBtn = el.querySelector('[data-testid="library-pick-acknowledge"]') as HTMLButtonElement | null;
    expect(ackBtn).toBeTruthy();
    expect(ackBtn!.textContent?.trim()).toBe('OK');

    // The dual button pair should not be rendered in the empty branch —
    // there is no card to "search and pick", and "Pick nothing" would be
    // a confusing redundant verb when nothing matched.
    const buttons = Array.from(el.querySelectorAll('button')).map(b => b.textContent?.trim());
    expect(buttons).not.toContain('Search and pick');
    expect(buttons).not.toContain('Pick nothing');
  });

  it('zero eligible candidates: OK button emits ChooseLibraryPickCommand with null instance id', () => {
    const libraryView = makeLibrary(10, []);
    const candidates: CardSnapshot[] = [];

    const { component, fixture } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates, libraryView },
    );
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    const el = fixture.nativeElement as HTMLElement;
    const ackBtn = el.querySelector('[data-testid="library-pick-acknowledge"]') as HTMLButtonElement;
    ackBtn.click();

    // CR 701.19a — declining / finding-nothing is the wire shape: null id.
    expect(captured).toEqual([{ kind: 'libraryPick', selectedInstanceId: null }]);
  });

  it('non-empty candidates: dual buttons still render (regression guard)', () => {
    const eligibleIds = ['lib-2'];
    const libraryView = makeLibrary(10, eligibleIds);
    const candidates = libraryView.filter(c => eligibleIds.includes(c.instanceId));

    const { fixture } = mountOverlay(
      makeState(),
      ['ChooseLibraryPickCommand'],
      ['me'],
      { candidates, libraryView, label: 'green creature card' },
    );

    const el = fixture.nativeElement as HTMLElement;
    // No empty banner when at least one candidate exists.
    expect(el.querySelector('[data-testid="library-pick-empty-banner"]')).toBeNull();
    // No OK acknowledge button when there's something to pick.
    expect(el.querySelector('[data-testid="library-pick-acknowledge"]')).toBeNull();
    // Both legacy buttons present.
    const buttons = Array.from(el.querySelectorAll('button')).map(b => b.textContent?.trim());
    expect(buttons).toContain('Search and pick');
    expect(buttons).toContain('Pick nothing');
  });
});

// -----------------------------------------------------------------------
// The library search picker renders cards as ART STACKS: duplicate cards
// (3× Verdant Catacombs) collapse into ONE <app-card-tile> with a count
// badge rather than three identical rows. Eligible-vs-muted split is
// preserved; selection still resolves to a single eligible instanceId of
// the clicked stack (the wire shape is unchanged).
// -----------------------------------------------------------------------
describe('PromptOverlayComponent — library-pick art stacks', () => {
  function makeState(): GameState {
    return {
      phase: 'Main', turnNumber: 3, activePlayerId: 'me',
      players: [player({ id: 'me', name: 'Alice' })], stack: [], youPlayerId: null,
    };
  }

  // 3× Verdant Catacombs (eligible) + 2× Island (ineligible) + 1× Forest
  // (eligible). 6 instances, 3 unique names.
  function dupLibrary(): { libraryView: CardSnapshot[]; candidates: CardSnapshot[] } {
    const cat1 = card({ instanceId: 'cat-1', name: 'Verdant Catacombs', types: ['Land'] });
    const cat2 = card({ instanceId: 'cat-2', name: 'Verdant Catacombs', types: ['Land'] });
    const cat3 = card({ instanceId: 'cat-3', name: 'Verdant Catacombs', types: ['Land'] });
    const isl1 = card({ instanceId: 'isl-1', name: 'Island', types: ['Land'] });
    const isl2 = card({ instanceId: 'isl-2', name: 'Island', types: ['Land'] });
    const forest = card({ instanceId: 'for-1', name: 'Forest', types: ['Land'] });
    const libraryView = [cat1, isl1, cat2, forest, isl2, cat3];
    // Eligibility is by card identity (fetchland fetches duals/Catacombs etc.);
    // here Catacombs + Forest are eligible, Islands are not.
    const candidates = [cat1, cat2, cat3, forest];
    return { libraryView, candidates };
  }

  it('groups duplicates into ONE app-card-tile per unique name with a count badge', () => {
    const { libraryView, candidates } = dupLibrary();
    const { fixture } = mountOverlay(
      makeState(), ['ChooseLibraryPickCommand'], ['me'], { candidates, libraryView, label: 'a land' },
    );
    const el = fixture.nativeElement as HTMLElement;

    // 3 unique names → 3 tiles (NOT 6 instance rows).
    const tiles = el.querySelectorAll('app-card-tile');
    expect(tiles.length).toBe(3);

    // 2 eligible stacks (Verdant Catacombs, Forest), 1 muted stack (Island).
    const eligibleStacks = el.querySelectorAll('[data-eligible="true"]');
    const mutedStacks = el.querySelectorAll('[data-muted="true"]');
    expect(eligibleStacks.length).toBe(2);
    expect(mutedStacks.length).toBe(1);

    // The Catacombs stack shows a "3" count badge; Island shows "2".
    const catStack = el.querySelector('[data-stack-name="Verdant Catacombs"]') as HTMLElement;
    expect(catStack.querySelector('[data-count-badge]')?.textContent?.trim()).toBe('3');
    const islStack = el.querySelector('[data-stack-name="Island"]') as HTMLElement;
    expect(islStack.querySelector('[data-count-badge]')?.textContent?.trim()).toBe('2');
    // Forest is a singleton — no badge (count input 0 hides it).
    const forStack = el.querySelector('[data-stack-name="Forest"]') as HTMLElement;
    expect(forStack.querySelector('[data-count-badge]')).toBeNull();
  });

  it('clicking an eligible stack selects ONE eligible instanceId of that name + shows the ring', () => {
    const { libraryView, candidates } = dupLibrary();
    const { component, fixture } = mountOverlay(
      makeState(), ['ChooseLibraryPickCommand'], ['me'], { candidates, libraryView },
    );
    const el = fixture.nativeElement as HTMLElement;
    const catStack = el.querySelector('[data-stack-name="Verdant Catacombs"]') as HTMLButtonElement;
    expect(catStack.tagName.toLowerCase()).toBe('button');

    catStack.click();
    fixture.detectChanges();

    // Selection resolves to one of the Catacombs instances.
    expect(['cat-1', 'cat-2', 'cat-3']).toContain(component.selectedLibraryInstanceId());
    // The clicked stack shows the selected amber ring.
    expect(catStack.classList.contains('ring-2')).toBe(true);
    expect(catStack.classList.contains('ring-amber-400')).toBe(true);

    // Confirm emits the single picked instanceId (wire shape unchanged).
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));
    component.confirmLibraryPick();
    expect(captured).toHaveLength(1);
    expect(captured[0].kind).toBe('libraryPick');
    expect(['cat-1', 'cat-2', 'cat-3']).toContain(captured[0].selectedInstanceId);
  });

  it('muted (ineligible) stacks render data-muted as non-clickable divs', () => {
    const { libraryView, candidates } = dupLibrary();
    const { component, fixture } = mountOverlay(
      makeState(), ['ChooseLibraryPickCommand'], ['me'], { candidates, libraryView },
    );
    const el = fixture.nativeElement as HTMLElement;
    const islStack = el.querySelector('[data-stack-name="Island"]') as HTMLElement;
    expect(islStack.getAttribute('data-muted')).toBe('true');
    expect(islStack.tagName.toLowerCase()).toBe('div');

    islStack.click();
    fixture.detectChanges();
    expect(component.selectedLibraryInstanceId()).toBeNull();
  });

  it('filter still narrows the stacks by name', () => {
    const { libraryView, candidates } = dupLibrary();
    const { component, fixture } = mountOverlay(
      makeState(), ['ChooseLibraryPickCommand'], ['me'], { candidates, libraryView },
    );
    component.libraryPickFilter.set('catacombs');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const tiles = el.querySelectorAll('app-card-tile');
    // Only the Verdant Catacombs stack survives the filter.
    expect(tiles.length).toBe(1);
    expect(el.querySelector('[data-stack-name="Verdant Catacombs"]')).toBeTruthy();
    expect(el.querySelector('[data-stack-name="Island"]')).toBeNull();
  });

  it('keeps the dual buttons (no banner/OK) when something is eligible, alongside the stacks', () => {
    const { libraryView, candidates } = dupLibrary();
    const { fixture } = mountOverlay(
      makeState(), ['ChooseLibraryPickCommand'], ['me'], { candidates, libraryView },
    );
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="library-pick-empty-banner"]')).toBeNull();
    expect(el.querySelector('[data-testid="library-pick-acknowledge"]')).toBeNull();
    const labels = Array.from(el.querySelectorAll('button')).map(b => b.textContent?.trim());
    expect(labels).toContain('Search and pick');
    expect(labels).toContain('Pick nothing');
  });

  it('zero eligible: banner + OK, every (grouped) stack muted', () => {
    const islandOnly = card({ instanceId: 'isl-x', name: 'Island', types: ['Land'] });
    const islandTwo = card({ instanceId: 'isl-y', name: 'Island', types: ['Land'] });
    const { fixture } = mountOverlay(
      makeState(), ['ChooseLibraryPickCommand'], ['me'],
      { candidates: [], libraryView: [islandOnly, islandTwo] },
    );
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="library-pick-empty-banner"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="library-pick-acknowledge"]')).toBeTruthy();
    expect(el.querySelectorAll('[data-eligible="true"]').length).toBe(0);
    // 2 Islands → ONE muted stack with a "2" badge.
    expect(el.querySelectorAll('[data-muted="true"]').length).toBe(1);
    const islStack = el.querySelector('[data-stack-name="Island"]') as HTMLElement;
    expect(islStack.querySelector('[data-count-badge]')?.textContent?.trim()).toBe('2');
  });

  it('fallback flat list (no libraryView) renders an art tile per candidate', () => {
    const elf = card({ instanceId: 'elf-1', name: 'Llanowar Elves' });
    const bop = card({ instanceId: 'bop-1', name: 'Birds of Paradise' });
    const { component, fixture } = mountOverlay(
      makeState(), ['ChooseLibraryPickCommand'], ['me'], { candidates: [elf, bop], label: 'green creature' },
    );
    expect(component.hasLibraryView()).toBe(false);

    const el = fixture.nativeElement as HTMLElement;
    const tiles = el.querySelectorAll('app-card-tile');
    expect(tiles.length).toBe(2);
    const tileText = Array.from(tiles).map(t => (t as HTMLElement).textContent ?? '');
    expect(tileText.some(t => t.includes('Llanowar Elves'))).toBe(true);
    expect(tileText.some(t => t.includes('Birds of Paradise'))).toBe(true);

    // Selection toggle still works on the tile button.
    const firstBtn = el.querySelector('button') as HTMLButtonElement;
    firstBtn.click();
    fixture.detectChanges();
    expect(component.selectedLibraryInstanceId()).not.toBeNull();
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
// CR 701.20 — scry prompts (fetchland scry 1, Preordain scry 2, et al.).
// Surveil's near-twin: non-kept cards go to the BOTTOM of the library
// rather than the graveyard. Mirrors the surveil block above.
// -----------------------------------------------------------------------

describe('PromptOverlayComponent — scry prompt (CR 701.20)', () => {
  function me(): GamePlayer {
    return player({ id: 'me', name: 'Alice' });
  }
  function state(): GameState {
    return {
      phase: 'Main', turnNumber: 3, activePlayerId: 'me',
      players: [me()], stack: [], youPlayerId: null,
    };
  }

  it('detects scry kind from server "ChooseScryCommand" envelope', () => {
    const peeked = [card({ instanceId: 'top-1', name: 'Forest' })];
    const { component } = mountOverlay(
      state(),
      ['ChooseScryCommand'],
      ['me'],
      { scryView: peeked, label: 'scry 1' },
    );

    expect(component.kind()).toBe('scry');
    expect(component.titleFor(component.kind())).toBe('Scry');
  });

  it('exposes envelope scryView to the modal computed', () => {
    const a = card({ instanceId: 'a', name: 'Forest' });
    const b = card({ instanceId: 'b', name: 'Mountain' });
    const { component } = mountOverlay(
      state(),
      ['ChooseScryCommand'],
      ['me'],
      { scryView: [a, b], label: 'scry 2' },
    );

    expect(component.scryPeeked()).toHaveLength(2);
    expect(component.scryPeeked()[0].instanceId).toBe('a');
    expect(component.scryReady()).toBe(false);
  });

  it('confirm is disabled until every peeked card has a decision', () => {
    const a = card({ instanceId: 'a', name: 'Forest' });
    const b = card({ instanceId: 'b', name: 'Mountain' });
    const { component } = mountOverlay(
      state(),
      ['ChooseScryCommand'],
      ['me'],
      { scryView: [a, b], label: 'scry 2' },
    );

    component.setScryDecision('a', 'bottom');
    expect(component.scryReady()).toBe(false);
    component.setScryDecision('b', 'top');
    expect(component.scryReady()).toBe(true);
  });

  it('toggling the same choice clears it (forcing the player to re-pick before Confirm)', () => {
    const a = card({ instanceId: 'a', name: 'Forest' });
    const { component } = mountOverlay(
      state(),
      ['ChooseScryCommand'],
      ['me'],
      { scryView: [a], label: 'scry 1' },
    );

    component.setScryDecision('a', 'bottom');
    expect(component.scryDecisions()['a']).toBe('bottom');
    component.setScryDecision('a', 'bottom');
    expect(component.scryDecisions()['a']).toBeUndefined();
    expect(component.scryReady()).toBe(false);
  });

  it('confirmScry emits the partition and resets decision state', () => {
    // Peeked order: a, b, c (top-to-bottom). Player keeps b on top, sends
    // a + c to the bottom. Wire payload preserves topOrder in the peeked-
    // list's natural order so index 0 of topOrderInstanceIds becomes the
    // new top of library.
    const a = card({ instanceId: 'a', name: 'Forest' });
    const b = card({ instanceId: 'b', name: 'Mountain' });
    const c = card({ instanceId: 'c', name: 'Island' });
    const { component } = mountOverlay(
      state(),
      ['ChooseScryCommand'],
      ['me'],
      { scryView: [a, b, c], label: 'scry 3' },
    );
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.setScryDecision('a', 'bottom');
    component.setScryDecision('b', 'top');
    component.setScryDecision('c', 'bottom');
    component.confirmScry();

    expect(captured).toEqual([
      {
        kind: 'scry',
        toBottomInstanceIds: ['a', 'c'],
        topOrderInstanceIds: ['b'],
      },
    ]);
    // Resets so a subsequent scry prompt starts clean.
    expect(component.scryDecisions()).toEqual({});
  });

  it('all-to-bottom partition: empty topOrder, every peeked id in toBottom', () => {
    // Common shape for "no upside" hands and bot-default behaviour.
    const a = card({ instanceId: 'a', name: 'Forest' });
    const b = card({ instanceId: 'b', name: 'Mountain' });
    const { component } = mountOverlay(
      state(),
      ['ChooseScryCommand'],
      ['me'],
      { scryView: [a, b], label: 'scry 2' },
    );
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.setScryDecision('a', 'bottom');
    component.setScryDecision('b', 'bottom');
    component.confirmScry();

    expect(captured).toEqual([
      {
        kind: 'scry',
        toBottomInstanceIds: ['a', 'b'],
        topOrderInstanceIds: [],
      },
    ]);
  });

  it('all-to-top partition: empty toBottom, peeked ids preserve top order', () => {
    // Scry-specific shape: keep everything where it is (a strong top of
    // library). topOrderInstanceIds preserves the peeked top-to-bottom
    // order; toBottom is empty.
    const a = card({ instanceId: 'a', name: 'Forest' });
    const b = card({ instanceId: 'b', name: 'Mountain' });
    const { component } = mountOverlay(
      state(),
      ['ChooseScryCommand'],
      ['me'],
      { scryView: [a, b], label: 'scry 2' },
    );
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.setScryDecision('a', 'top');
    component.setScryDecision('b', 'top');
    component.confirmScry();

    expect(captured).toEqual([
      {
        kind: 'scry',
        toBottomInstanceIds: [],
        topOrderInstanceIds: ['a', 'b'],
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

// CR 701.15 — reveal-and-choose modal (Malevolent Rumble, Impulse,
// Sleight of Hand, See the Unwritten, …). Engine ships the FULL reveal
// pile + an eligible subset; portal highlights eligible / mutes the
// rest, gives Done + (when optional) Decline. NO Cancel — the reveal is
// mid-resolve, not mid-cast.
describe('PromptOverlayComponent — reveal-and-choose prompt (CR 701.15)', () => {
  function mountReveal(revealed: CardSnapshot[], eligibleIds: string[], optional: boolean, label = 'Permanent to put into hand') {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'PreCombatMain', turnNumber: 3, activePlayerId: 'me',
      players: [me, opp], stack: [], youPlayerId: null,
    };
    return mountOverlay(state, ['ChooseFromRevealedCommand'], ['me'], {
      revealView: {
        revealed,
        eligibleInstanceIds: eligibleIds,
        optional,
        label,
      },
    });
  }

  it('detects revealPick kind from the server "ChooseFromRevealedCommand" envelope', () => {
    const bear = card({ instanceId: 'bear', name: 'Bear' });
    const { component } = mountReveal([bear], ['bear'], true);

    expect(component.kind()).toBe('revealPick');
    expect(component.titleFor(component.kind())).toBe('Choose from revealed cards');
  });

  it('renders every revealed card; eligible are interactive, non-eligible muted', () => {
    const bear = card({ instanceId: 'bear', name: 'Bear', types: ['Creature'] });
    const bolt = card({ instanceId: 'bolt', name: 'Bolt', types: ['Instant'] });
    const { fixture } = mountReveal([bolt, bear], ['bear'], true);

    const eligible = fixture.nativeElement.querySelectorAll('[data-eligible="true"]');
    const muted = fixture.nativeElement.querySelectorAll('[data-muted="true"]');
    expect(eligible.length).toBe(1);
    expect(muted.length).toBe(1);
    expect((eligible[0] as HTMLElement).getAttribute('data-instance-id')).toBe('bear');
    expect((muted[0] as HTMLElement).getAttribute('data-instance-id')).toBe('bolt');
  });

  it('renders one app-card-tile per revealed card (no grouping); names visible', () => {
    const bear = card({ instanceId: 'bear', name: 'Bear', types: ['Creature'] });
    const bolt = card({ instanceId: 'bolt', name: 'Bolt', types: ['Instant'] });
    // Two copies of the same name must NOT collapse — reveal order matters.
    const bolt2 = card({ instanceId: 'bolt2', name: 'Bolt', types: ['Instant'] });
    const { fixture } = mountReveal([bolt, bear, bolt2], ['bear'], true);
    const el = fixture.nativeElement as HTMLElement;

    const tiles = el.querySelectorAll('app-card-tile');
    expect(tiles.length).toBe(3);
    const tileText = Array.from(tiles).map(t => (t as HTMLElement).textContent ?? '');
    expect(tileText.filter(t => t.includes('Bolt')).length).toBe(2);
    expect(tileText.some(t => t.includes('Bear'))).toBe(true);

    // The eligible tile is a button + carries data-instance-id; muted are divs.
    const eligible = el.querySelector('[data-eligible="true"]') as HTMLElement;
    expect(eligible.tagName.toLowerCase()).toBe('button');
    expect(eligible.getAttribute('data-instance-id')).toBe('bear');
  });

  it('clicking an eligible reveal tile shows the selected ring', () => {
    const bear = card({ instanceId: 'bear', name: 'Bear' });
    const { component, fixture } = mountReveal([bear], ['bear'], true);
    const el = fixture.nativeElement as HTMLElement;
    const btn = el.querySelector('[data-eligible="true"]') as HTMLButtonElement;

    btn.click();
    fixture.detectChanges();

    expect(component.selectedRevealInstanceId()).toBe('bear');
    expect(btn.classList.contains('ring-2')).toBe(true);
    expect(btn.classList.contains('ring-amber-400')).toBe(true);
  });

  it('clicking an eligible card + Done emits chooseFromRevealed with that instanceId', () => {
    const bear = card({ instanceId: 'bear', name: 'Bear' });
    const { component, fixture } = mountReveal([bear], ['bear'], true);
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    const eligibleBtn = fixture.nativeElement.querySelector(
      '[data-eligible="true"]') as HTMLButtonElement | null;
    expect(eligibleBtn).not.toBeNull();
    eligibleBtn!.click();
    fixture.detectChanges();

    const doneBtn = fixture.nativeElement.querySelector(
      '[data-testid="reveal-pick-confirm"]') as HTMLButtonElement | null;
    expect(doneBtn).not.toBeNull();
    expect(doneBtn!.disabled).toBe(false);
    doneBtn!.click();

    expect(captured).toEqual([{ kind: 'revealPick', pickedInstanceId: 'bear' }]);
  });

  it('Decline button emits chooseFromRevealed with null instanceId when optional', () => {
    const bear = card({ instanceId: 'bear', name: 'Bear' });
    const { component, fixture } = mountReveal([bear], ['bear'], true);
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    const declineBtn = fixture.nativeElement.querySelector(
      '[data-testid="reveal-pick-decline"]') as HTMLButtonElement | null;
    expect(declineBtn).not.toBeNull();
    declineBtn!.click();

    expect(captured).toEqual([{ kind: 'revealPick', pickedInstanceId: null }]);
  });

  it('hides Decline when prompt is mandatory AND eligible non-empty', () => {
    const bear = card({ instanceId: 'bear', name: 'Bear' });
    const { fixture } = mountReveal([bear], ['bear'], /* optional */ false);

    const declineBtn = fixture.nativeElement.querySelector(
      '[data-testid="reveal-pick-decline"]') as HTMLButtonElement | null;
    expect(declineBtn).toBeNull();
  });

  it('shows ONLY Decline when eligible is empty (even mandatory prompts)', () => {
    const bolt = card({ instanceId: 'bolt', name: 'Bolt', types: ['Instant'] });
    const { fixture } = mountReveal([bolt], [], /* optional */ false);

    const declineBtn = fixture.nativeElement.querySelector(
      '[data-testid="reveal-pick-decline"]') as HTMLButtonElement | null;
    const doneBtn = fixture.nativeElement.querySelector(
      '[data-testid="reveal-pick-confirm"]') as HTMLButtonElement | null;
    expect(declineBtn).not.toBeNull();
    expect(doneBtn).toBeNull();

    const banner = fixture.nativeElement.querySelector(
      '[data-testid="reveal-pick-empty-banner"]');
    expect(banner).not.toBeNull();
  });

  it('Cancel button is hidden on revealPick (mid-resolve, not mid-cast)', () => {
    const bear = card({ instanceId: 'bear', name: 'Bear' });
    const { component } = mountReveal([bear], ['bear'], true);

    expect(component.showCancelButton()).toBe(false);
  });

  it('clicking a muted (non-eligible) card does nothing', () => {
    const bolt = card({ instanceId: 'bolt', name: 'Bolt', types: ['Instant'] });
    const bear = card({ instanceId: 'bear', name: 'Bear' });
    const { component, fixture } = mountReveal([bolt, bear], ['bear'], true);

    const muted = fixture.nativeElement.querySelector(
      '[data-muted="true"]') as HTMLElement | null;
    expect(muted).not.toBeNull();
    // Muted cards aren't <button>; they're <div> with no click handler.
    expect(muted!.tagName.toLowerCase()).toBe('div');
    expect(component.selectedRevealInstanceId()).toBeNull();
  });
});

describe('PromptOverlayComponent — mulligan bottom', () => {
  function bottomSetup(handCards: CardSnapshot[], bottomCount?: number) {
    const me = player({ id: 'me', name: 'Alice', hand: { cards: handCards } });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'Mulligan', turnNumber: 1, activePlayerId: 'me',
      players: [me, opp], stack: [], youPlayerId: 'me',
    };
    return mountOverlay(state, ['ChooseCardsToBottomCommand'], ['me'], { bottomCount });
  }

  const hand = [
    card({ instanceId: 'c1', name: 'Forest' }),
    card({ instanceId: 'c2', name: 'Young Wolf' }),
    card({ instanceId: 'c3', name: 'Endurance' }),
  ];

  it('routes to the bottom kind and titles with the count (singular)', () => {
    const { component } = bottomSetup(hand, 1);
    expect(component.kind()).toBe('bottom');
    expect(component.requiredBottom()).toBe(1);
    expect(component.titleFor('bottom')).toBe('Bottom 1 card');
  });

  it('pluralizes the title when count > 1', () => {
    const { component } = bottomSetup(hand, 2);
    expect(component.titleFor('bottom')).toBe('Bottom 2 cards');
  });

  it('enables confirm only at EXACTLY the required count; deselect re-disables', () => {
    const { component } = bottomSetup(hand, 1);
    expect(component.canConfirmBottom()).toBe(false);           // 0 selected
    component.toggle('c1');
    expect(component.canConfirmBottom()).toBe(true);            // exactly 1
    component.toggle('c2');
    expect(component.canConfirmBottom()).toBe(false);           // 2 > 1
    component.toggle('c2');
    expect(component.canConfirmBottom()).toBe(true);            // back to 1
    component.toggle('c1');
    expect(component.canConfirmBottom()).toBe(false);           // deselected → 0
  });

  it('marks the selection full at the cap so extra cards can be disabled', () => {
    const { component } = bottomSetup(hand, 2);
    expect(component.bottomSelectionFull()).toBe(false);
    component.toggle('c1');
    expect(component.bottomSelectionFull()).toBe(false);        // 1 < 2
    component.toggle('c2');
    expect(component.bottomSelectionFull()).toBe(true);         // 2 == 2 → cap
  });

  it('falls back gracefully when the server sends no count (older build)', () => {
    const { component } = bottomSetup(hand, undefined);
    expect(component.requiredBottom()).toBeNull();
    expect(component.canConfirmBottom()).toBe(false);           // nothing selected
    component.toggle('c1');
    expect(component.canConfirmBottom()).toBe(true);            // any >0 selection
    expect(component.bottomSelectionFull()).toBe(false);        // no cap without a count
  });
});

// CR 700.6 / 701.x — generic declarative-choice prompt (ChoiceCommand).
// When a human activates an ability that issues a "pick one creature"
// choice (Yawgmoth's "Sacrifice another creature" cost, Grist, MDFC/Gift/
// Sungold Sentinel, Suppression Ray, Serra's Emissary, …), the server
// sends a generic ChoiceCommand prompt: expectedKinds contains the literal
// "ChoiceCommand", the pickable cards ride on candidates, and a choiceView
// descriptor carries { kind, min, max }. Before this fix the portal never
// rendered it and the player wedged holding priority (core PR #2959).
describe('PromptOverlayComponent — generic choice prompt (CR 700.6 / 701.x)', () => {
  // detectKind ordering: the generic ChoiceCommand must NOT shadow a more
  // specific command type. These pure-function assertions lock that in.
  it('detectKind maps ["ChoiceCommand"] to choice', () => {
    expect(detectKind(['ChoiceCommand'])).toBe('choice');
  });

  it('detectKind keeps specific kinds winning over the generic choice catch', () => {
    // Each specific command type must resolve to its dedicated kind even
    // though it is detected before the generic ChoiceCommand branch.
    expect(detectKind(['ChooseYesNoCommand'])).toBe('yesNo');
    expect(detectKind(['ChooseLibraryPickCommand'])).toBe('libraryPick');
    expect(detectKind(['ChooseSurveilCommand'])).toBe('surveil');
    expect(detectKind(['ChooseScryCommand'])).toBe('scry');
    expect(detectKind(['ChooseFromRevealedCommand'])).toBe('revealPick');
    expect(detectKind(['ChooseTargetsCommand'])).toBe('targets');
    expect(detectKind(['DeclareAttackersCommand'])).toBe('attackers');
    expect(detectKind(['DeclareBlockersCommand'])).toBe('blockers');
    expect(detectKind(['ChooseModeCommand'])).toBe('mode');
    expect(detectKind(['ChooseManaCommand'])).toBe('mana');
  });

  function makeState(me: GamePlayer, opp: GamePlayer): GameState {
    return { phase: 'Main', turnNumber: 4, activePlayerId: 'me', players: [me, opp], stack: [], youPlayerId: null };
  }

  it('detects choice kind from the server "ChoiceCommand" envelope', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const { component } = mountOverlay(
      makeState(me, opp),
      ['ChoiceCommand'],
      ['me'],
      { candidates: [], choiceView: { kind: 'PickOne', min: 1, max: 1 } },
    );
    expect(component.kind()).toBe('choice');
  });

  it('exposes choiceView bounds + candidates to the picker computeds', () => {
    const fodder = card({ instanceId: 'fod-1', name: 'Carrion Feeder' });
    const ooze = card({ instanceId: 'ooze-2', name: 'Necrogen Mists' });
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const { component } = mountOverlay(
      makeState(me, opp),
      ['ChoiceCommand'],
      ['me'],
      { candidates: [fodder, ooze], choiceView: { kind: 'PickOne', min: 1, max: 1 } },
    );
    // Generic choice reuses the targets candidate machinery.
    expect(component.candidates()).toHaveLength(2);
    expect(component.choiceMin()).toBe(1);
    expect(component.choiceMax()).toBe(1);
    expect(component.choiceKindName()).toBe('PickOne');
  });

  it('confirm is gated to the choiceView min..max selection bounds', () => {
    const a = card({ instanceId: 'a', name: 'A' });
    const b = card({ instanceId: 'b', name: 'B' });
    const c = card({ instanceId: 'c', name: 'C' });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [a, b, c] } });
    const opp = player({ id: 'opp', name: 'Bob' });
    // PickN: pick at least 1, at most 2.
    const { component } = mountOverlay(
      makeState(me, opp),
      ['ChoiceCommand'],
      ['me'],
      { candidates: [a, b, c], choiceView: { kind: 'PickN', min: 1, max: 2 } },
    );
    expect(component.canConfirmChoice()).toBe(false);   // 0 < min
    component.toggle('a');
    expect(component.canConfirmChoice()).toBe(true);    // 1 in [1,2]
    component.toggle('b');
    expect(component.canConfirmChoice()).toBe(true);    // 2 in [1,2]
    component.toggle('c');
    expect(component.canConfirmChoice()).toBe(false);   // 3 > max
  });

  it('confirmChoice emits decision shaped for the wire ChoiceCommand', () => {
    const fodder = card({ instanceId: 'fod-1', name: 'Carrion Feeder' });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [fodder] } });
    const opp = player({ id: 'opp', name: 'Bob' });
    const { component } = mountOverlay(
      makeState(me, opp),
      ['ChoiceCommand'],
      ['me'],
      { candidates: [fodder], choiceView: { kind: 'PickOne', min: 1, max: 1 } },
    );
    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));

    component.toggle('fod-1');
    component.confirmChoice();

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      kind: 'choice',
      choiceKind: 'PickOne',
      selectedInstanceIds: ['fod-1'],
    });
    // Selection resets so it doesn't bleed into the next prompt.
    expect(component.selected()).toEqual([]);
  });

  it('titleFor("choice") falls back to a Choose label', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const { component } = mountOverlay(
      makeState(me, opp),
      ['ChoiceCommand'],
      ['me'],
      { candidates: [], choiceView: { kind: 'PickOne', min: 1, max: 1 } },
    );
    expect(component.titleFor('choice')).toBe('Choose');
  });
});

describe('PromptOverlayComponent — on-board selection banner', () => {
  it('renders the slim banner (not the candidate grid) for a board-resident targets prompt', () => {
    const z = card({ instanceId: 'z', name: 'Goblin' });
    const me = player({ id: 'me', name: 'Alice' });
    const foe = player({ id: 'foe', name: 'Bob', battlefield: { cards: [z] } });
    const state: GameState = { phase: 'Main1', turnNumber: 1, activePlayerId: 'me', players: [me, foe], stack: [], youPlayerId: null };

    const { fixture, selection } = mountOverlay(state, ['ChooseTargetsCommand'], ['me'], { candidates: [z], label: 'Bolt' });
    selection.setBoardInstanceIds(new Set(['z']));
    selection.setPrompt({ gameId: 'g', playerId: 'me', expectedKinds: ['ChooseTargetsCommand'], candidates: [z], label: 'Bolt' } as PromptEnvelope);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-banner="board-select"]')).toBeTruthy();
    expect(host.querySelector('[data-grid="targets"]')).toBeFalsy(); // grid suppressed
  });

  it('keeps the candidate grid for an off-board (mixed-zone) targets prompt', () => {
    const z = card({ instanceId: 'z', name: 'Goblin' });
    const me = player({ id: 'me', name: 'Alice' });
    const foe = player({ id: 'foe', name: 'Bob', battlefield: { cards: [z] } });
    const state: GameState = { phase: 'Main1', turnNumber: 1, activePlayerId: 'me', players: [me, foe], stack: [], youPlayerId: null };

    const { fixture, selection } = mountOverlay(state, ['ChooseTargetsCommand'], ['me'], { candidates: [z] });
    // 'offboard' not in the board set → mode() null → modal grid stays.
    selection.setBoardInstanceIds(new Set(['z']));
    selection.setPrompt({ gameId: 'g', playerId: 'me', expectedKinds: ['ChooseTargetsCommand'], candidates: [z, card({ instanceId: 'offboard' })] } as PromptEnvelope);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-banner="board-select"]')).toBeFalsy();
    expect(host.querySelector('[data-grid="targets"]')).toBeTruthy();
  });

  it('banner Done emits the targets decision shape from the shared selection set', () => {
    const z = card({ instanceId: 'z', name: 'Goblin' });
    const me = player({ id: 'me', name: 'Alice' });
    const foe = player({ id: 'foe', name: 'Bob', battlefield: { cards: [z] } });
    const state: GameState = { phase: 'Main1', turnNumber: 1, activePlayerId: 'me', players: [me, foe], stack: [], youPlayerId: null };

    const { component, selection } = mountOverlay(state, ['ChooseTargetsCommand'], ['me'], { candidates: [z] });
    selection.setBoardInstanceIds(new Set(['z']));
    selection.setPrompt({ gameId: 'g', playerId: 'me', expectedKinds: ['ChooseTargetsCommand'], candidates: [z] } as PromptEnvelope);
    selection.toggle('z');

    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));
    component.confirmBoardSelection(selection.mode()!);
    expect(captured).toEqual([{ kind: 'targets', targetInstanceIds: ['z'] }]);
  });
});

describe('PromptOverlayComponent — on-board combat confirm', () => {
  it('confirmBoardAttackers emits the wire DeclareAttackers shape (attacker + defenderId)', () => {
    const a = card({ instanceId: 'a', name: 'Bear' });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [a] } });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = { phase: 'DeclareAttackers', turnNumber: 1, activePlayerId: 'me', players: [me, opp], stack: [], youPlayerId: null };

    const { component, selection } = mountOverlay(state, ['DeclareAttackersCommand'], ['me']);
    selection.setPrompt({ gameId: 'g', playerId: 'me', expectedKinds: ['DeclareAttackersCommand'] } as PromptEnvelope);
    selection.toggle('a');

    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));
    component.confirmBoardAttackers();
    expect(captured).toEqual([{ kind: 'attackers', attackers: [{ attackerInstanceId: 'a', defenderId: 'opp' }] }]);
  });

  it('confirmBoardAttackers with an empty set is a valid "no attacks"', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = { phase: 'DeclareAttackers', turnNumber: 1, activePlayerId: 'me', players: [me, opp], stack: [], youPlayerId: null };

    const { component, selection } = mountOverlay(state, ['DeclareAttackersCommand'], ['me']);
    selection.setPrompt({ gameId: 'g', playerId: 'me', expectedKinds: ['DeclareAttackersCommand'] } as PromptEnvelope);

    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));
    component.confirmBoardAttackers();
    expect(captured).toEqual([{ kind: 'attackers', attackers: [] }]);
  });
});

describe('PromptOverlayComponent — on-board blocker confirm', () => {
  it('confirmBoardBlockers emits the wire DeclareBlockers shape from shared pairs', () => {
    const blk = card({ instanceId: 'blk', name: 'Wall' });
    const atk = card({ instanceId: 'atk', name: 'Ogre', tapped: true });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [blk] } });
    const foe = player({ id: 'foe', name: 'Bob', battlefield: { cards: [atk] } });
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'foe', players: [me, foe], stack: [], youPlayerId: null };

    const { component, selection } = mountOverlay(state, ['DeclareBlockersCommand'], ['me']);
    selection.setPrompt({ gameId: 'g', playerId: 'me', expectedKinds: ['DeclareBlockersCommand'] } as PromptEnvelope);
    selection.addBlockPair('blk', 'atk');

    const captured: PromptDecision[] = [];
    component.decision.subscribe(d => captured.push(d));
    component.confirmBoardBlockers();
    expect(captured).toEqual([{ kind: 'blockers', blockers: [{ blockerInstanceId: 'blk', attackerInstanceId: 'atk' }] }]);
  });
});

// -----------------------------------------------------------------------
// Mobile bottom-sheet: non-board prompts render as a bottom-anchored sheet
// on mobile (isMobileBoard() = true); desktop keeps the centered modal.
// The slim-banner boardMode() path is unchanged by this feature.
// -----------------------------------------------------------------------
describe('PromptOverlayComponent — bottom-sheet on mobile', () => {
  function vpStub(isMobile: boolean) {
    return { isMobileBoard: signal(isMobile), isPortrait: signal(false) } as unknown as ViewportService;
  }

  it('uses the bottom-sheet container for a non-board prompt on mobile', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'Main', turnNumber: 1, activePlayerId: 'me',
      players: [me, opp], stack: [], youPlayerId: null,
    };

    TestBed.configureTestingModule({
      imports: [PromptOverlayComponent],
      providers: [
        SelectionService,
        { provide: ViewportService, useValue: vpStub(true) },
      ],
    });
    const fixture = TestBed.createComponent(PromptOverlayComponent);
    const ref: ComponentRef<PromptOverlayComponent> = fixture.componentRef;
    ref.setInput('state', state);
    ref.setInput('prompt', {
      expectedKinds: ['ChooseYesNoCommand'],
      yesNoView: { question: 'Pay 2 life?' },
    });
    ref.setInput('selfPlayerIds', ['me']);
    fixture.detectChanges();

    const root = fixture.nativeElement.querySelector('.prompt-overlay') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.classList.contains('prompt-sheet')).toBe(true);
    expect(root.classList.contains('max-w-3xl')).toBe(false);
  });

  it('keeps the centered modal on desktop', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'Main', turnNumber: 1, activePlayerId: 'me',
      players: [me, opp], stack: [], youPlayerId: null,
    };

    TestBed.configureTestingModule({
      imports: [PromptOverlayComponent],
      providers: [
        SelectionService,
        { provide: ViewportService, useValue: vpStub(false) },
      ],
    });
    const fixture = TestBed.createComponent(PromptOverlayComponent);
    const ref: ComponentRef<PromptOverlayComponent> = fixture.componentRef;
    ref.setInput('state', state);
    ref.setInput('prompt', {
      expectedKinds: ['ChooseYesNoCommand'],
      yesNoView: { question: 'Pay 2 life?' },
    });
    ref.setInput('selfPlayerIds', ['me']);
    fixture.detectChanges();

    const root = fixture.nativeElement.querySelector('.prompt-overlay') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.classList.contains('max-w-3xl')).toBe(true);
    expect(root.classList.contains('prompt-sheet')).toBe(false);
  });
});

// Candidate cards in the target / choice (tutor) pickers render the
// Scryfall card ART via <app-card-tile> (name-box fallback when no image
// resolves — which is always the case in jsdom). The selection toggle,
// selected-state highlight, and the zone/controller caption must all
// survive the art treatment. Green Sun's Zenith / fetchland searches are
// the motivating callers.
describe('PromptOverlayComponent — candidate card art (target / choice pickers)', () => {
  function twoPlayerState(meCards: CardSnapshot[], oppCards: CardSnapshot[]): GameState {
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: meCards } });
    const opp = player({ id: 'opp', name: 'Bob', battlefield: { cards: oppCards } });
    return {
      phase: 'PreCombatMain', turnNumber: 1, activePlayerId: 'me',
      players: [me, opp], stack: [], youPlayerId: null,
    };
  }

  it('renders one app-card-tile per candidate in a targets prompt (not a bare name span)', () => {
    const myLand = card({ instanceId: 'my-land', name: 'Forest', types: ['Land'] });
    const enemyBear = card({ instanceId: 'enemy-bear', name: 'Grizzly Bears' });
    const state = twoPlayerState([myLand], [enemyBear]);

    const { fixture } = mountOverlay(
      state, ['ChooseTargetsCommand'], ['me'], { candidates: [myLand, enemyBear] },
    );

    const el = fixture.nativeElement as HTMLElement;
    const grid = el.querySelector('[data-grid="targets"]')!.parentElement as HTMLElement;
    const tiles = grid.querySelectorAll('app-card-tile');
    expect(tiles.length).toBe(2);

    // The art tile still surfaces the card name (placeholder text in jsdom)
    // so the player can read it even when no image resolves.
    const tileText = Array.from(tiles).map(t => (t as HTMLElement).textContent ?? '');
    expect(tileText.some(t => t.includes('Forest'))).toBe(true);
    expect(tileText.some(t => t.includes('Grizzly Bears'))).toBe(true);
    // The selectable button carries the candidate name as its aria-label.
    const btnLabels = Array.from(el.querySelectorAll('.candidate-tile'))
      .map(b => b.getAttribute('aria-label'));
    expect(btnLabels).toEqual(expect.arrayContaining(['Forest', 'Grizzly Bears']));
  });

  it('keeps the zone/controller caption alongside the art in a targets prompt', () => {
    const myLand = card({ instanceId: 'my-land', name: 'Forest', types: ['Land'] });
    const state = twoPlayerState([myLand], []);

    const { fixture } = mountOverlay(
      state, ['ChooseTargetsCommand'], ['me'], { candidates: [myLand] },
    );

    const el = fixture.nativeElement as HTMLElement;
    const caption = el.querySelector('.candidate-caption') as HTMLElement;
    expect(caption).toBeTruthy();
    expect(caption.textContent).toContain('(battlefield)');
    expect(caption.textContent).toContain('Alice');
  });

  it('selection toggle still works on the art tile button (targets)', () => {
    const myLand = card({ instanceId: 'my-land', name: 'Forest', types: ['Land'] });
    const state = twoPlayerState([myLand], []);

    const { component, fixture } = mountOverlay(
      state, ['ChooseTargetsCommand'], ['me'], { candidates: [myLand] },
    );

    const el = fixture.nativeElement as HTMLElement;
    const btn = el.querySelector('.candidate-tile') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-pressed')).toBe('false');

    btn.click();
    fixture.detectChanges();

    expect(component.isSelected('my-land')).toBe(true);
    expect(component.selected()).toEqual(['my-land']);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toBe('Forest');
    // Selected highlight reads as a ring around the art.
    expect(btn.classList.contains('ring-2')).toBe(true);
  });

  it('renders one app-card-tile per candidate in a choice (tutor) prompt', () => {
    const fodder = card({ instanceId: 'fod-1', name: 'Carrion Feeder' });
    const ooze = card({ instanceId: 'ooze-1', name: 'Scavenging Ooze' });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [fodder, ooze] } });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'Main', turnNumber: 4, activePlayerId: 'me',
      players: [me, opp], stack: [], youPlayerId: null,
    };

    const { fixture } = mountOverlay(
      state, ['ChoiceCommand'], ['me'],
      { candidates: [fodder, ooze], choiceView: { kind: 'PickN', min: 1, max: 2 } },
    );

    const el = fixture.nativeElement as HTMLElement;
    const grid = el.querySelector('[data-grid="choice"]')!.parentElement as HTMLElement;
    const tiles = grid.querySelectorAll('app-card-tile');
    expect(tiles.length).toBe(2);

    const caption = el.querySelector('.candidate-caption') as HTMLElement;
    expect(caption).toBeTruthy();
    expect(caption.textContent).toContain('(battlefield)');
  });

  it('selection toggle + count still works on the art tile button (choice)', () => {
    const fodder = card({ instanceId: 'fod-1', name: 'Carrion Feeder' });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [fodder] } });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = {
      phase: 'Main', turnNumber: 4, activePlayerId: 'me',
      players: [me, opp], stack: [], youPlayerId: null,
    };

    const { component, fixture } = mountOverlay(
      state, ['ChoiceCommand'], ['me'],
      { candidates: [fodder], choiceView: { kind: 'PickOne', min: 1, max: 1 } },
    );

    const el = fixture.nativeElement as HTMLElement;
    const btn = el.querySelector('.candidate-tile') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(component.canConfirmChoice()).toBe(false);

    btn.click();
    fixture.detectChanges();

    expect(component.isSelected('fod-1')).toBe(true);
    expect(component.selected()).toEqual(['fod-1']);
    expect(component.canConfirmChoice()).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });
});
