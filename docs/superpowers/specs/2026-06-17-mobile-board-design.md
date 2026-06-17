# Mobile match board — design

Date: 2026-06-17
Repo: `majik.portal` (frontend only — no server/contract change)
Status: design, awaiting user review

## Problem

The match board is desktop-only. Before phase 1 (#143) the simpler surfaces
(login/lobby/decks/onboarding/nav) were not responsive at all; #143 fixed those.
The board itself remains unusable on a phone: fixed-size cards, a two-seat layout
assuming a wide viewport, and hover-only affordances that never fire on touch.

This design makes the **match board playable on a phone**. Per the brainstorm, the
target is **landscape-only** play — the MTG board is inherently wide, and the
existing board structure already supports adjustable card sizing, so landscape lets
us reuse the whole layout scaled down rather than rebuilding it for portrait.

## What already exists (foundation — do NOT rebuild)

Recent merged work covers a large part of what a touch board needs, because it is
pointer-based and already works under touch:

- **#140 on-board click-to-select** — tap a board object to choose it for
  `targets` / `choice` / `attackers` / `blockers`; legal candidates get
  `data-targetable` glow, illegal ones `data-dimmed`, selected `data-selected`;
  the prompt-overlay renders a slim banner instead of the modal grid for those
  kinds. See `docs/superpowers/specs/2026-06-16-board-click-to-select-design.md`.
- **#141 clickable player HUD as a spell target** — player/face targets are
  board-tappable.
- **#139 battlefield layout + user-adjustable sizing** — the board renders at a
  `--majik-card-scale` the user can adjust, and the value persists.

Consequence: **targeting, choices, attacker and blocker declaration are already a
tap-to-act flow.** This design does NOT re-spec them. It adds the mobile-specific
pieces around them.

## Scope (mobile board v1)

In scope:

1. **Mobile-board detection** — an `isMobileBoard` signal, true when the pointer is
   coarse and the viewport is small. Scoped to the match route only; lobby/decks/
   login keep their phase-1 responsive treatment. Desktop (fine pointer) is
   completely unaffected — `isMobileBoard` false renders today's board verbatim.
2. **Rotate-to-play overlay** — when `isMobileBoard` and the orientation is
   portrait, the match route shows a full-screen "Rotate your device to play"
   prompt and does NOT render the board. The board only ever lays out in landscape.
3. **Mobile card-scale default** — when `isMobileBoard`, default `--majik-card-scale`
   to a smaller mobile value (tune ~0.55–0.65) via the existing adjustable-sizing
   mechanism. Wide rows scroll sideways using the `overflow-x` already on
   `.frontline` / `.hand-row`. No dynamic fit-to-height measure loop (explicit
   non-goal).
4. **Chrome compression** — behind the mobile branch only: shrink the seat strips
   (HUD + mana + hand), thin the phase bar, compact the life/HUD text and the
   bottom action bar so two seats + hands + chrome fit a ~375–430px landscape
   height. Desktop spacing unchanged.
5. **Tap-to-play from hand + tap-to-activate** — extend the existing click-to-select
   pattern to the two actions still drag-only today:
   - **Play from hand**: tap a playable card in hand → it becomes selected and its
     legal destination(s) highlight; tap the destination (or auto-resolve when
     there is exactly one) to cast/play. Mirrors the #140 selection model.
   - **Activate ability**: tap a permanent with an available activated ability →
     surface its ability(ies); selecting one enters the existing targeting flow if
     it needs targets.
   These two are **gated to `isMobileBoard`** (per the brainstorm's "mobile-only"
   decision); desktop keeps drag for play and its current activation affordance.
6. **Long-press preview** — long-press (~400ms, cancels on finger move) any card →
   the existing `CardDetailPopover` / zoom. Single tap stays "act". The act-selected
   card may also show an enlarged inline preview from selection state.
7. **Bottom-sheet for non-spatial prompts** — the prompt kinds #140 left on the
   modal because their candidates are NOT board objects (`libraryPick`, `surveil`,
   `revealPick`, `yesNo`, `x`, `mana`, `mode`, `mulligan`, `bottom`) render as a
   compact bottom-sheet when `isMobileBoard`, instead of the centered
   `max-w-3xl` modal, so the board stays visible. Desktop keeps the modal.
8. **Disable CDK drag on touch** — when `isMobileBoard`, the hand→battlefield drag
   listeners are disabled so tap-to-play is the single input path (no double-handling).

Out of scope (later):

- Dynamic fit-to-height auto-shrink.
- Portrait gameplay layout (stacked/tabbed seats).
- Unifying tap-to-act onto desktop (desktop keeps drag).
- Pinch-zoom / pan, haptics, animation polish.

## Behavior detail

### `isMobileBoard` detection

`isMobileBoard = matchMedia('(pointer: coarse)').matches && <viewport is small>`.
Implemented as a signal that reacts to `matchMedia` change events and viewport
resize. Orientation (portrait vs landscape) is a separate derived signal used only
by the rotate overlay. Both live in a small service/computed consumed by the match
route + board; no prop drilling (same pattern as the existing `GameStore`-derived
selection mode).

### Rotate overlay

Rendered by the match route (not the board) so the board never mounts in portrait.
Pure presentational; dismisses automatically when orientation becomes landscape.

### Tap-to-play / tap-to-activate

Reuse the #140 selection seam (single shared `selection` state, no duplicated set).
Play-from-hand and activate extend that machine with new sources (a hand card; a
permanent's ability) and their legal destinations/targets. Where an action has
exactly one legal resolution, auto-resolve on the first tap (mirrors #140's
fixed-count auto-submit). Decisions emitted reuse the existing `match.ts`
command translation — no new server commands.

### Bottom-sheet

The prompt-overlay gains a mobile presentation branch: for the non-board prompt
kinds, render the same content (candidate list / number picker / yes-no / mode
list) inside a bottom-anchored sheet sized to content, instead of the centered
modal. Same emitted decision shapes.

## Components & data flow

```
mobile-board signal (pointer-coarse + small viewport)   ← new
  ├─ match route
  │     · portrait + mobile → rotate overlay (board not rendered)
  │     · landscape + mobile → board with mobile chrome + scale
  ├─ board.component.ts
  │     · isMobileBoard → mobile --majik-card-scale default + compressed strips
  │     · CDK drag disabled when isMobileBoard
  │     · tap-to-play / tap-to-activate extend the #140 selection machine
  │     · long-press → CardDetailPopover
  └─ prompt-overlay.component.ts
        · #140 in-scope kinds → existing slim banner (unchanged)
        · non-board kinds + isMobileBoard → bottom-sheet (new branch)
        · non-board kinds + desktop → existing modal (unchanged)
```

Selection state stays in the single place #140 established — this design adds
sources to that machine, it does not introduce a parallel one.

## Edge cases

- Orientation flips mid-match → board mounts/unmounts cleanly via the overlay;
  active prompt/selection state survives (lives in `GameStore`, not the board).
- `matchMedia('(pointer: coarse)')` true on hybrid laptops with touch — acceptable:
  such a device still gets a working board; the scale is user-adjustable (#139).
- Long-press vs scroll: a moved finger cancels the press and is treated as scroll,
  never as an act-tap.
- Tap-to-play when a card has multiple legal zones/modes → no auto-resolve; the
  destination/mode is chosen by a follow-up tap or the bottom-sheet.

## Testing (`ng test --no-watch`; jsdom)

- jsdom does NOT load `board.scss`; asserted mobile CSS must live in component
  `styles[]`; use `//` comments only in inline template literals (portal gotcha).
- `isMobileBoard` derivation: mock `matchMedia` + viewport → asserts coarse+small =
  true, fine pointer = false, orientation signal flips with viewport.
- Rotate overlay: visible when mobile+portrait, hidden landscape; board not rendered
  in portrait.
- Tap-to-play: tap a playable hand card highlights legal destinations; single legal
  destination auto-resolves; emits the existing play command shape.
- Tap-to-activate: tap a permanent with an ability surfaces it; needing-target
  abilities hand off to the #140 targeting flow.
- Bottom-sheet: non-board prompt kind + isMobileBoard renders the sheet, not the
  modal; same decision shape emitted.
- Drag disabled under isMobileBoard (no CDK drag handlers active).
- **Manual phone playthrough required** — human-seat interaction can't be
  bot-tested (known live-loop coverage gap).
- Portal has **no build/test CI gate** (PRs auto-merge on `dco` alone); run
  `ng test --no-watch` locally before each merge.

## Rollout

Frontend-only, no api/contract change → no deploy ordering constraint. Too large for
one PR; the implementation plan will split it into independently shippable slices,
roughly:

1. `isMobileBoard` detection + mobile card-scale default + rotate overlay + chrome
   compression (the "it lays out on a phone" slice).
2. Tap-to-play from hand + tap-to-activate (extend the #140 selection machine);
   disable CDK drag on touch.
3. Long-press preview + bottom-sheet for non-spatial prompts.

Each slice auto-merges on green per the standard PR workflow.
