// Structured action-log line + the generalization of the store's
// announcementFor. describeEvent renders a single human-readable line for
// any engine event we want surfaced in the full-game action log; the
// store's aria-live region now reads describeEvent(...)?.text, so the two
// surfaces share one composer.
//
// Payload key names below are pinned against the generated wire DTOs
// (src/app/core/api/models/*-payload.ts) and the reducer's payload reads:
//   * SpellCastEvent / StackObjectAddedEvent — StackObjectPayload:
//       { stackId, kind, description, controllerId, cardName, cardId }
//   * StackObjectResolvedEvent — { stackId }
//   * LifeChangedEvent — { playerId, current, previous }
//   * CounterAddedEvent — { counterType, amount, controllerId, targetInstanceId }
//   * TurnStartedEvent — { playerId, turn }
//   * StepStartedEvent — { playerId, step }; PhaseStateChanged/Phase* — { to }
//   * CardMovedEvent — { cardName, ownerId, from, to, hidden }
//   * ContinuousEffect{Added,Removed}Event — { sourceInstanceId,
//       sourceName, layer, description } (core PR bg9m9r/majik#2618)
//
// PASSING PRIORITY IS NEVER LOGGED — the engine emits no event for it, so
// there is no case for it here.

import { NormalisedEventDto, pickNumber, pickString } from './event.types';
import { GameState } from './match.types';

export type LogKind =
  | 'cast' | 'activate' | 'trigger' | 'resolve' | 'life'
  | 'zone' | 'counter' | 'layer' | 'turn' | 'phase';

export interface LogLine {
  text: string;
  kind: LogKind;
  actorId: string | null;
  seq: number;
}

export function describeEvent(
  evt: NormalisedEventDto,
  prev: GameState,
  next: GameState,
  selfIds: readonly string[],
): LogLine | null {
  const seq = evt.seq;
  const line = (text: string, kind: LogKind, actorId: string | null): LogLine =>
    ({ text, kind, actorId, seq });
  const nameOf = (id: string | null | undefined, fallback = 'A player'): string =>
    id ? next.players.find(p => p.id === id)?.name ?? fallback : fallback;

  switch (evt.type) {
    case 'TurnStartedEvent': {
      const turn = pickNumber(evt.payload, 'turn') ?? next.turnNumber;
      const playerId = pickString(evt.payload, 'playerId');
      return line(`Turn ${turn} — ${nameOf(playerId, 'player')}`, 'turn', playerId);
    }
    case 'PhaseChangedEvent':
    case 'PhaseStateChangedEvent':
    case 'PhaseStartedEvent':
    case 'StepStartedEvent': {
      const phase = pickString(evt.payload, 'phase', 'step', 'to') ?? next.phase;
      return line(phase, 'phase', null);
    }
    case 'SpellCastEvent': {
      const name = pickString(evt.payload, 'description', 'kind') ?? 'a spell';
      const actor = pickString(evt.payload, 'controllerId', 'playerId');
      return line(`${nameOf(actor)} casts ${name}`, 'cast', actor);
    }
    case 'StackObjectAddedEvent': {
      const kind = pickString(evt.payload, 'kind');
      // Spells already produce a SpellCastEvent line — skip the duplicate.
      if (kind === 'spell' || kind === 'Spell') return null;
      const desc = pickString(evt.payload, 'description') ?? 'an ability';
      const actor = pickString(evt.payload, 'controllerId', 'playerId');
      const isTrig = kind === 'triggered' || kind === 'Triggered';
      return isTrig
        ? line(`${desc} triggers`, 'trigger', actor)
        : line(`${nameOf(actor)} activates ${desc}`, 'activate', actor);
    }
    case 'StackObjectResolvedEvent': {
      const id = pickString(evt.payload, 'stackId', 'id');
      const item = id ? prev.stack.find(s => s.id === id) : null;
      const name = item?.description ?? item?.kind ?? 'stack object';
      return line(`${name} resolves`, 'resolve', null);
    }
    case 'LifeChangedEvent': {
      const playerId = pickString(evt.payload, 'playerId');
      // `after` prefers the payload's `current` so the line is correct
      // whether or not the snapshot patch has run (the store captures the
      // line pre-patch, where prev == next == current). `before` reads
      // the snapshot's pre-patch value.
      const after = pickNumber(evt.payload, 'current')
        ?? (playerId ? next.players.find(p => p.id === playerId)?.life ?? null : null);
      const before = playerId ? prev.players.find(p => p.id === playerId)?.life ?? null : null;
      if (after == null || before == null) return null;
      const delta = after - before;
      if (delta === 0) return null;
      const verb = delta > 0 ? `+${delta}` : `${delta}`;
      return line(`${nameOf(playerId, 'player')} — ${after} life (${verb})`, 'life', playerId);
    }
    case 'CounterAddedEvent': {
      const type = pickString(evt.payload, 'counterType') ?? 'counter';
      const amount = pickNumber(evt.payload, 'amount') ?? 1;
      const actor = pickString(evt.payload, 'controllerId');
      return line(`+${amount} ${type} counter${amount === 1 ? '' : 's'}`, 'counter', actor);
    }
    case 'CardMovedEvent': {
      if (evt.payload['hidden'] === true) return null;
      const to = pickString(evt.payload, 'to');
      const from = pickString(evt.payload, 'from');
      const name = pickString(evt.payload, 'cardName', 'name');
      if (!name || !to) return null;
      const owner = pickString(evt.payload, 'ownerId');
      // Only the three notable transitions.
      if (to === 'Battlefield' && from !== 'Battlefield') {
        return line(`${name} enters`, 'zone', owner);
      }
      if (to === 'Graveyard' && from === 'Battlefield') {
        return line(`${name} dies`, 'zone', owner);
      }
      if (to === 'Exile') {
        return line(`${name} is exiled`, 'zone', owner);
      }
      return null;
    }
    case 'ContinuousEffectAddedEvent': {
      const desc = pickString(evt.payload, 'description')
        ?? pickString(evt.payload, 'sourceName') ?? 'effect';
      return line(`${desc} added`, 'layer', null);
    }
    case 'ContinuousEffectRemovedEvent': {
      const desc = pickString(evt.payload, 'description')
        ?? pickString(evt.payload, 'sourceName') ?? 'effect';
      return line(`${desc} removed`, 'layer', null);
    }
    case 'PlayerLostEvent': {
      const playerId = pickString(evt.payload, 'playerId');
      return line(`${nameOf(playerId, 'player')} lost the game`, 'turn', playerId);
    }
    default:
      return null;
  }
}
