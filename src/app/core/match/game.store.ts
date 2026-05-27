import { InjectionToken, computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { NormalisedEventDto, normaliseEvent, pickBoolean, pickNumber, pickString, pickStringArray } from './event.types';
import { patchGameState } from './event.reducer';
import { AutoPassDeps, shouldAutoPass, stackSignature, autoPassPromptKey } from './match-session';
import { AuthUserStore } from '../auth/auth-user.store';
import { MatchService } from './match.service';
import { BotDecision, GameCommand, GameState, Match, PromptEnvelope } from './match.types';

// Re-export so existing consumers (and the component) can keep a single
// import surface; STACK_MUTATION_DISPLAY_MS lives in match-session.
export { STACK_MUTATION_DISPLAY_MS } from './match-session';

// Cadence of the auto-pass heartbeat tick (ms). Coarse enough not to
// burn CPU, fine enough that the STACK_MUTATION_DISPLAY_MS window
// expires within roughly one tick of its actual deadline.
const AUTO_PASS_TICK_MS = 150;
// 1Hz heartbeat for the header clock chips. The server's clockUpdate$
// resyncs the canonical countdown; this just smooths the display
// between syncs.
const CLOCK_TICK_MS = 1000;

/**
 * Abstraction over "send a GameCommand to the active match". The store
 * owns auto-pass, which needs to fire a `pass` command, but must not
 * depend on the page's HTTP plumbing — so command dispatch is injected.
 * The default factory resolves the match id from MatchService.current
 * and posts via MatchService.submitCommand.
 */
export interface GameCommandSender {
  send(cmd: GameCommand): void;
}

export const GAME_COMMAND_SENDER = new InjectionToken<GameCommandSender>('GAME_COMMAND_SENDER', {
  providedIn: 'root',
  factory: () => {
    const matchSvc = inject(MatchService);
    return {
      send(cmd: GameCommand): void {
        const id = matchSvc.current()?.id;
        if (!id) return;
        void matchSvc.submitCommand(id, cmd).then(r => {
          if (!r.ok) console.warn('submitCommand failed', cmd, r.error);
        });
      },
    };
  },
});

export interface TimerState { text: string; active: boolean; low: boolean }
export interface ClockAnchor {
  creatorMs: number;
  opponentMs: number;
  holderSub: string | null;
  at: number;
}

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
  // Client-derived counter of lands the viewer has played this turn.
  // CR 305.2 — default cap is 1/turn. The server's
  // LandDropTracker is the canonical source but `PlayerDto` doesn't
  // surface it today, so the auto-pass guard derives the count from
  // CardMovedEvent (Hand → Battlefield, type Land, owned by the viewer)
  // and resets on TurnStartedEvent. Worst-case under-counts when the
  // viewer has an Azusa-style multi-land effect — conservative bias
  // means we'd just stop auto-passing on the main phase, which is the
  // safer side of the guard.
  landsPlayedThisTurn: number;
  // Latest aria-live announcement — driven by patchGameState side
  // effects (turn / phase / stack / life events). Consumers bind this
  // to a sr-only `aria-live="polite"` region. The seq counter forces
  // re-announcement even when the text repeats (screen readers
  // de-dupe identical text, so we string a zero-width space + seq to
  // keep transitions audible).
  lastAnnouncement: string;
  lastAnnouncementSeq: number;
  // ---- Match-session state (Slice 2b — moved out of MatchPage) ----
  // Full Control mode — press-once toggle on the Ctrl / Meta key.
  // While true the auto-pass guard short-circuits so the viewer keeps
  // priority on every step (mirrors MTGO's Full Control toggle).
  fullControl: boolean;
  // Local clock anchor. Re-stamped on every fresh Match snapshot
  // (clockUpdate$ + match-state refresh) so the local 1Hz tick computes
  // the countdown off the most recently-confirmed clock value.
  clockAnchor: ClockAnchor | null;
  // Wall-clock timestamp (ms) of the last observed stack mutation. The
  // auto-pass guard reads this to enforce STACK_MUTATION_DISPLAY_MS.
  lastStackMutatedAt: number | null;
  // Cheap signature ("len|id1,id2,…") of the last stack snapshot seen;
  // a change stamps lastStackMutatedAt. "0|" = empty / never-populated.
  lastStackSig: string;
  // Stable de-dupe key of the prompt we last auto-passed. Replaces the
  // old reference-identity check so re-emitted (fresh-object) prompts
  // with the same logical key don't get passed twice.
  lastAutoPassedPromptKey: string | null;
  // Internal heartbeat signals (driven by withHooks intervals; settable
  // in tests for determinism):
  //   * tick     — 1Hz wall-clock for the header timer chips.
  //   * autoPassTick — ~150ms wall-clock so the auto-pass guard
  //     re-evaluates when the stack-display window expires.
  tick: number;
  autoPassTick: number;
};

const initial: GameStoreState = {
  state: null,
  prompt: null,
  stateVersion: 0,
  selfPlayerIds: [],
  recentDecisions: [],
  phaseStops: {},
  landsPlayedThisTurn: 0,
  lastAnnouncement: '',
  lastAnnouncementSeq: 0,
  fullControl: false,
  clockAnchor: null,
  lastStackMutatedAt: null,
  lastStackSig: '0|',
  lastAutoPassedPromptKey: null,
  tick: Date.now(),
  autoPassTick: Date.now(),
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
  // Clock + auto-pass derivations. These read the viewer sub
  // (AuthUserStore.principal), the live MatchDto (MatchService.current),
  // and store-internal tick signals — injected here so the store is the
  // single source of truth and is unit-testable with fake providers.
  withComputed((store, auth = inject(AuthUserStore), matchSvc = inject(MatchService)) => ({
    selfTimerState: computed<TimerState | null>(() =>
      timerStateFor('self', matchSvc.current(), store.clockAnchor(), auth.principal()?.sub ?? null, store.tick())),
    opponentTimerState: computed<TimerState | null>(() =>
      timerStateFor('opponent', matchSvc.current(), store.clockAnchor(), auth.principal()?.sub ?? null, store.tick())),
    // Pure auto-pass decision wrapping shouldAutoPass(prompt, deps). Reads
    // autoPassTick so it re-evaluates when the stack-display window
    // expires (otherwise it would only recompute on prompt / state /
    // phaseStops / control changes and could stay pinned past the
    // window's natural expiry).
    shouldAutoPassNow: computed<boolean>(() => {
      const p = store.prompt();
      const ids = store.selfPlayerIds();
      if (!p || !ids.includes(p.playerId)) return false;
      const deps: AutoPassDeps = {
        state: store.state(),
        selfPlayerIds: ids,
        phaseStops: store.phaseStops(),
        fullControl: store.fullControl(),
        lastStackMutatedAt: store.lastStackMutatedAt(),
        nowMs: store.autoPassTick(),
      };
      return shouldAutoPass(p, deps);
    }),
  })),
  withMethods((store, sender = inject(GAME_COMMAND_SENDER), matchSvc = inject(MatchService)) => ({
    setState(next: GameState | null): void {
      patchState(store, s => ({
        state: next,
        stateVersion: s.stateVersion + 1,
        // When the snapshot carries an authoritative youPlayerId (set by
        // the server since Slice 2a), use it to derive selfPlayerIds.
        // Fall back to the existing selfPlayerIds when the snapshot lacks
        // the field (e.g. spectator view, older server). Never clear on
        // a null snapshot — reset() is the explicit teardown path.
        selfPlayerIds: next?.youPlayerId ? [next.youPlayerId] : s.selfPlayerIds,
      }));
    },
    setSelfPlayerIds(ids: string[]): void {
      patchState(store, { selfPlayerIds: ids });
    },
    setPrompt(p: PromptEnvelope | null): void {
      patchState(store, { prompt: p, lastAutoPassedPromptKey: null });
    },
    clearPrompt(): void {
      patchState(store, { prompt: null, lastAutoPassedPromptKey: null });
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
      // Lands-played-this-turn bookkeeping runs regardless of whether the
      // structural patch below succeeds — TurnStartedEvent and viewer
      // land drops are both observable from the event payload alone, and
      // we want the counter to stay live even when the reducer signals a
      // /state refetch (e.g. Hand → Battlefield is not patchable).
      const landsDelta = computeLandsPlayedDelta(evt, store.selfPlayerIds());
      const next = patchGameState(current, evt);
      if (!next) {
        if (landsDelta !== null) {
          patchState(store, s => ({
            landsPlayedThisTurn: applyLandsDelta(s.landsPlayedThisTurn, landsDelta),
          }));
        }
        return false;
      }
      const announcement = announcementFor(evt, current, next, store.selfPlayerIds());
      patchState(store, s => {
        const base: Partial<GameStoreState> = { state: next, stateVersion: s.stateVersion + 1 };
        if (landsDelta !== null) {
          base.landsPlayedThisTurn = applyLandsDelta(s.landsPlayedThisTurn, landsDelta);
        }
        if (announcement) {
          base.lastAnnouncement = announcement;
          base.lastAnnouncementSeq = s.lastAnnouncementSeq + 1;
        }
        return base;
      });
      return true;
    },
    /** Publish a free-form aria-live announcement. */
    announce(text: string): void {
      if (!text) return;
      patchState(store, s => ({
        lastAnnouncement: text,
        lastAnnouncementSeq: s.lastAnnouncementSeq + 1,
      }));
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
    // ---- Match-session methods (Slice 2b) ----
    // Full Control press-once toggle (Ctrl / Meta in the page).
    toggleFullControl(): void {
      patchState(store, s => ({ fullControl: !s.fullControl }));
    },
    // Re-anchor the local clock off a fresh Match snapshot. Pass null to
    // clear (no current match). Stamps `at` from Date.now() so the local
    // tick can compute deltas off the most recently-confirmed value.
    setClockAnchor(m: Match | null): void {
      patchState(store, anchorPatch(m, Date.now()));
    },
    // Test seam — anchor at an explicit timestamp for deterministic
    // countdown assertions.
    setClockAnchorAt(m: Match | null, at: number): void {
      patchState(store, anchorPatch(m, at));
    },
    // Stack-mutation tracker. Hash the snapshot's stack into a cheap
    // signature; when it differs from the last seen one, the stack
    // changed and we stamp lastStackMutatedAt to enforce the
    // minimum-display window. No-op when unchanged.
    recordStackMutation(next: GameState | null): void {
      const sig = stackSignature(next);
      if (sig === store.lastStackSig()) return;
      patchState(store, { lastStackSig: sig, lastStackMutatedAt: Date.now() });
    },
    // Test seam — drive the 1Hz header-clock tick deterministically.
    setTick(now: number): void {
      patchState(store, { tick: now });
    },
    // Test seam — drive the ~150ms auto-pass heartbeat deterministically.
    setAutoPassTick(now: number): void {
      patchState(store, { autoPassTick: now });
    },
    // Auto-pass driver. When shouldAutoPassNow is true and the prompt's
    // stable key differs from the last one we auto-passed, send a pass
    // and record the key. Idempotent on re-emit of the same logical
    // prompt (the key, not object identity, dedupes) within a single
    // window. Exposed as a plain method so it's directly unit-testable;
    // a setInterval in onInit drives it on the ~150ms heartbeat.
    //
    // Defense-in-depth guard: only dispatch when the loaded match's
    // gameId matches the prompt's gameId. GameStore is providedIn:'root'
    // and outlives any single match; a rapid match switch could leave a
    // stale prompt in the store while MatchService.current() has already
    // advanced to a different game. In that window the store's prompt is
    // stale relative to the active match — sending a pass would route it
    // to the wrong game. Correspondence: Match.gameId ↔ PromptEnvelope.gameId.
    runAutoPass(): void {
      if (!store.shouldAutoPassNow()) return;
      const p = store.prompt();
      if (!p) return;
      // Skip if the loaded match's gameId does not match the prompt's gameId.
      const currentGameId = matchSvc.current()?.gameId ?? null;
      if (currentGameId !== p.gameId) return;
      const key = autoPassPromptKey(p);
      if (key === store.lastAutoPassedPromptKey()) return;
      patchState(store, { lastAutoPassedPromptKey: key });
      sender.send({ $type: 'pass' });
    },
    reset(): void {
      patchState(store, initial);
    },
  })),
  withHooks({
    onInit(store) {
      // ~150ms auto-pass heartbeat: advances autoPassTick (so the
      // shouldAutoPassNow computed re-evaluates past the stack-display
      // window) and re-runs the auto-pass driver.
      const autoPassHandle = setInterval(() => {
        store.setAutoPassTick(Date.now());
        store.runAutoPass();
      }, AUTO_PASS_TICK_MS);
      // 1Hz clock heartbeat for the header timer chips.
      const clockHandle = setInterval(() => store.setTick(Date.now()), CLOCK_TICK_MS);
      intervalHandles.set(store, [autoPassHandle, clockHandle]);
    },
    onDestroy(store) {
      const handles = intervalHandles.get(store);
      if (handles) {
        for (const h of handles) clearInterval(h);
        intervalHandles.delete(store);
      }
    },
  })
);

// Per-store interval handles for the withHooks lifecycle. A WeakMap so
// the handles are GC'd with the store instance (the root store lives for
// the app lifetime; this is here for symmetry + future per-instance use).
const intervalHandles = new WeakMap<object, ReturnType<typeof setInterval>[]>();

// Build the clockAnchor patch from a Match snapshot (or clear it).
function anchorPatch(m: Match | null, at: number): Partial<GameStoreState> {
  if (!m) return { clockAnchor: null };
  return {
    clockAnchor: {
      creatorMs: m.creatorMillisRemaining,
      opponentMs: m.opponentMillisRemaining,
      holderSub: m.priorityHolderSub,
      at,
    },
  };
}

// View-model builder for the header timer chips. Ported verbatim from
// MatchPage.timerStateFor — `active` flips on for the priority holder
// (their clock burns), `low` triggers at ≤30s.
function timerStateFor(
  side: 'self' | 'opponent',
  m: Match | null,
  anchor: ClockAnchor | null,
  mySub: string | null,
  nowMs: number,
): TimerState | null {
  if (!m || !anchor || !mySub) return null;
  const iAmCreator = mySub === m.creator.sub;
  const targetIsCreator = side === 'self' ? iAmCreator : !iAmCreator;
  const baseMs = targetIsCreator ? anchor.creatorMs : anchor.opponentMs;
  const targetSub = targetIsCreator ? m.creator.sub : m.opponent?.sub ?? null;
  if (targetSub == null) return null;
  const holdsPriority = anchor.holderSub != null && anchor.holderSub === targetSub;
  const elapsedSinceAnchor = holdsPriority ? nowMs - anchor.at : 0;
  const remaining = Math.max(0, baseMs - elapsedSinceAnchor);
  return {
    text: formatMmSs(remaining),
    active: holdsPriority,
    low: remaining <= 30_000,
  };
}

// MM:SS string for the header chip — caps at 99:59.
function formatMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.min(99, Math.floor(totalSec / 60));
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// -----------------------------------------------------------------
// Track the viewer's lands played this turn.
//   * TurnStartedEvent — reset to 0 (the engine clears LandDropTracker
//     at the same moment, see TurnDriver/LandDropTracker.ResetForTurn).
//   * CardMovedEvent (Hand → Battlefield, types includes "land",
//     ownerId ∈ selfPlayerIds) — increment by 1.
// Anything else returns null (no change). The numeric returned by an
// increment is "+1" / by a reset is the literal 0 sentinel — see
// applyLandsDelta below.
// -----------------------------------------------------------------
type LandsDelta = { kind: 'reset' } | { kind: 'inc' };

export function computeLandsPlayedDelta(
  evt: NormalisedEventDto,
  selfIds: readonly string[],
): LandsDelta | null {
  if (evt.type === 'TurnStartedEvent') {
    return { kind: 'reset' };
  }
  if (evt.type !== 'CardMovedEvent') return null;
  const from = pickString(evt.payload, 'from');
  const to = pickString(evt.payload, 'to');
  if (from !== 'Hand' || to !== 'Battlefield') return null;
  // Masked Hand → Battlefield never happens in the engine (Battlefield
  // is public CR 400.2), but guard anyway: a hidden=true move carries
  // no type metadata so we can't classify it.
  if (pickBoolean(evt.payload, 'hidden') === true) return null;
  const ownerId = pickString(evt.payload, 'ownerId');
  if (!ownerId || !selfIds.includes(ownerId)) return null;
  const types = pickStringArray(evt.payload, 'types') ?? [];
  const isLand = types.some(t => t.toLowerCase() === 'land');
  if (!isLand) return null;
  return { kind: 'inc' };
}

function applyLandsDelta(current: number, delta: LandsDelta): number {
  return delta.kind === 'reset' ? 0 : current + 1;
}

// -----------------------------------------------------------------
// Compose an aria-live string from a freshly-applied engine event.
// Returns null when the event doesn't warrant an announcement (most
// CardMoved variants, hidden-zone deltas, etc.). Keep this terse —
// screen readers cut off on long polite-region updates.
// -----------------------------------------------------------------
function announcementFor(
  evt: NormalisedEventDto,
  prev: GameState,
  next: GameState,
  selfIds: readonly string[],
): string | null {
  switch (evt.type) {
    case 'TurnStartedEvent': {
      const turn = pickNumber(evt.payload, 'turn');
      const playerId = pickString(evt.payload, 'playerId');
      const isMine = playerId != null && selfIds.includes(playerId);
      return `Turn ${turn ?? next.turnNumber} — ${isMine ? 'your turn' : "opponent's turn"}`;
    }
    case 'PhaseStartedEvent':
    case 'StepStartedEvent':
    case 'PhaseChangedEvent': {
      const phase = pickString(evt.payload, 'phase', 'step', 'to') ?? next.phase;
      const active = next.activePlayerId;
      const isMine = selfIds.includes(active);
      return `Now: ${phase} — ${isMine ? 'your turn' : "opponent's turn"}`;
    }
    case 'StackObjectAddedEvent':
    case 'SpellCastEvent': {
      const desc = pickString(evt.payload, 'description');
      const kind = pickString(evt.payload, 'kind');
      const name = desc ?? kind ?? 'an object';
      return `${name} added to stack`;
    }
    case 'StackObjectResolvedEvent': {
      const id = pickString(evt.payload, 'stackId', 'id');
      const item = id ? prev.stack.find(s => s.id === id) : null;
      const name = item?.description ?? item?.kind ?? 'stack object';
      return `${name} resolved`;
    }
    case 'LifeChangedEvent': {
      const playerId = pickString(evt.payload, 'playerId');
      const before = playerId ? prev.players.find(p => p.id === playerId)?.life ?? null : null;
      const after = playerId ? next.players.find(p => p.id === playerId)?.life ?? null : null;
      const name = playerId ? next.players.find(p => p.id === playerId)?.name ?? 'player' : 'player';
      if (after == null || before == null) return null;
      const delta = after - before;
      if (delta === 0) return null;
      const verb = delta > 0 ? `gained ${delta}` : `lost ${-delta}`;
      return `${name} — ${after} life, ${verb}`;
    }
    case 'PlayerLostEvent': {
      const playerId = pickString(evt.payload, 'playerId');
      const name = playerId ? next.players.find(p => p.id === playerId)?.name ?? 'player' : 'player';
      return `${name} lost the game`;
    }
    default:
      return null;
  }
}
