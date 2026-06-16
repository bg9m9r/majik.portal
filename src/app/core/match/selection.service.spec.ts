import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SelectionService } from './selection.service';
import type { PromptEnvelope } from './match.types';

function prompt(p: Partial<PromptEnvelope>): PromptEnvelope {
  return { gameId: 'g', playerId: 'p', expectedKinds: [], ...p };
}

describe('SelectionService', () => {
  let svc: SelectionService;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SelectionService] });
    svc = TestBed.inject(SelectionService);
  });

  it('derives a targets selection mode from a board-resident candidate pool', () => {
    svc.setBoardInstanceIds(new Set(['a', 'b', 'c']));
    svc.setPrompt(prompt({
      expectedKinds: ['ChooseTargetsCommand'],
      candidates: [{ instanceId: 'a' } as never, { instanceId: 'b' } as never],
      label: 'Bolt: any target',
    }));
    const m = svc.mode();
    expect(m?.kind).toBe('targets');
    expect([...(m!.candidateIds)].sort()).toEqual(['a', 'b']);
    expect(m!.min).toBe(1);
    expect(m!.max).toBe(1);
    expect(m!.cancellable).toBe(true);
    expect(m!.sourceLabel).toBe('Bolt: any target');
  });

  it('falls back to no selection mode when a candidate is not board-locatable', () => {
    svc.setBoardInstanceIds(new Set(['a']));
    svc.setPrompt(prompt({
      expectedKinds: ['ChooseTargetsCommand'],
      candidates: [{ instanceId: 'a' } as never, { instanceId: 'offboard' } as never],
    }));
    expect(svc.mode()).toBeNull(); // modal handles it
  });

  it('falls back to no selection mode when the targets prompt ships no candidate pool', () => {
    svc.setBoardInstanceIds(new Set(['a']));
    svc.setPrompt(prompt({ expectedKinds: ['ChooseTargetsCommand'] }));
    expect(svc.mode()).toBeNull();
  });

  it('uses choiceView min/max for a choice prompt', () => {
    svc.setBoardInstanceIds(new Set(['x', 'y']));
    svc.setPrompt(prompt({
      expectedKinds: ['ChoiceCommand'],
      candidates: [{ instanceId: 'x' } as never, { instanceId: 'y' } as never],
      choiceView: { kind: 'PickOne', min: 1, max: 1 },
      label: 'Choose a creature to sacrifice',
    }));
    const m = svc.mode();
    expect(m?.kind).toBe('choice');
    expect(m?.choiceKind).toBe('PickOne');
    expect(m?.min).toBe(1);
    expect(m?.max).toBe(1);
    expect(m?.cancellable).toBe(false);
  });

  it('derives an open-ended attackers mode from a combat prompt', () => {
    svc.setPrompt(prompt({ expectedKinds: ['DeclareAttackersCommand'], label: 'Declare attackers' }));
    const m = svc.mode();
    expect(m?.kind).toBe('attackers');
    expect(m?.min).toBe(0);
    expect(m?.max).toBe(Number.MAX_SAFE_INTEGER);
    expect(m?.cancellable).toBe(false);
  });

  it('derives an open-ended blockers mode from a combat prompt', () => {
    svc.setPrompt(prompt({ expectedKinds: ['DeclareBlockersCommand'], label: 'Declare blockers' }));
    expect(svc.mode()?.kind).toBe('blockers');
  });

  it('returns null mode for off-board prompt kinds', () => {
    svc.setPrompt(prompt({ expectedKinds: ['MulliganCommand'] }));
    expect(svc.mode()).toBeNull();
    svc.setPrompt(prompt({ expectedKinds: ['ChooseLibraryPickCommand'] }));
    expect(svc.mode()).toBeNull();
  });

  it('toggles selection and resets when the prompt changes', () => {
    svc.setBoardInstanceIds(new Set(['a', 'b']));
    svc.setPrompt(prompt({ expectedKinds: ['ChooseTargetsCommand'], candidates: [{ instanceId: 'a' } as never, { instanceId: 'b' } as never] }));
    svc.toggle('a');
    expect(svc.selected()).toEqual(['a']);
    svc.setPrompt(prompt({ expectedKinds: ['ChooseTargetsCommand'], candidates: [{ instanceId: 'a' } as never] }));
    expect(svc.selected()).toEqual([]); // reset on prompt change
  });

  it('drops a selected id that is no longer a candidate when the prompt updates', () => {
    svc.setBoardInstanceIds(new Set(['a', 'b']));
    svc.setPrompt(prompt({ expectedKinds: ['ChooseTargetsCommand'], candidates: [{ instanceId: 'a' } as never, { instanceId: 'b' } as never] }));
    svc.toggle('a');
    // Re-prompt without 'a' as a candidate → the full selection resets.
    svc.setPrompt(prompt({ expectedKinds: ['ChooseTargetsCommand'], candidates: [{ instanceId: 'b' } as never] }));
    expect(svc.selected()).toEqual([]);
  });

  it('treats an optional (min 0) choice as declinable with an empty set', () => {
    svc.setBoardInstanceIds(new Set(['a']));
    svc.setPrompt(prompt({
      expectedKinds: ['ChoiceCommand'],
      candidates: [{ instanceId: 'a' } as never],
      choiceView: { kind: 'PickN', min: 0, max: 1 },
    }));
    const m = svc.mode();
    expect(m?.min).toBe(0);
    expect(svc.selected()).toEqual([]); // Done at 0 = decline (empty set)
  });

  it('resets combat pairs and pending blocker when the prompt changes', () => {
    svc.setPrompt(prompt({ expectedKinds: ['DeclareBlockersCommand'] }));
    svc.setPendingBlocker('blk');
    svc.addBlockPair('blk', 'atk');
    expect(svc.blockPairs()).toEqual([{ blockerInstanceId: 'blk', attackerInstanceId: 'atk' }]);
    svc.setPrompt(prompt({ expectedKinds: ['DeclareBlockersCommand'] }));
    expect(svc.blockPairs()).toEqual([]);
    expect(svc.pendingBlocker()).toBeNull();
  });
});
