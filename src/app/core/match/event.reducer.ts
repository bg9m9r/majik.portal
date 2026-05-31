// Pure reducer mapping (GameState, NormalisedEventDto) → patched GameState.
//
// Returns `null` to signal the caller MUST fall back to a full /state
// refetch — either the event type isn't structurally patchable from the
// payload alone, or the payload didn't reference an entity we know
// about (stale state vs. server, viewer can't see opponent hidden zones,
// etc.). The caller treats null as a "miss" and re-pulls the snapshot,
// preserving the existing safety net. The reducer never silently no-ops
// on an event whose semantics would mutate state.
//
// Patched event types:
//   * LifeChangedEvent — set player.life
//   * PhaseChangedEvent / PhaseStartedEvent / StepStartedEvent — phase
//   * TurnStartedEvent — turnNumber + activePlayerId
//   * PlayerLostEvent — player.hasLost
//   * SpellCastEvent / StackObjectAddedEvent — push StackItem
//   * StackObjectResolvedEvent — remove StackItem (CR 405 stack is public)
//   * CardMovedEvent — move card between zones; CR 706 masking handled
//     via the `hidden: true` discriminator. For masked moves we push /
//     pop a `(hidden)` placeholder matching StateSnapshotter.HiddenZone
//     so opponent counts stay accurate without leaking identity. PLAN 04 —
//     → Battlefield (revealed) moves now patch in place from the enriched
//     payload (power/toughness/tapped/summoningSickness/abilities/counters).
//   * CounterAddedEvent — bump the target permanent's counter badge
//     (display only; authoritative P/T still come from the next snapshot).
//   * CardDrawnEvent — no-op (the engine emits CardMovedEvent first to
//     describe the Library → Hand transition; CardDrawn is treated as a
//     redundant signal). Returns `state` so the caller doesn't refetch.
//
// Deferred to refetch: *EndedEvent, ExtraPhaseAddedEvent,
// GameStartedEvent, and any unknown type.

import { NormalisedEventDto, pickBoolean, pickNumber, pickString, pickStringArray } from './event.types';
import { CardSnapshot, GamePlayer, GameState, StackItem, ZoneSnapshot } from './match.types';

export type PatchResult = GameState | null;

// Server-side StateSnapshotter.HiddenZone fills hidden zones (opponent
// hand, every library) with placeholders that have InstanceId =
// Guid.Empty and Name = "(hidden)". The reducer keeps the same
// convention so a masked move + a subsequent /state refetch produce
// identical zone shapes — no flicker, no diff thrash.
const HIDDEN_INSTANCE_ID = '00000000-0000-0000-0000-000000000000';
const HIDDEN_NAME = '(hidden)';

type ZoneKey = 'hand' | 'library' | 'graveyard' | 'exile' | 'battlefield';

export function patchGameState(state: GameState, evt: NormalisedEventDto): PatchResult {
  switch (evt.type) {
    case 'LifeChangedEvent': return patchLifeChanged(state, evt);
    case 'PhaseChangedEvent': return patchPhaseChanged(state, evt);
    case 'PhaseStartedEvent': return patchPhaseStarted(state, evt);
    case 'StepStartedEvent': return patchStepStarted(state, evt);
    case 'TurnStartedEvent': return patchTurnStarted(state, evt);
    case 'PlayerLostEvent': return patchPlayerLost(state, evt);
    case 'SpellCastEvent': return patchStackPush(state, evt);
    case 'StackObjectAddedEvent': return patchStackPush(state, evt);
    case 'StackObjectResolvedEvent': return patchStackPop(state, evt);
    case 'CardMovedEvent': return patchCardMoved(state, evt);
    case 'CounterAddedEvent': return patchCounterAdded(state, evt);
    case 'CardDrawnEvent':
      // CardMovedEvent already described the Library → Hand transition.
      // CardDrawn carries no new state delta — return current state so
      // the caller treats it as a successful patch (no refetch).
      return state;
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

function patchStackPush(state: GameState, evt: NormalisedEventDto): PatchResult {
  // SpellCastEvent + StackObjectAddedEvent both fire when an object lands
  // on the stack. The server-side EventPayloadBuilder mirrors the
  // StackObjectDto contract (id / kind / description) so the resulting
  // StackItem matches what a fresh /state would have returned.
  //
  // SpellCastEvent fires alongside StackObjectAddedEvent for spells —
  // dedupe on stackId so the entry isn't pushed twice. Other StackItem
  // sources (triggers, activated abilities) only emit
  // StackObjectAddedEvent.
  const id = pickString(evt.payload, 'stackId', 'id');
  const kind = pickString(evt.payload, 'kind');
  const description = pickString(evt.payload, 'description');
  if (!id || !kind || description === null) return null;
  if (state.stack.some(item => item.id === id)) {
    // Already present (e.g. SpellCast arrived after StackObjectAdded for
    // the same Spell) — a no-op patch is still a successful patch, the
    // caller must NOT refetch.
    return state;
  }
  const item: StackItem = { id, kind, description };
  return { ...state, stack: [...state.stack, item] };
}

function patchStackPop(state: GameState, evt: NormalisedEventDto): PatchResult {
  // StackObjectResolvedEvent fires when an item finishes resolving and
  // leaves the stack (CR 608.2 / 608.3). Remove it by id.
  //
  // Note: this patch only updates state.stack; downstream side-effects
  // (cards moving to graveyard, life totals changing, permanents
  // entering the battlefield) arrive as their own events (CardMoved,
  // LifeChanged, etc.) — those are not yet patchable so the caller will
  // refetch for them as before. Stack panel stays in sync regardless.
  const id = pickString(evt.payload, 'stackId', 'id');
  if (!id) return null;
  const idx = state.stack.findIndex(item => item.id === id);
  if (idx < 0) {
    // Resolved event for an item we don't know about — snapshot is stale.
    return null;
  }
  const stack = state.stack.slice(0, idx).concat(state.stack.slice(idx + 1));
  return { ...state, stack };
}

// -----------------------------------------------------------------------
// CardMovedEvent — move card between zones, with CR 706 masking.
//
// Public payload (revealed): { cardId, cardName, ownerId, manaCost,
//   types, from, to }. We can construct a full CardSnapshot for the
//   destination zone and remove the exact instance from the source.
//
// Masked payload (hidden=true): { ownerId, from, to, hidden: true }.
//   The owner's perspective is the one we can patch:
//     * If we know the source player's `from` zone, pop the first
//       placeholder (`InstanceId == Guid.Empty`) — opponent hidden
//       zones are already filled with placeholders by the snapshotter,
//       so removing any one preserves the correct count.
//     * Push a placeholder onto the `to` zone.
//   On a public destination we'd normally have card data, so the
//   masked path is invoked only when BOTH source and destination are
//   hidden zones (Hand / Library) — same predicate the server uses
//   when emitting masked variants.
//
// Failures return null:
//   * unknown owner / unknown zone string
//   * card not found in the source zone when we expected it to be
//
// PLAN 04 — since the companion core PR, a → Battlefield (revealed) move
// carries the full permanent fields (power / toughness / tapped /
// summoningSickness / abilities / producedManaColors / counters) shared with
// the snapshotter, so the ETB is patched in place like every other zone. The
// Stack destination still routes through the SpellCast / StackObjectAdded
// events; everything else only needs the CardSnapshot fields the payload now
// provides.
// -----------------------------------------------------------------------
function patchCardMoved(state: GameState, evt: NormalisedEventDto): PatchResult {
  const fromStr = pickString(evt.payload, 'from');
  const toStr = pickString(evt.payload, 'to');
  const ownerId = pickString(evt.payload, 'ownerId');
  if (!fromStr || !toStr || !ownerId) return null;

  const ownerIdx = state.players.findIndex(p => p.id === ownerId);
  if (ownerIdx < 0) return null;

  const fromZone = zoneKeyForName(fromStr);
  const toZone = zoneKeyForName(toStr);

  // Stack movements: only the destination side has a stack, and stack
  // patching already flows through SpellCast / StackObjectAdded /
  // StackObjectResolved events. Treat any Stack-touching CardMovedEvent
  // as already-handled to avoid double-patching.
  if (fromStr === 'Stack' || toStr === 'Stack') {
    return state;
  }

  // PLAN 04 — Battlefield destinations are now patchable: the revealed
  // CardMovedEvent carries the permanent fields buildCardSnapshot reads.

  // If either side maps to an unrecognised zone we can't patch.
  if (fromZone === null && fromStr !== 'Command') return null;
  if (toZone === null && toStr !== 'Command') return null;
  // Command zone isn't represented in GameState today — fall back to
  // refetch so we don't lose the move.
  if (fromZone === null || toZone === null) return null;

  const hidden = pickBoolean(evt.payload, 'hidden') === true;
  const cardId = pickString(evt.payload, 'cardId');
  const cardName = pickString(evt.payload, 'cardName');

  // Owner of the moving card is also the owner of both zones — every
  // zone in GameState is per-player and CardMovedEvent is fired by the
  // engine on the card's current owner's ZoneManager.
  const player = state.players[ownerIdx];

  const removed = removeFromZone(player[fromZone], { cardId, hidden });
  if (removed === null) {
    // Source mismatch (snapshot stale or already patched) — refetch.
    return null;
  }

  let appended: ZoneSnapshot;
  if (hidden) {
    appended = appendToZone(player[toZone], hiddenPlaceholder());
  } else {
    if (!cardName || !cardId) return null;
    const snapshot = buildCardSnapshot(cardId, cardName, evt.payload);
    appended = appendToZone(player[toZone], snapshot);
  }

  const nextPlayer: GamePlayer = {
    ...player,
    [fromZone]: removed,
    [toZone]: appended,
  };
  const players = replaceAt<GamePlayer>(state.players, ownerIdx, nextPlayer);
  return { ...state, players };
}

// -----------------------------------------------------------------------
// CounterAddedEvent — bump the target permanent's counter badge in place.
//
// Payload: { targetInstanceId, counterType, amount, controllerId }. The
// counter map is a DISPLAY-ONLY badge: we bump counters[counterType] by
// amount and do NOT recompute power / toughness here — authoritative P/T
// always come from the next /state snapshot (the engine's layer system
// owns +1/+1 arithmetic). The card lives on a battlefield zone (counters
// are only placed on battlefield permanents); we scan every player's
// battlefield for the target instance. A target we don't know about
// (snapshot stale vs. server) returns null → refetch.
// -----------------------------------------------------------------------
function patchCounterAdded(state: GameState, evt: NormalisedEventDto): PatchResult {
  const targetId = pickString(evt.payload, 'targetInstanceId');
  const counterType = pickString(evt.payload, 'counterType');
  const amount = pickNumber(evt.payload, 'amount');
  if (!targetId || !counterType || amount === null) return null;

  for (let pi = 0; pi < state.players.length; pi++) {
    const player = state.players[pi];
    const ci = player.battlefield.cards.findIndex(c => c.instanceId === targetId);
    if (ci < 0) continue;
    const card = player.battlefield.cards[ci];
    const counters = { ...(card.counters ?? {}) };
    counters[counterType] = (counters[counterType] ?? 0) + amount;
    const nextCard: CardSnapshot = { ...card, counters };
    const cards = replaceAt(player.battlefield.cards, ci, nextCard);
    const nextPlayer: GamePlayer = { ...player, battlefield: { cards } };
    const players = replaceAt<GamePlayer>(state.players, pi, nextPlayer);
    return { ...state, players };
  }
  // Target not found on any battlefield — snapshot is stale, refetch.
  return null;
}

function zoneKeyForName(name: string): ZoneKey | null {
  switch (name) {
    case 'Hand': return 'hand';
    case 'Library': return 'library';
    case 'Graveyard': return 'graveyard';
    case 'Exile': return 'exile';
    case 'Battlefield': return 'battlefield';
    default: return null;
  }
}

function removeFromZone(
  zone: ZoneSnapshot,
  match: { cardId: string | null; hidden: boolean },
): ZoneSnapshot | null {
  if (match.hidden || !match.cardId) {
    // No identity to match on — peel off the first placeholder
    // (InstanceId == Guid.Empty). If the zone has none, the snapshot
    // doesn't reflect the engine state, signal refetch.
    const idx = zone.cards.findIndex(c => c.instanceId === HIDDEN_INSTANCE_ID);
    if (idx < 0) {
      // Some legitimate moves can target a known-public card on a
      // hidden zone (e.g. a server with a stale snapshot). Fall back
      // to popping the first card if any exist so the count still
      // decrements — but only when masked: revealed moves with no
      // cardId already returned null above.
      if (zone.cards.length === 0) return null;
      return { cards: zone.cards.slice(1) };
    }
    return { cards: zone.cards.slice(0, idx).concat(zone.cards.slice(idx + 1)) };
  }
  const idx = zone.cards.findIndex(c => c.instanceId === match.cardId);
  if (idx < 0) return null;
  return { cards: zone.cards.slice(0, idx).concat(zone.cards.slice(idx + 1)) };
}

function appendToZone(zone: ZoneSnapshot, card: CardSnapshot): ZoneSnapshot {
  return { cards: [...zone.cards, card] };
}

function hiddenPlaceholder(): CardSnapshot {
  return {
    instanceId: HIDDEN_INSTANCE_ID,
    name: HIDDEN_NAME,
    manaCost: '',
    types: [],
    power: null,
    toughness: null,
    tapped: false,
    summoningSickness: false,
    producedManaColors: '',
  };
}

function buildCardSnapshot(
  cardId: string,
  cardName: string,
  payload: Record<string, unknown>,
): CardSnapshot {
  const manaCost = pickString(payload, 'manaCost') ?? '';
  const types = pickStringArray(payload, 'types') ?? [];
  // PLAN 04 — the revealed → Battlefield CardMovedEvent now carries the
  // permanent fields (shared with StateSnapshotter.BuildPermanentFields), so a
  // patched ETB matches what a fresh /state would return for the same card.
  // Non-Battlefield moves omit these fields; the picks degrade to the prior
  // null / false / "" defaults, so those zones are unchanged.
  const snapshot: CardSnapshot = {
    instanceId: cardId,
    name: cardName,
    manaCost,
    types,
    power: pickNumber(payload, 'power'),
    toughness: pickNumber(payload, 'toughness'),
    tapped: pickBoolean(payload, 'tapped') ?? false,
    summoningSickness: pickBoolean(payload, 'summoningSickness') ?? false,
    producedManaColors: pickString(payload, 'producedManaColors') ?? '',
  };
  const abilities = pickAbilities(payload, 'abilities');
  if (abilities) snapshot.abilities = abilities;
  const counters = pickCounters(payload, 'counters');
  if (counters) snapshot.counters = counters;
  return snapshot;
}

// Parse the abilities array off a CardMovedEvent payload into the portal's
// Ability shape. Tolerates camelCase / PascalCase keys (matching the
// pickString helpers + the snapshot normaliser in match.ts).
function pickAbilities(
  payload: Record<string, unknown>,
  key: string,
): { kind: string; description: string; id: string | null }[] | null {
  const raw = payload[key] ?? payload[key.charAt(0).toUpperCase() + key.slice(1)];
  if (!Array.isArray(raw)) return null;
  return raw.map(item => {
    const a = (item ?? {}) as Record<string, unknown>;
    return {
      kind: String(a['kind'] ?? a['Kind'] ?? ''),
      description: String(a['description'] ?? a['Description'] ?? ''),
      id: (a['id'] ?? a['Id'] ?? null) as string | null,
    };
  });
}

// Parse the counters map ({"+1/+1": 2, …}) off a payload. Tolerant of
// either casing; drops non-numeric values defensively.
function pickCounters(
  payload: Record<string, unknown>,
  key: string,
): Record<string, number> | null {
  const raw = payload[key] ?? payload[key.charAt(0).toUpperCase() + key.slice(1)];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function replaceAt<T>(arr: readonly T[], idx: number, value: T): T[] {
  const copy = arr.slice();
  copy[idx] = value;
  return copy;
}
