# On-board click-to-select — design

Date: 2026-06-16
Repo: majik.portal (frontend only — no server/contract change)

## Problem

During a match, choosing a target (or a creature to sacrifice, attackers, blockers)
pops a modal candidate grid (`prompt-overlay.component.ts`). The player cannot see
which objects on the board are legal, and clicking the board does nothing. We want
the player to **click the object on the board** they want to choose, with a clear
visual signal of which objects are selectable.

## Scope

In scope — board-click selection for prompts whose candidates are board-resident:

- `targets` (ChooseTargetsCommand)
- `choice` (generic ChoiceCommand PickOne/PickN — e.g. Yawgmoth sacrifice cost, Grist)
- `attackers` (DeclareAttackersCommand)
- `blockers` (DeclareBlockersCommand)

Out of scope (stay on the existing modal — candidates are NOT board permanents):
`libraryPick`, `surveil`, `revealPick`, `yesNo`, `x`, `mana`, `mode`, `mulligan`,
`bottom`.

### Non-goals / known gaps

- **Player-as-target** (e.g. Lightning Bolt to the face): the server ships prompt
  candidates as `CardSnapshotDto[]` only — players are not cards, so player /
  planeswalker-face *player* targets are not in the candidate list today. Deferred;
  it needs a server candidate-shape change (a separate cross-repo effort).
  Planeswalkers are permanents and ARE board-clickable.
- No change to the engine, DTOs, or OpenAPI contract. Pure portal work. Decisions
  emitted reuse the shapes already translated in `match.ts`
  (`targets` / `choice` / `attackers` / `blockers`).

## Behavior

### Selection mode

The board enters **selection mode** when an active prompt's kind is one of the four
in-scope kinds AND every candidate is locatable on the board (rendered with a
`data-card-id`). If any candidate is not board-locatable, the existing modal grid is
used instead (fallback path unchanged). Board and prompt-overlay already share the
`GameStore`, so selection mode is derived from `game.prompt()` — no prop drilling.

Selection mode carries: candidate instanceIds, `min`, `max`, kind, and the source
card name (for the instruction text). For `targets`, `min`/`max` come from the
target request; for `choice`, from `choiceView` (kind/min/max); for
`attackers`/`blockers` the count is open-ended (set declaration).

### Visual affordance (highlight legal + dim rest)

Applied per `app-card-view` while in selection mode:

- **Legal candidate** → `data-targetable`: accent glow/outline + `cursor: pointer`,
  `pointer-events` enabled.
- **Illegal object** → `data-dimmed`: reduced opacity, `pointer-events: none`.
- **Selected** → `data-selected`: filled accent border; a small ordinal/count badge
  when `max > 1`.

Styles are co-located in the component `styles[]` array (NOT board.scss) — jsdom in
`ng test` does not load board.scss, and asserted CSS must live in component styles;
use `//` comments only inside the inline template literal (portal test gotchas).

### Click + submit rules

- Click a `data-targetable` card → toggle membership in a `selected` signal (set of
  instanceIds).
- **Fixed count (`min === max`)** → auto-submit the moment `selected.length === max`.
  A single fixed target (min=max=1) therefore submits on one click.
- **Range / optional (`min < max`, includes "up to one" where min=0)** → toggle
  freely; the floating control shows `Done (n/max)`. Auto-submit when `n === max`;
  otherwise `Done` commits the current set. When `min === 0` and nothing is selected,
  `Done` acts as decline (submits an empty set).
- **`attackers`** → click own untapped, non-sick creatures to add/remove them from the
  attacking set; reuse the existing live SVG arrows (board already renders them from
  `liveAssignments` via the `assignmentsChanged` relay); explicit `Confirm attackers`
  button (set declaration — no auto-submit; empty set = "no attacks").
- **`blockers`** → click an own creature (blocker), then click the attacker it blocks,
  to form a pairing; reuse the SVG arrows; explicit `Confirm blocks` button. A blocker
  can be unassigned by clicking it again.

### Floating control bar

`prompt-overlay` is NOT deleted. For the four in-scope kinds it renders a **slim
banner** instead of the candidate grid:

- Source + instruction text (e.g. "Yawgmoth, Thran Physician: choose a creature to
  sacrifice", "Choose up to one target creature").
- Live count (`n/max` or `n selected`).
- Buttons: `Done` / `Confirm attackers` / `Confirm blocks` as appropriate, plus
  `Cancel` only where the action is cancellable (reuse the existing
  `showCancelButton` logic — spell-cast targeting is cancellable; mandatory choices,
  combat declarations are not).

For all OTHER kinds the overlay renders its existing modal UI unchanged.

## Components & data flow

```
GameStore (state, prompt)            ← unchanged source of truth
  │  selection mode derived from prompt() (new computed)
  ├─ board.component.ts
  │     · per-card data-targetable / data-dimmed / data-selected
  │     · (click) on board cards → toggle selected set / blocker pairing
  │     · existing SVG arrows reused for attackers/blockers
  │     · auto-submit on fixed count; emits decision
  └─ prompt-overlay.component.ts
        · in-scope kinds → slim banner (instruction + Done/Confirm/Cancel)
        · other kinds → existing modal grid (unchanged)
        · emits the SAME decision shapes as today
match.ts
  · translateDecision() → GameCommand (targets/choice/attackers/blockers) — unchanged
  · existing clearPrompt-after-send flow — unchanged
```

Selection state lives in ONE place. Recommended: a small `selection` store/computed
shared via `GameStore` (or a dedicated lightweight signal service) that both board
and overlay read, so the board owns clicks and the overlay banner owns the
Done/Confirm/Cancel buttons without duplicating the selected set. The implementation
plan picks the exact seam; the constraint is: no duplicated selection state.

## Edge cases

- Prompt arrives while a stale selection exists → reset `selected` on prompt change.
- Candidate becomes illegal mid-selection (state update) → drop it from `selected`;
  if it was the only/required pick, keep waiting.
- Optional target, min=0: `Done` with empty set declines (sends empty
  `targetInstanceIds`).
- Auto-submit must clear selection mode immediately so a follow-up prompt isn't
  mis-handled (mirror existing clearPrompt-after-send).
- Mixed-zone candidates (some on board, some not) → modal fallback (do not split).

## Testing (ng test --no-watch; jsdom)

- `detectKind`/selection-mode computed: in-scope kinds with all-board candidates →
  selection mode; off-board candidate present → modal.
- Board: a legal candidate gets `data-targetable`, an illegal one `data-dimmed`;
  click toggles `data-selected`.
- Fixed count auto-submits on reaching max; emits correct decision shape.
- Range/optional: Done commits partial; min=0 Done declines with empty set.
- Attackers/blockers: clicking declares the set/pairing, Confirm emits the existing
  decision shape; empty attackers = valid "no attacks".
- Asserted CSS lives in component `styles[]` (jsdom can't load board.scss).

## Rollout

Single portal PR (no api/contract change → no deploy ordering constraint). Auto-merge
on green per the standard PR workflow.
