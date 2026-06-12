import { GameState, PromptEnvelope } from './match.types';

// ---------------------------------------------------------------------
// Match-session shared logic.
//
// Pure helpers + constants describing the live match session's
// auto-pass / stack-mutation behaviour. Extracted from the MatchPage
// component so they can be consumed by both the GameStore (the single
// portal source of truth) and unit-tested in isolation from the
// component graph.
// ---------------------------------------------------------------------

// Minimum-display window (ms) for stack mutations. While the timer is
// active, auto-pass is suppressed even when PassPriority is the only
// legal kind — gives the user (and a watching bot) a beat to register
// a freshly-landed trigger or spell before it resolves silently.
export const STACK_MUTATION_DISPLAY_MS = 600;

// Combat phases on the opponent's turn — auto-pass is suppressed if
// the viewer has any non-land card in hand so they don't unknowingly
// skip an instant-speed response window into / through combat.
const OPP_COMBAT_PHASES = new Set([
  'BeginningOfCombat',
  'DeclareAttackers',
  'DeclareBlockers',
  'CombatDamage',
  'EndOfCombat',
]);

export interface AutoPassDeps {
  state: GameState | null;
  selfPlayerIds: readonly string[];
  phaseStops: Record<string, 'mine' | 'theirs'>;
  // When true (user holding Ctrl), auto-pass is suppressed for every
  // step — even after casting a spell, even on phases that would
  // otherwise be safe to skip. Mirrors MTGO's "Full Control" toggle.
  fullControl: boolean;
  // Wall-clock timestamp (ms since epoch) of the last observed stack
  // mutation — see GameStore.recordStackMutation. Used to enforce a
  // minimum-display window after triggered abilities / spells land on
  // the stack so the user actually sees them before any auto-pass
  // resolves them invisibly. Null when the stack hasn't mutated since
  // the page loaded.
  lastStackMutatedAt: number | null;
  // Current wall-clock time (ms since epoch). Passed in (not read from
  // Date.now()) so the guard stays pure / testable.
  nowMs: number;
}

/**
 * Primary gate — does the engine signal "PassPriority is your only
 * legal action"? Today `Majik.Core.Api/RemoteAgent.cs#ChoosePriorityActionAsync`
 * always sends the full set `[PassPriorityCommand, PlayLandCommand,
 * CastSpellCommand]` regardless of legality, so this gate only matches
 * once the engine starts narrowing. Until then auto-pass is effectively
 * disabled for priority rounds, which is the safe direction — the user
 * sees the prompt and explicitly passes.
 */
function isPassOnlyPriorityPrompt(kinds: readonly string[] | undefined): boolean {
  if (!kinds || kinds.length !== 1) return false;
  return kinds[0] === 'PassPriorityCommand';
}

/**
 * Is this prompt a priority window the viewer can answer with Pass?
 *
 * CR 117.3 — the engine raises a prompt to a seat only when that seat
 * actually holds priority (auto-pass windows are skipped server-side),
 * so a pending prompt whose `expectedKinds` advertises
 * `PassPriorityCommand` means it is genuinely the viewer's turn to act
 * and passing is a legal response. The engine ships the full priority
 * set `[PassPriorityCommand, PlayLandCommand, CastSpellCommand]` (see
 * `isPassOnlyPriorityPrompt`), so we look for the kind anywhere in the
 * set rather than requiring it be the sole entry.
 *
 * Sub-prompts that demand a specific input — choosing targets,
 * surveil, a yes/no "may", a mulligan, declaring attackers/blockers —
 * do NOT carry `PassPriorityCommand`; their `expectedKinds` name the
 * specific command (`ChooseTargetsCommand`, `ChooseSurveilCommand`,
 * …). Those have their own UI; Pass is not a legal answer and this
 * helper returns false, keeping the Pass button disabled.
 *
 * Matched case-insensitively against an `endsWith('passprioritycommand')`
 * suffix so a normalised `pass` discriminator or a namespaced variant
 * still resolves.
 */
export function isPriorityPrompt(kinds: readonly string[] | undefined): boolean {
  if (!kinds || kinds.length === 0) return false;
  return kinds.some(k => {
    const lk = k.toLowerCase();
    return lk === 'pass' || lk.endsWith('passprioritycommand');
  });
}

// ---------------------------------------------------------------------
// Auto-pass guard.
//
// Decides whether an arriving "pass priority" prompt should be answered
// silently with a Pass command, or surfaced to the user for them to
// decide. Pure so it can be unit-tested in isolation.
//
// Full Control (highest-priority guard): user is holding Ctrl. Suppress
// auto-pass for every step, mirroring MTGO's Full Control toggle.
//
// Primary gate (CR 117.3a — priority is the player's right to act):
//   Auto-pass ONLY when the engine signals that PassPriority is the
//   sole legal action — i.e. expectedKinds is exactly
//   `['PassPriorityCommand']`. Any time the engine surfaces additional
//   command kinds (PlayLand, CastSpell, ActivateAbility, …) the viewer
//   has a real choice and must see the prompt.
//
// Defence-in-depth (only consulted once primary gate has matched a
// pass-only round):
//   - No GameState snapshot yet → never auto-pass.
//   - selfPlayerIds is empty (race: prompt arrived before /state
//     populated the viewer's seat) → never auto-pass.
//   - Stack non-empty → never auto-pass (CR 117.3b response window).
//   - Phase-stop registered for the active turn's side → never
//     auto-pass (the user explicitly asked to pause here).
//   - Opponent's combat phase AND the viewer has a non-land in hand
//     → never auto-pass (instant-speed response window).
// ---------------------------------------------------------------------
export function shouldAutoPass(p: PromptEnvelope, deps: AutoPassDeps): boolean {
  // (0) — Full Control: user is holding Ctrl. Suppress auto-pass for
  // every step. Highest-priority guard so it wins over any other rule.
  if (deps.fullControl) return false;
  // (1) primary gate — only auto-pass when PassPriority is the engine's
  // single offered action.
  if (!isPassOnlyPriorityPrompt(p.expectedKinds)) return false;
  // (1a) — minimum-display window after a stack mutation.
  if (deps.lastStackMutatedAt != null
    && deps.nowMs - deps.lastStackMutatedAt < STACK_MUTATION_DISPLAY_MS) {
    return false;
  }
  // (2) — no snapshot yet.
  const s = deps.state;
  if (!s) return false;
  // (3) — empty selfPlayerIds (race: prompt before /state).
  if (deps.selfPlayerIds.length === 0) return false;
  // (4) — stack non-empty (CR 117.3b response window).
  if (s.stack.length > 0) return false;
  const phase = s.phase;
  const selfIds = deps.selfPlayerIds;
  const activeSide: 'mine' | 'theirs' =
    selfIds.includes(s.activePlayerId) ? 'mine' : 'theirs';
  // (5) — phase stop set for the active side.
  const stop = deps.phaseStops[phase];
  if (stop === activeSide) return false;
  // (6) — opponent's combat phase + the viewer has a non-land in hand.
  if (activeSide === 'theirs' && OPP_COMBAT_PHASES.has(phase)) {
    const me = s.players.find(pl => selfIds.includes(pl.id));
    const hasNonLand = (me?.hand.cards ?? []).some(c =>
      !(c.types ?? []).map(t => t.toLowerCase()).includes('land'));
    if (hasNonLand) return false;
  }
  return true;
}

/**
 * Cheap deterministic signature for a GameState's stack. Identity is
 * what we care about — same length AND same ids in the same order
 * means "nothing changed", anything else means a mutation. Returns
 * "0|" for null / empty so a freshly-cleared stack still differs from
 * a never-populated one (which is also "0|" — that's fine, no spurious
 * mutation event before the first real change).
 */
export function stackSignature(state: GameState | null): string {
  if (!state) return '0|';
  const items = state.stack;
  if (items.length === 0) return '0|';
  return `${items.length}|${items.map(i => i.id).join(',')}`;
}

/**
 * Stable de-dupe key for an auto-pass prompt. Replaces the old
 * reference-identity check (a fresh PromptEnvelope object per SignalR
 * message) with a value-derived key, so the store can suppress
 * re-passing the same logical prompt even if the envelope object
 * changes identity across re-emits.
 */
export function autoPassPromptKey(p: PromptEnvelope): string {
  return `${p.gameId}|${p.playerId}|${[...p.expectedKinds].join(',')}`;
}
