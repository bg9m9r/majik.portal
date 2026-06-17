# Match Info Drawer: unified Stack / Log / Bot-Decisions

Date: 2026-06-16
Repo: `majik.portal` (frontend only — no server/API change)
Status: design, awaiting user review

## Problem

The match board surfaces three diagnostic panels as separate floating widgets:

- **Stack** — `.stack-chip` aside in `board.component.ts` (top-right, auto-expands on cast).
- **Action log** — `app-game-log` (left-edge slide drawer, `game-log.component.ts`).
- **Bot decisions** — `app-bot-decisions-panel` (fixed bottom-right, rendered in `match.ts`).

They scatter across three screen edges, and the bottom-right Bot-Decisions toggle
floats on top of the action bar's **Pass** button (it's `position: fixed bottom-2
right-2 z-30`, overlapping the action bar). Consolidating them into one place fixes
the overlap and gives a single, predictable home.

## Goals

- One right-edge slide-out drawer hosting all three, replacing the three widgets.
- Stack always visible (top); Log/Bot-Decisions share the bottom via tabs.
- Preserve "never miss a cast": the drawer auto-opens when an object hits the stack.
- Draggable split between Stack and the bottom pane; drawer state persisted.
- Stop the Bot-Decisions toggle from covering the Pass button (it no longer floats
  over the action bar).

Non-goals: server/API change; redesigning the stack-priority callout (the
above-action-bar "Opponent cast X — respond or pass" banner stays as-is); the
right-edge zone rail (Library/GY/Exile) stays where it is.

## Design

### Layout

A right-edge slide-out **InfoDrawerComponent**, vertically split:

```
right edge ──▶ [tab] ┌─────────────────────────┐
                     │  STACK  (top, ~split%)   │  always visible
                     ├───── drag handle ────────┤  resize the split
                     │ [ Log | Bot Decisions ]  │  tab strip
                     │  ...bottom pane...        │  Log default; Bot replaces it
                     └─────────────────────────┘
```

- **Toggle:** a tab on the right edge slides the drawer in/out. Drawer overlays from
  the edge (does not displace the zone rail).
- **Top pane — Stack:** newest-on-top, resolves top→bottom (unchanged semantics).
- **Drag handle:** between Stack and the bottom pane, using the existing
  `ResizeHandleDirective` (vertical drag → adjusts the split ratio).
- **Bottom pane — tabbed:** `[ Log | Bot Decisions ]`. Log is the default; selecting
  Bot Decisions replaces the Log content in the same pane. The last-selected bottom
  tab is remembered.

### Behavior

- **Auto-open on cast:** when the stack transitions from empty→non-empty (or grows),
  the drawer opens (an `effect` in the board, mirroring today's stack-chip
  auto-expand). The above-action-bar callout is unchanged.
- **Stay as left:** drawer open/closed persists across the match and reloads. After
  auto-opening for a cast it does NOT auto-close when the stack empties — the user
  closes it manually. (The overlay doesn't eat board space, so staying open is fine.)
- **Persistence:** open/closed, active bottom tab, and split ratio persist to
  `localStorage` via `LayoutPrefsService`.

### State (LayoutPrefsService additions)

Extend `LayoutPrefs` with three fields (backward-compatible — `read()` already
fills missing keys via `?? DEFAULT`, so no `SCHEMA_VERSION` bump and existing
card-scale prefs survive):

```ts
infoDrawerOpen: boolean;       // default false
infoDrawerTab: 'log' | 'bot';  // default 'log'
infoDrawerSplit: number;       // stack's share of drawer height, default 0.5, clamp [0.2, 0.8]
```

Add matching write-through setters (`setInfoDrawerOpen`, `setInfoDrawerTab`,
`setInfoDrawerSplit`) and include the fields in `reset()` and the persisted payload.
`CLAMP.infoDrawerSplit = [0.2, 0.8]`.

### Components / files

- **New `InfoDrawerComponent`** (`routes/match/components/info-drawer.component.ts`):
  right-edge slide-out shell. Inputs: `stack: StackItemView[]`, `logEntries: LogLine[]`,
  `selfIds: string[]`, `botDecisions: BotDecision[]`. Injects `LayoutPrefsService` for
  open/tab/split. Hosts the stack list (top), the resize handle, and the bottom tab
  strip + the active bottom content.
- **New `StackListComponent`** (`routes/match/components/stack-list.component.ts`):
  presentational — the stack-item markup currently inline in `board.component.ts`
  `.stack-chip` (the `@for reversedStack` block, item classes, animations) extracted
  so the drawer can host it and the board no longer renders the chip. Input:
  `items: StackItemView[]`.
- **Refactor `GameLogComponent` → list-only:** drop its own `.game-log` drawer chrome,
  edge tab, and `open` signal; keep the rows + auto-scroll. Inputs unchanged
  (`entries`, `selfIds`). The drawer owns positioning/visibility now.
- **Refactor `BotDecisionsPanelComponent` → list-only:** drop the `fixed`
  positioning, toggle button, and `open` signal; keep the decision rows. Input
  unchanged (`decisions`). (Rename to `BotDecisionsListComponent` for clarity.)
- **`board.component.ts`:** remove the `.stack-chip` aside and the `app-game-log`
  usage; render `<app-info-drawer>` instead, passing `reversedStack()`,
  `logEntries()`, `selfPlayerIds()`, and `gameStore.recentDecisions()` (the board
  already injects `GameStore`; confirm the store exposes a `recentDecisions` signal —
  it backs the ring buffer at `game.store.ts:99`). Add the auto-open `effect`.
- **`match.ts`:** remove `app-bot-decisions-panel` usage + import (the data now flows
  through the board via `GameStore`, so no input threading is needed).

### Reuse / boundaries

The drawer composes three focused presentational children (StackList, GameLog list,
BotDecisions list), each rendering one data shape and nothing else. The drawer owns
chrome (edge tab, split, tabs, persistence). This keeps each unit independently
testable and small.

## Error handling / edge cases

- Empty stack → top pane shows an "empty" placeholder (as the chip does today).
- Corrupt/missing drawer prefs → defaults (closed, Log, 0.5) via existing `read()`
  fallback + clamp.
- Split clamped [0.2, 0.8] so neither pane collapses.
- `recentDecisions` empty → bottom Bot tab shows "No bot decisions yet."
- The stack-priority callout above the action bar is untouched (independent notifier).

## Testing

- `LayoutPrefsService`: new fields default/clamp/persist/reset round-trip; backward
  compat (a stored v1 blob without the new keys loads with defaults, card-scale
  preserved).
- `StackListComponent`: renders one row per stack item, newest-first, top-of-stack
  marker.
- `GameLogComponent` (list-only): renders rows, self/foe/meta classes, no drawer
  chrome remains.
- `BotDecisionsListComponent`: renders rows; empty state.
- `InfoDrawerComponent`: toggle opens/closes (persisted); bottom tab switches Log↔Bot
  (persisted); drag handle updates split; Stack pane always rendered.
- `board.component.ts`: `.stack-chip` and `app-game-log` gone; `<app-info-drawer>`
  present; a new stack object opens the drawer (auto-open effect).
- `match.ts`: `app-bot-decisions-panel` gone; no regressions.

## Phasing

Single plan; suggested task order: LayoutPrefs fields → presentational extractions
(StackList, GameLog list-only, BotDecisions list-only) → InfoDrawerComponent →
board wiring + auto-open + removals → match.ts removal. Each is its own commit/PR-able
slice.
