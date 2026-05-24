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

function mountOverlay(state: GameState | null, kinds: string[], selfPlayerIds: string[]) {
  TestBed.configureTestingModule({ imports: [PromptOverlayComponent] });
  const fixture = TestBed.createComponent(PromptOverlayComponent);
  const ref: ComponentRef<PromptOverlayComponent> = fixture.componentRef;
  ref.setInput('state', state);
  ref.setInput('prompt', { expectedKinds: kinds });
  ref.setInput('selfPlayerIds', selfPlayerIds);
  fixture.detectChanges();
  return { component: fixture.componentInstance, fixture };
}

describe('PromptOverlayComponent — combat prompts', () => {
  it('detects attackers kind from server "DeclareAttackersCommand" envelope', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = { phase: 'DeclareAttackers', turnNumber: 1, activePlayerId: 'me', players: [me, opp], stack: [] };

    const { component } = mountOverlay(state, ['DeclareAttackersCommand'], ['me']);

    expect(component.kind()).toBe('attackers');
    expect(component.titleFor(component.kind())).toBe('Declare attackers');
  });

  it('detects blockers kind from server "DeclareBlockersCommand" envelope', () => {
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [] };

    const { component } = mountOverlay(state, ['DeclareBlockersCommand'], ['me']);

    expect(component.kind()).toBe('blockers');
    expect(component.titleFor(component.kind())).toBe('Declare blockers');
  });

  it('confirmAttackers emits decision shaped for the wire DeclareAttackersCommand', () => {
    const bear = card({ instanceId: 'bear-1', name: 'Grizzly Bears' });
    const goblin = card({ instanceId: 'goblin-2', name: 'Goblin' });
    const me = player({ id: 'me', name: 'Alice', battlefield: { cards: [bear, goblin] } });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = { phase: 'DeclareAttackers', turnNumber: 1, activePlayerId: 'me', players: [me, opp], stack: [] };

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
    const state: GameState = { phase: 'DeclareAttackers', turnNumber: 1, activePlayerId: 'me', players: [me, opp], stack: [] };

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
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [] };

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
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [] };

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
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [] };

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
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [] };

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
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [] };

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
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [] };

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
    const state: GameState = { phase: 'BeginningOfGame', turnNumber: 0, activePlayerId: 'me', players: [me, opp], stack: [] };

    const { component, fixture } = mountOverlay(state, ['MulliganCommand'], ['me']);
    expect(component.kind()).toBe('mulligan');

    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    const labels = Array.from(buttons).map(b => (b.textContent ?? '').trim());
    expect(labels).toEqual(expect.arrayContaining(['Keep', 'Mulligan']));
    expect(labels).not.toContain('Cancel');
  });

  it('non-mulligan prompts still render Cancel (opt-out remains legal there)', () => {
    // Sanity-check the fix didn't strip Cancel globally — declare-attackers
    // is one example where the player can still bail on the prompt UI.
    const me = player({ id: 'me', name: 'Alice' });
    const opp = player({ id: 'opp', name: 'Bob' });
    const state: GameState = { phase: 'DeclareAttackers', turnNumber: 1, activePlayerId: 'me', players: [me, opp], stack: [] };

    const { fixture } = mountOverlay(state, ['DeclareAttackersCommand'], ['me']);

    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    const labels = Array.from(buttons).map(b => (b.textContent ?? '').trim());
    expect(labels).toContain('Cancel');
  });

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
      players: [me, opp], stack: [],
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
      players: [me, opp], stack: [],
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
      players: [me, opp], stack: [],
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
      players: [me, opp], stack: [],
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
    const state: GameState = { phase: 'DeclareBlockers', turnNumber: 1, activePlayerId: 'opp', players: [me, opp], stack: [] };

    const { component } = mountOverlay(state, ['DeclareBlockersCommand'], ['me']);

    const list = component.attackerList();
    expect(list).toHaveLength(1);
    expect(list[0].instanceId).toBe('atk-1');
  });
});
