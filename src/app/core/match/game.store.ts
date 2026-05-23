import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { NormalisedEventDto, normaliseEvent } from './event.types';
import { patchGameState } from './event.reducer';
import { BotDecision, GameState, PromptEnvelope } from './match.types';

// Cap on the bot-decision ring buffer rendered by the diagnostics panel.
// Ten is enough to cover a single bot turn (mulligan + priority pumps +
// combat) without scrolling, and small enough that re-renders stay
// cheap. Decisions older than this are dropped — the panel is a
// tail-of-stream view, not a full transcript.
const MAX_RECENT_DECISIONS = 10;

// In-memory store for the live engine view of a single match. The page
// component owns the lifecycle: setState on initial bootstrap and on
// full re-fetched snapshots, applyEvent for incremental SignalR event
// deltas, setPrompt when a per-viewer prompt envelope arrives, and
// clearPrompt when the user submits a decision.
//
// Event delta strategy: applyEvent attempts to mutate `state` directly
// from the EventDto payload. If the event type is patchable AND the
// payload references entities we already know about, the patch is
// applied in-place and `stateVersion` is bumped. Otherwise applyEvent
// returns false and the caller falls back to a full /state refetch.
// This preserves the safety net from the prior single-strategy refetch
// design while removing a snapshot GET from the common-case event hop.
// Client-only "stop on phase X" toggle, keyed by engine phase name (the
// raw GameState.phase string — e.g. "Untap", "PreCombatMain"). Value
// records whose turn the stop applies to:
//   * 'mine'   — pause auto-pass when it's the viewer's turn
//   * 'theirs' — pause auto-pass when it's the opponent's turn
//   * absent   — no stop set; auto-pass behaves per global guards
// Cycle is null → 'mine' → 'theirs' → null. Lives in the store so the
// auto-pass effect in MatchPage can read it without prop drilling.
export type PhaseStopOwner = 'mine' | 'theirs';
export type PhaseStops = Record<string, PhaseStopOwner>;

type GameStoreState = {
  state: GameState | null;
  prompt: PromptEnvelope | null;
  // Monotonically increasing counter bumped on every setState / patch.
  // Consumers that need to detect "snapshot changed" without diffing the
  // whole tree can observe this. It also serves as a freshness marker
  // for any future server-supplied sequence number — when the server
  // begins emitting one we can compare and refetch on mismatch.
  stateVersion: number;
  // Engine player ids the viewer "owns" (single-player today, room for
  // shared-control later). Resolved when the snapshot lands by matching
  // the viewer's MatchPlayer handle to PlayerDto.name.
  selfPlayerIds: string[];
  // Ring buffer of the last N bot decisions received over SignalR. Most
  // recent first. Capped at MAX_RECENT_DECISIONS so the panel stays
  // bounded without paging UI.
  recentDecisions: BotDecision[];
  // Phase-stop map. See PhaseStops above.
  phaseStops: PhaseStops;
};

const initial: GameStoreState = {
  state: null,
  prompt: null,
  stateVersion: 0,
  selfPlayerIds: [],
  recentDecisions: [],
  phaseStops: {},
};

export const GameStore = signalStore(
  { providedIn: 'root' },
  withState<GameStoreState>(initial),
  withComputed(({ state, prompt, selfPlayerIds }) => ({
    // Is the active prompt for the viewer? PromptDto only arrives via
    // per-recipient publish, but defensively gate the UI on PlayerId
    // match anyway — guards against future hub changes leaking prompts.
    isMyTurnPrompt: computed(() => {
      const p = prompt();
      const ids = selfPlayerIds();
      return !!p && ids.includes(p.playerId);
    }),
    activePlayerId: computed(() => state()?.activePlayerId ?? null),
  })),
  withMethods(store => ({
    setState(next: GameState | null): void {
      patchState(store, s => ({ state: next, stateVersion: s.stateVersion + 1 }));
    },
    setSelfPlayerIds(ids: string[]): void {
      patchState(store, { selfPlayerIds: ids });
    },
    setPrompt(p: PromptEnvelope | null): void {
      patchState(store, { prompt: p });
    },
    clearPrompt(): void {
      patchState(store, { prompt: null });
    },
    /**
     * Attempt to apply a SignalR engine event as an in-place patch on
     * the current snapshot. Returns `true` if the patch succeeded —
     * callers should NOT issue a refetch in that case. Returns `false`
     * when the event type is unknown / not yet patchable, the payload
     * is malformed, or it references entities not in the current
     * snapshot; the caller MUST then refetch /state to avoid drift.
     *
     * If there is no current snapshot, `false` is returned — the very
     * first event after a bootstrap can race ahead of /state, and
     * patching nothing is meaningless. Caller fetches the baseline.
     */
    applyEvent(raw: unknown): boolean {
      const evt: NormalisedEventDto | null = normaliseEvent(raw);
      if (!evt) return false;
      const current = store.state();
      if (!current) return false;
      const next = patchGameState(current, evt);
      if (!next) return false;
      patchState(store, s => ({ state: next, stateVersion: s.stateVersion + 1 }));
      return true;
    },
    // Append a bot decision to the recent-decisions ring. Newest goes to
    // the front; the ring is truncated to MAX_RECENT_DECISIONS so the
    // panel never needs to virtualise.
    pushBotDecision(d: BotDecision): void {
      patchState(store, s => ({
        recentDecisions: [d, ...s.recentDecisions].slice(0, MAX_RECENT_DECISIONS),
      }));
    },
    clearBotDecisions(): void {
      patchState(store, { recentDecisions: [] });
    },
    // Cycle a phase chip's stop state: null → 'mine' → 'theirs' → null.
    // The active turn at click time is irrelevant — the user is picking
    // an absolute side (my turn vs their turn), not a relative one.
    togglePhaseStop(phase: string): void {
      patchState(store, s => {
        const cur = s.phaseStops[phase];
        const next: PhaseStops = { ...s.phaseStops };
        if (cur === undefined) next[phase] = 'mine';
        else if (cur === 'mine') next[phase] = 'theirs';
        else delete next[phase];
        return { phaseStops: next };
      });
    },
    clearPhaseStops(): void {
      patchState(store, { phaseStops: {} });
    },
    reset(): void {
      patchState(store, initial);
    },
  }))
);
