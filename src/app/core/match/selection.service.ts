import { Injectable, computed, signal } from '@angular/core';
import type { PromptEnvelope, SelectionMode } from './match.types';

// In-scope prompt kinds for on-board click-to-select. Everything else
// (libraryPick, surveil, scry, yesNo, x, mana, mode, mulligan, bottom,
// revealPick) stays on the existing modal grid.
export const BOARD_SELECT_KINDS = ['targets', 'choice', 'attackers', 'blockers'] as const;
export type BoardSelectKind = (typeof BOARD_SELECT_KINDS)[number];

// Sentinel max for open-ended set declarations (attackers/blockers): there
// is no upper bound on how many creatures you may declare.
const OPEN_ENDED = Number.MAX_SAFE_INTEGER;

/**
 * Single owner of in-flight on-board selection state. Both the board
 * component (clicks + affordance) and the prompt-overlay banner (Done /
 * Confirm / Cancel) read this one instance — provided at the match route so
 * they share it. No duplicated selection state anywhere (spec invariant).
 *
 * `mode()` derives the active SelectionMode from the current prompt + the
 * set of board-locatable instanceIds. Null when the prompt is off-board /
 * mixed-zone / not an in-scope kind, in which case the overlay's modal grid
 * handles it unchanged.
 */
@Injectable()
export class SelectionService {
  private readonly _prompt = signal<PromptEnvelope | null>(null);
  private readonly _boardIds = signal<ReadonlySet<string>>(new Set());
  private readonly _selected = signal<string[]>([]);

  // Combat-pair state for blockers. Kept here (not on the board) so the
  // overlay banner's "Confirm blocks" can read the same pairs the board
  // built — single selection-state owner per the spec.
  private readonly _pendingBlocker = signal<string | null>(null);
  private readonly _blockPairs = signal<
    Array<{ blockerInstanceId: string; attackerInstanceId: string }>
  >([]);

  readonly selected = this._selected.asReadonly();
  readonly pendingBlocker = this._pendingBlocker.asReadonly();
  readonly blockPairs = this._blockPairs.asReadonly();

  /** instanceIds currently rendered on the board (both battlefields + hands). */
  setBoardInstanceIds(ids: ReadonlySet<string>): void {
    this._boardIds.set(ids);
  }

  /** New prompt → recompute mode and reset all in-flight selection state. */
  setPrompt(p: PromptEnvelope | null): void {
    this._prompt.set(p);
    this._selected.set([]);
    this._pendingBlocker.set(null);
    this._blockPairs.set([]);
  }

  readonly mode = computed<SelectionMode | null>(() => {
    const p = this._prompt();
    if (!p) return null;
    const kind = this.boardKind(p.expectedKinds);
    if (!kind) return null;

    if (kind === 'targets' || kind === 'choice') {
      // Targets/choice need a board-locatable candidate pool. No pool, or a
      // candidate that isn't on the board → modal fallback. Targets also
      // admit player candidates (Lightning Bolt to the face) — their ids are
      // unioned into the pool and the HUD is board-locatable. Player targets
      // are a targeting concept only, so 'choice' never absorbs them.
      const cardIds = (p.candidates ?? []).map(c => c.instanceId);
      const playerIds = kind === 'targets' ? (p.playerCandidates ?? []).map(pc => pc.id) : [];
      const ids = [...cardIds, ...playerIds];
      if (ids.length === 0) return null;
      const board = this._boardIds();
      if (!ids.every(id => board.has(id))) return null; // mixed-zone → modal
      const { min, max } = this.bounds(kind, p);
      return {
        kind,
        min,
        max,
        candidateIds: new Set(ids),
        sourceLabel: p.label ?? p.description ?? '',
        choiceKind: p.choiceView?.kind,
        // CR 601.2 — spell-cast targeting is cancellable; a mandatory
        // declarative choice (e.g. a sacrifice cost) is not.
        cancellable: kind === 'targets',
      };
    }

    // attackers / blockers: open-ended set declaration. Candidate gating is
    // resolved by the board against own creatures, so no candidate pool here.
    return {
      kind,
      min: 0,
      max: OPEN_ENDED,
      candidateIds: new Set(),
      sourceLabel: p.label ?? p.description ?? '',
      cancellable: false,
    };
  });

  toggle(id: string): void {
    const cur = this._selected();
    this._selected.set(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
  }

  clear(): void {
    this._selected.set([]);
  }

  // ---- Combat-pair helpers (blockers). The board drives these on click. ----

  setPendingBlocker(id: string | null): void {
    this._pendingBlocker.set(id);
  }

  /**
   * Pair the given blocker with an attacker. A blocker can block at most
   * one attacker (UI rule), so any prior pairing for that blocker is
   * replaced. Clears the pending blocker after pairing.
   */
  addBlockPair(blockerInstanceId: string, attackerInstanceId: string): void {
    this._blockPairs.update(ps => [
      ...ps.filter(p => p.blockerInstanceId !== blockerInstanceId),
      { blockerInstanceId, attackerInstanceId },
    ]);
    this._pendingBlocker.set(null);
  }

  /** Reset all combat-pair state (after a confirm or a fresh prompt). */
  resetCombat(): void {
    this._pendingBlocker.set(null);
    this._blockPairs.set([]);
    this._selected.set([]);
  }

  /**
   * Map the prompt's expectedKinds to an in-scope board kind. Ordering
   * mirrors detectKind (combat kinds before targets) so the two never
   * disagree on which UI a prompt routes to.
   */
  private boardKind(kinds: string[]): SelectionMode['kind'] | null {
    const ks = (kinds ?? []).map(k => k.toLowerCase());
    if (ks.some(k => k.includes('attacker'))) return 'attackers';
    if (ks.some(k => k.includes('blocker'))) return 'blockers';
    if (ks.some(k => k.includes('target'))) return 'targets';
    if (ks.some(k => k.includes('choicecommand') || k === 'choice')) return 'choice';
    return null;
  }

  private bounds(kind: 'targets' | 'choice', p: PromptEnvelope): { min: number; max: number } {
    if (kind === 'choice' && p.choiceView) {
      return { min: p.choiceView.min, max: p.choiceView.max };
    }
    // targets: the engine does not ship a target min/max on the envelope
    // yet; default to exactly one. Multi-target board-resident prompts are
    // rare and still resolve correctly via the modal fallback path.
    return { min: 1, max: 1 };
  }
}
