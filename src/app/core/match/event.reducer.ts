// Pure reducer mapping (GameState, NormalisedEventDto) → patched GameState.
//
// Returns `null` to signal the caller MUST fall back to a full /state
// refetch — either the event type isn't structurally patchable from the
// payload alone (e.g. CardMovedEvent into the battlefield needs power /
// toughness / abilities that aren't on the wire), or the payload didn't
// reference an entity we know about (stale state vs. server, viewer
// can't see opponent hidden zones, etc.). The caller treats null as a
// "miss" and re-pulls the snapshot, preserving the existing safety
// net. The reducer never silently no-ops on an event whose semantics
// would mutate state.
//
// Patched event types (chosen because their payloads carry the full
// delta and don't touch CR 706 hidden information):
//   * LifeChangedEvent — set player.life
//   * PhaseChangedEvent / PhaseStartedEvent / StepStartedEvent — phase
//   * TurnStartedEvent — turnNumber + activePlayerId
//   * PlayerLostEvent — player.hasLost
//
// Deferred to refetch (would need richer payloads or hidden-zone
// reconstitution): CardMovedEvent, CardDrawnEvent, SpellCastEvent,
// StackObjectAddedEvent, StackObjectResolvedEvent, *EndedEvent,
// ExtraPhaseAddedEvent, GameStartedEvent, and any unknown type.

import { NormalisedEventDto, pickNumber, pickString } from './event.types';
import { GamePlayer, GameState } from './match.types';

export type PatchResult = GameState | null;

export function patchGameState(state: GameState, evt: NormalisedEventDto): PatchResult {
  switch (evt.type) {
    case 'LifeChangedEvent': return patchLifeChanged(state, evt);
    case 'PhaseChangedEvent': return patchPhaseChanged(state, evt);
    case 'PhaseStartedEvent': return patchPhaseStarted(state, evt);
    case 'StepStartedEvent': return patchStepStarted(state, evt);
    case 'TurnStartedEvent': return patchTurnStarted(state, evt);
    case 'PlayerLostEvent': return patchPlayerLost(state, evt);
    default:
      // Unknown / deferred type — caller refetches the snapshot.
      return null;
  }
}

function patchLifeChanged(state: GameState, evt: NormalisedEventDto): PatchResult {
  const playerId = pickString(evt.payload, 'playerId');
  const current = pickNumber(evt.payload, 'current');
  if (!playerId || current === null) return null;
  const idx = state.players.findIndex(p => p.id === playerId);
  if (idx < 0) return null;
  const players = replaceAt(state.players, idx, { ...state.players[idx], life: current });
  return { ...state, players };
}

function patchPhaseChanged(state: GameState, evt: NormalisedEventDto): PatchResult {
  const to = pickString(evt.payload, 'to');
  if (!to) return null;
  return { ...state, phase: to };
}

function patchPhaseStarted(state: GameState, evt: NormalisedEventDto): PatchResult {
  const phase = pickString(evt.payload, 'phase');
  if (!phase) return null;
  // PhaseStartedEvent fires on the entry to a phase — by definition the
  // active player owns that phase, so keep activePlayerId in sync.
  const playerId = pickString(evt.payload, 'playerId');
  return {
    ...state,
    phase,
    activePlayerId: playerId ?? state.activePlayerId,
  };
}

function patchStepStarted(state: GameState, evt: NormalisedEventDto): PatchResult {
  // The engine's GameStateDto.Phase field is a single label — phases AND
  // steps both surface there (see StateSnapshotter / PhaseStateMachine).
  // StepStartedEvent supplies the granular label, so we treat it like a
  // phase change for the purposes of the snapshot's `phase` string.
  const step = pickString(evt.payload, 'step');
  if (!step) return null;
  const playerId = pickString(evt.payload, 'playerId');
  return {
    ...state,
    phase: step,
    activePlayerId: playerId ?? state.activePlayerId,
  };
}

function patchTurnStarted(state: GameState, evt: NormalisedEventDto): PatchResult {
  const turn = pickNumber(evt.payload, 'turn');
  const playerId = pickString(evt.payload, 'playerId');
  if (turn === null || !playerId) return null;
  // Verify the active player is one we know about; if not, the snapshot
  // is out of date and a refetch is safer than silently mismatching.
  if (!state.players.some(p => p.id === playerId)) return null;
  return { ...state, turnNumber: turn, activePlayerId: playerId };
}

function patchPlayerLost(state: GameState, evt: NormalisedEventDto): PatchResult {
  const playerId = pickString(evt.payload, 'playerId');
  if (!playerId) return null;
  const idx = state.players.findIndex(p => p.id === playerId);
  if (idx < 0) return null;
  const players = replaceAt<GamePlayer>(state.players, idx, { ...state.players[idx], hasLost: true });
  return { ...state, players };
}

function replaceAt<T>(arr: readonly T[], idx: number, value: T): T[] {
  const copy = arr.slice();
  copy[idx] = value;
  return copy;
}
