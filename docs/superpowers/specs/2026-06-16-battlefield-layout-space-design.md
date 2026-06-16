# Battlefield Layout: Space Optimization + User-Adjustable Sizing

Date: 2026-06-16
Repo: `majik.portal` (frontend only — no server/API change)
Status: design, awaiting user review

## Problem

The match board wastes vertical space and clips cards (see `board.component.ts`,
`styles/board.scss`):

1. **Empty top.** The opponent strip (`.arena-strip`) is locked to **188px**
   (`board.component.ts` host styles) to reserve room for the opponent's
   face-down hand, but the visible content (life + mana) is ~32px and is
   vertically centered, leaving a large dead band.
2. **Cards cut off.** Battlefield rows (`.frontline`, `.backline__*`) use
   `overflow-y: hidden` while cards render at a fixed `140px` height. When a row
   gets less than a full card's height, cards are clipped top/bottom.
3. **Self bottom is two stacked rows.** Hand (`.hand-row`, 156px) sits above a
   separate life/mana strip (`.arena-strip--self`, 32px) = 188px reserved.

## Goals

- Reclaim wasted vertical space and give it to the battlefields.
- Never clip cards anywhere.
- Let the player manually resize the play area and have it persist between games.

Non-goals: any server/API change, opponent-side hand redesign beyond what already
exists, mobile/touch layout, theming.

## Design

Two phases. Phase 1 is the static layout fix; Phase 2 adds user-adjustable sizing
on top of it.

### Phase 1 — Layout restructure

**1a. Merge self bottom into one strip.**
Replace the two stacked self rows (`.hand-row` + `.arena-strip--self`) with a
single bottom strip, mirroring the opponent strip:

```
[ life/mana (fixed left) ][ hand cards — fill remaining, scroll horizontally ]
```

- Left: compact HUD (life) + mana pool, fixed width, vertically centered.
- Right: the hand row fills the remaining width.
- Hand cards are **medium** sized (smaller than today's 140px) so the strip stays
  short; **hover zooms** a card to full readable size (reuse existing hover/enlarge
  behavior).
- When the hand has too many cards to fit, the hand row **scrolls horizontally**
  (`overflow-x: auto; overflow-y: visible`) — cards keep their size, no clipping,
  no forced overlap collapse. Keep the existing negative-gap overlap as the
  resting look; scroll is the overflow valve.

Target self bottom strip height ≈ 80px (vs 188px today) → ~108px freed.

**1b. Battlefields absorb the freed space.**
`.arena-side` already uses `flex: 1 1 0`; with the self non-battlefield footprint
dropping from 188px to ~80px, both battlefields grow. Keep opp and self
battlefields symmetric (the 50/50 split is preserved by equal flex). The opponent
strip stays as-is (already compact, life/mana/face-down-hand on one line) — no
change needed there beyond confirming its height is its real content height, not
an over-reserved 188px.

**1c. Cut-off fix — scroll, never clip.**
Change battlefield zones (`.frontline`, `.backline__lands`, `.backline__utility`)
from `overflow-y: hidden` to `overflow: auto`. Cards keep a **fixed** size; if a
row is shorter than a card, the zone scrolls instead of clipping. With the extra
height from 1b, full cards fit in the common case; scroll is the safety valve for
crowded boards / small windows.

### Phase 2 — User-adjustable sizing (persisted)

A small `LayoutPrefsService` holds the player's adjustments as signals and
mirrors them to `localStorage` (key e.g. `majik.layoutPrefs`). Loaded on board
init, written on change (debounced). Survives reloads and games on this browser.
A "reset to defaults" control clears it.

```ts
interface LayoutPrefs {
  cardScale: number;   // multiplier on base card size, e.g. 0.7–1.4, default 1.0
  oppSelfRatio: number;// vertical split of the two battlefields, default 0.5
  handStripPx: number; // self bottom strip height, clamped, default ~80
}
```

**2a. Overall card scale.**
Card size is already driven by CSS vars `--majik-card-w` / `--majik-card-h`
(`styles/board.scss`). A slider sets `cardScale`; the board host applies it as an
inline style override of those vars (`--majik-card-w: calc(<base> * scale)`), so
every card (hand + battlefield) scales together. Per-zone overrides (opp hand,
zone-pile thumbnails) keep their relative ratios since they derive from the same
vars.

**2b. Draggable zone dividers.**
Add thin drag handles on two boundaries:
- The **centerline** between the opponent and self battlefields → adjusts
  `oppSelfRatio` (sets the two `.arena-side` flex-grow values, e.g. `ratio` /
  `1 - ratio`).
- The boundary between the **self battlefield and the bottom strip** → adjusts
  `handStripPx` (the bottom strip's fixed height), clamped to a sane min/max.

Implement with a small reusable resize-handle (pointer events: pointerdown →
capture → translate dx/dy into a pref delta → write to the service). Keyboard
nudge (arrow keys when focused) for accessibility. Cursor `row-resize`.

**2c. Controls surface.**
A compact "layout" control (card-scale slider + reset button) lives in a small
popover, triggered from the action bar or a gear in the board corner. The drag
handles are inline on the board itself.

## Components / files touched

- `routes/match/components/board.component.ts` — host height styles, template:
  merge self bottom strip, add divider handles, apply card-scale var override.
- `styles/board.scss` — `.arena-strip--self`/`.hand-row` → merged strip;
  `.frontline`/`.backline__*` overflow change; divider handle styles.
- New `LayoutPrefsService` (under match feature or a shared service dir) — signals
  + localStorage persistence with a versioned schema + reset.
- New resize-handle directive/component (small, reusable).
- New layout-controls popover component (card-scale slider + reset).

## Data flow

`LayoutPrefsService` (signals, localStorage-backed) → board reads signals →
applies as inline CSS var overrides + flex values. Drag handles and the slider
write back to the service; the service debounces persistence. No server round-trip.

## Error handling / edge cases

- Corrupt/absent localStorage → fall back to defaults; never throw.
- Schema version bump → if stored `version` mismatches, discard and use defaults.
- Clamp every persisted value on load (`cardScale`, `oppSelfRatio`, `handStripPx`)
  so a bad/edited value can't break layout.
- Very large hand → horizontal scroll (1a); very crowded battlefield → zone scroll
  (1c). Both already covered.
- Window resize → flex + scroll keep everything visible; px-based `handStripPx`
  re-clamped against viewport on resize.

## Testing

- Unit: `LayoutPrefsService` — defaults, load/clamp/persist round-trip, corrupt
  data fallback, version mismatch discard, reset.
- Component: board renders merged self strip; hand overflow scrolls horizontally;
  battlefield zones use `overflow:auto` (no clip); card-scale var override applies;
  divider drag updates the bound flex/height.
- Manual/visual: confirm against the original screenshot — top gap gone, no clipped
  cards, drag + slider work, reload preserves adjustments.

## Phasing

- **Phase 1** (1a–1c): static layout fix. Independently shippable, addresses the
  three reported problems.
- **Phase 2** (2a–2c): adjustable sizing + persistence. Builds on Phase 1.

Each phase is its own PR.
