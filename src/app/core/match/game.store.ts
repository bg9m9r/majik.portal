import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { GameState, PromptEnvelope } from './match.types';

// In-memory store for the live engine view of a single match. The page
// component owns the lifecycle: setState on initial bootstrap +
// re-fetched snapshots, setPrompt when a per-viewer prompt envelope
// arrives, clearPrompt when the user submits a decision. The store is
// deliberately thin — engine event payloads vary widely and many
// already imply a server state mutation, so the current strategy is to
// treat any "event" channel message as a hint and lazily re-fetch
// /matches/{id}/state rather than try to apply patches in the client.
type GameStoreState = {
  state: GameState | null;
  prompt: PromptEnvelope | null;
  // Engine player ids the viewer "owns" (single-player today, room for
  // shared-control later). Resolved when the snapshot lands by matching
  // the viewer's MatchPlayer handle to PlayerDto.name.
  selfPlayerIds: string[];
};

const initial: GameStoreState = {
  state: null,
  prompt: null,
  selfPlayerIds: [],
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
      patchState(store, { state: next });
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
    reset(): void {
      patchState(store, initial);
    },
  }))
);
