# Battlefield Layout: Space Optimization + Adjustable Sizing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reclaim wasted vertical space on the match board, stop clipping cards, merge the self hand onto the life/mana line, and let the player resize the play area with changes persisted across games.

**Architecture:** Phase 1 is pure layout (Angular template + co-located host styles in `board.component.ts`, plus `styles/board.scss`). Phase 2 adds a signal-backed `LayoutPrefsService` (localStorage-persisted) that the board reads to drive a card-scale CSS-var override and two draggable dividers (battlefield split + hand-strip height).

**Tech Stack:** Angular 21 standalone components, Angular signals + `effect`, SCSS with `--majik-*` CSS custom properties, Vitest + `@angular/core/testing` TestBed, `@angular/cdk` drag-drop (already used).

Spec: `docs/superpowers/specs/2026-06-16-battlefield-layout-space-design.md`

Key constants used throughout:
- Base card geometry: `--majik-card-w: 100px`, `--majik-card-h: 140px` (`styles/tokens.scss`, mirrored in `styles/board.scss:5-8`).
- New merged-strip height: **`STRIP_H = 116px`** (fits a medium ~80×112 hand card + padding). Both sides use it in Phase 1 so the two battlefields stay equal.
- Layout heights are co-located in `board.component.ts` `styles: [...]` (NOT only in `board.scss`) because the jsdom unit tests in `board.component.spec.ts` read them via `getComputedStyle`. Any height change MUST be made there AND reflected in the spec.

---

## Phase 1 — Layout restructure (independently shippable)

### Task 1: Merge the self hand onto the life/mana strip + shrink the opponent strip

Mirror the opponent strip (`.arena-strip` = HUD + mana + hand) on the self side. After this task the self side has ONE non-battlefield strip (`.arena-strip--self`) containing HUD, mana, and the hand cdkDropList — no separate `.hand-row` direct child. Both strips lock to `STRIP_H` so battlefields stay equal and both gain the reclaimed space.

**Files:**
- Modify: `src/app/routes/match/components/board.component.ts` (host `styles`, self-side template ~403-442)
- Test: `src/app/routes/match/components/board.component.spec.ts` (layout assertions ~1054-1141, 1287-1351)

- [ ] **Step 1: Update the failing layout-order test**

In `board.component.spec.ts`, the test at ~line 1060 (`orders the self side as battlefield → hand-row → arena-strip--self`) and the footprint `describe` at ~1287 encode the OLD three-element layout. Replace them with the new structure. Find:

```ts
  it('orders the self side as battlefield → hand-row → arena-strip--self (top → bottom)', () => {
```

Replace that whole `it` body's anchor assertions so the self side is now two anchors (battlefield then the merged strip), and assert the hand row lives INSIDE the strip:

```ts
  it('orders the self side as battlefield → arena-strip--self, with the hand row inside the strip', () => {
    const fixture = renderBoard();           // reuse the existing render helper in this file
    fixture.detectChanges();
    const side = fixture.nativeElement.querySelector('.arena-side--self') as HTMLElement;
    // direct children that aren't the absolutely-positioned zone-rail
    const anchors = Array.from(side.children).filter(
      (el) => !el.classList.contains('zone-rail'),
    ) as HTMLElement[];
    expect(anchors[0].classList.contains('battlefield')).toBe(true);
    expect(anchors[1].classList.contains('arena-strip--self')).toBe(true);
    // hand row is now nested in the strip, not a direct child of the side
    expect(side.querySelector('.arena-side--self > .hand-row')).toBeNull();
    expect(
      anchors[1].querySelector('.hand-row:not(.hand-row--opponent)'),
    ).toBeTruthy();
  });
```

> Note: if `renderBoard` is not the helper name in this file, use whatever the existing tests in this describe block call (grep for `function render` / `renderBoard` near the top of the file and reuse it verbatim — do not invent a new bootstrap).

- [ ] **Step 2: Rewrite the footprint invariant test**

Replace the entire `describe('BoardComponent — equal arena-strip footprint across both sides', ...)` block (~line 1287) with a single-strip-per-side equality check:

```ts
describe('BoardComponent — equal strip footprint across both sides', () => {
  const STRIP_H = 116;

  it('locks the opp .arena-strip and self .arena-strip--self to the same fixed height', () => {
    const fixture = renderBoard();
    fixture.detectChanges();
    const oppStrip = fixture.nativeElement.querySelector('.arena-side--foe .arena-strip') as HTMLElement;
    const selfStrip = fixture.nativeElement.querySelector('.arena-side--self > .arena-strip--self') as HTMLElement;
    const oppH = parseInt(window.getComputedStyle(oppStrip).flexBasis, 10);
    const selfH = parseInt(window.getComputedStyle(selfStrip).flexBasis, 10);
    expect(oppH).toBe(STRIP_H);
    expect(selfH).toBe(STRIP_H);
    // equal non-battlefield footprint ⇒ equal battlefield height (both
    // arena-sides are flex: 1 1 0 of the board area)
    expect(oppH).toBe(selfH);
  });
});
```

Also delete the now-obsolete tests at ~1307 (`locks the self .hand-row to the full-size hand-card-row height`) and ~1320 (`locks the self .arena-strip--self ... small info-row height`) and ~1332 (the summation invariant) — the single-strip equality above replaces all three.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd majik.portal && npx vitest run src/app/routes/match/components/board.component.spec.ts -t "footprint"`
Expected: FAIL — current code still emits 188/156/32 and a separate `.hand-row` direct child.

- [ ] **Step 4: Update the host `styles` in board.component.ts**

Replace the three height rules (`board.component.ts:136-151`):

```ts
    .arena-side--foe .arena-strip {
      flex: 0 0 188px;
      min-height: 188px;
      max-height: 188px;
      align-items: center;
    }
    .arena-side--self > .hand-row {
      flex: 0 0 156px;
      min-height: 156px;
      max-height: 156px;
    }
    .arena-side--self > .arena-strip--self {
      flex: 0 0 32px;
      min-height: 32px;
      max-height: 32px;
    }
```

with the single-strip-per-side version (STRIP_H = 116):

```ts
    .arena-side--foe .arena-strip,
    .arena-side--self > .arena-strip--self {
      flex: 0 0 116px;
      min-height: 116px;
      max-height: 116px;
      align-items: center;
    }
```

Also update the long explanatory comment block above (`board.component.ts:96-128`) so the math reads `strip-h = 116px (one strip per side, equal ⇒ equal battlefields)` instead of the old 188 = 156 + 32 derivation. Keep it accurate — the next engineer relies on it.

- [ ] **Step 5: Restructure the self-side template**

In `board.component.ts`, the self side currently renders (after the battlefield, ~403-442): a standalone `.hand-row` cdkDropList, then a separate `.arena-strip arena-strip--self` with HUD + mana. Merge them into ONE strip that mirrors the opponent's. Replace the block from `<div #selfHandList="cdkDropList"` (~403) through the closing of `.arena-strip--self` (~442) with:

```html
            <div class="arena-strip arena-strip--self">
              <app-player-hud
                class="arena-strip__hud"
                [player]="self()"
                [active]="self()?.id === s.activePlayerId"
                side="self"
                label="you" />
              <app-mana-pool-row class="arena-strip__mana" [player]="self()" />
              <div
                #selfHandList="cdkDropList"
                id="self-hand-droplist"
                class="hand-row arena-strip__hand arena-strip__hand--self"
                role="list"
                aria-label="your hand"
                cdkDropList
                cdkDropListOrientation="horizontal"
                [cdkDropListConnectedTo]="['self-battlefield-droplist']"
                (cdkDropListDropped)="onHandDrop($event)">
                @for (c of orderedSelfHand(); track c.instanceId) {
                  <button
                    type="button"
                    role="listitem"
                    class="bg-transparent p-0 focus:outline focus:outline-2 focus:outline-amber-400"
                    cdkDrag
                    [cdkDragData]="c"
                    [attr.aria-label]="'play ' + c.name"
                    animate.enter="zone-enter-from-top"
                    animate.leave="zone-leave-down">
                    <app-card-view
                      [snapshot]="c"
                      zone="hand"
                      [castable]="castableIds().has(c.instanceId)" />
                    <div *cdkDragPlaceholder class="hand-card-placeholder"></div>
                  </button>
                } @empty {
                  <span class="opacity-30">— hand empty —</span>
                }
              </div>
            </div>
```

> The hand keeps `id="self-hand-droplist"` and all cdk wiring, so `match.ts` and the battlefield↔hand connected drop lists keep working unchanged. The `.hand-row` class is retained (face-up test + drag styling depend on it); `arena-strip__hand` makes it the flex-filling element; `arena-strip__hand--self` is the Phase-1 hook for the medium card-size override (Task 2).

- [ ] **Step 6: Run the layout tests to verify they pass**

Run: `cd majik.portal && npx vitest run src/app/routes/match/components/board.component.spec.ts`
Expected: PASS (the rewritten order + footprint tests, and the existing `renders the self hand-row face-UP` test — its selector `.arena-side--self .hand-row:not(.hand-row--opponent)` is a descendant match and still resolves).

- [ ] **Step 7: Commit**

```bash
cd majik.portal && git add src/app/routes/match/components/board.component.ts src/app/routes/match/components/board.component.spec.ts
git commit -s -m "feat(board): merge self hand onto the life/mana strip; equalize strips at 116px

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: SCSS for the merged hand strip — medium cards + horizontal scroll

Style the in-strip self hand: medium card size (resting), hover-zoom already works (it's a fixed-position popover via `CardPopoverService`, unaffected by strip overflow), and horizontal scroll when the hand overflows.

**Files:**
- Modify: `src/styles/board.scss` (`.arena-strip__hand` ~307-316, `.hand-row` ~318-324)
- Test: `src/app/routes/match/components/board.component.spec.ts` (add one assertion)

- [ ] **Step 1: Add the failing assertion for horizontal scroll**

Append to the `describe('BoardComponent — equal strip footprint across both sides', ...)` block:

```ts
  it('self hand row scrolls horizontally on overflow (overflow-x:auto, nowrap)', () => {
    const fixture = renderBoard();
    fixture.detectChanges();
    const hand = fixture.nativeElement.querySelector(
      '.arena-side--self .arena-strip__hand--self',
    ) as HTMLElement;
    const style = window.getComputedStyle(hand);
    expect(style.overflowX).toBe('auto');
    expect(style.flexWrap).toBe('nowrap');
  });
```

> If the SCSS under test isn't loaded in jsdom for these specs (the existing footprint tests rely on the co-located `board.component.ts` `styles`, not `board.scss`), this assertion may not see `board.scss` rules. Verify by running it: if `overflowX` comes back empty, MOVE the three declarations (`overflow-x`, `overflow-y`, `flex-wrap`) for `.arena-strip__hand--self` into the component's co-located `styles: [...]` block instead of `board.scss`, and keep the assertion. Do not skip the assertion.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd majik.portal && npx vitest run src/app/routes/match/components/board.component.spec.ts -t "scrolls horizontally"`
Expected: FAIL.

- [ ] **Step 3: Update `.arena-strip__hand` / `.hand-row` SCSS**

In `src/styles/board.scss`, extend the `.arena-strip__hand` rule (currently ~307-316) and add the self variant:

```scss
  &__hand {
    flex: 1 1 auto;
    min-height: 0;
    justify-content: flex-end;
    // Opp face-down hand sits inside the strip — squeeze the card
    // size down so it doesn't push the strip taller than the HUD.
    --majik-card-w: 56px;
    --majik-card-h: 78px;
  }

  // Self hand lives in the same strip now. Medium cards (hover zooms to
  // full via the CardPopoverService overlay, which is position:fixed and
  // unaffected by this row's overflow). Horizontal scroll when the hand
  // overflows; cards keep their size — never clipped, never force-collapsed.
  &__hand--self {
    --majik-card-w: 80px;
    --majik-card-h: 112px; // 80 * 7/5
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    justify-content: safe center;
  }
```

Then make `.hand-row` tolerant of living inside the strip — its `min-height: var(--majik-card-h)` is fine (112px < STRIP_H 116px). Leave the negative-gap overlap as the resting look:

```scss
.hand-row {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: calc(var(--majik-space-2) * -1);
  min-height: var(--majik-card-h);
}
```

(no change needed to `.hand-row` itself; the `--self` overrides win via specificity since both classes are on the element and `--majik-card-h` is set on the same node.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd majik.portal && npx vitest run src/app/routes/match/components/board.component.spec.ts -t "scrolls horizontally"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd majik.portal && git add src/styles/board.scss src/app/routes/match/components/board.component.spec.ts
git commit -s -m "feat(board): medium self-hand cards in-strip with horizontal overflow scroll

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Cut-off fix — battlefield rows scroll instead of clipping

Change the three battlefield card rows from `overflow-y: hidden` to `overflow-y: auto` so a row shorter than a card scrolls instead of slicing cards. With the reclaimed height from Tasks 1–2 the common case fits full cards; scroll is the safety valve.

**Files:**
- Modify: `src/styles/board.scss` (`.frontline` ~67-82, `.backline__lands`/`__utility` ~96-109)
- Test: `src/app/routes/match/components/board.component.spec.ts`

- [ ] **Step 1: Add the failing assertion**

Append to the zoned-battlefield describe (`describe('BoardComponent — zoned battlefield layout', ...)`, ~910):

```ts
  it('battlefield rows scroll (overflow-y:auto) rather than clipping cards', () => {
    const fixture = renderBoard();
    fixture.detectChanges();
    const front = fixture.nativeElement.querySelector('.arena-side--self .frontline') as HTMLElement;
    const lands = fixture.nativeElement.querySelector('.arena-side--self .backline__lands') as HTMLElement;
    expect(window.getComputedStyle(front).overflowY).toBe('auto');
    expect(window.getComputedStyle(lands).overflowY).toBe('auto');
  });
```

> Same jsdom caveat as Task 2: if `overflowY` reads empty, these rules aren't loaded in the test. In that case add the assertion against the SCSS via a `@testing` style include is overkill — instead keep the change in `board.scss` and convert this step's assertion to a Vitest snapshot of the compiled rule is NOT worth it. Simplest: if jsdom doesn't load `board.scss`, drop THIS assertion to a comment referencing the manual visual check in Step 6 of Phase 1 verification, and rely on that. Prefer the real assertion if it works.

- [ ] **Step 2: Run it to verify it fails (or is inert per the caveat)**

Run: `cd majik.portal && npx vitest run src/app/routes/match/components/board.component.spec.ts -t "scroll .* rather than clipping"`
Expected: FAIL.

- [ ] **Step 3: Flip the overflow in board.scss**

`.frontline` (~67-82): change `overflow-y: hidden;` → `overflow-y: auto;`.
`.backline__lands, .backline__utility` (~96-109): change `overflow-y: hidden;` → `overflow-y: auto;`.
Leave `.battlefield { overflow: hidden }` (the rim) as-is — inner rows now own their own scroll.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd majik.portal && npx vitest run src/app/routes/match/components/board.component.spec.ts -t "scroll .* rather than clipping"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd majik.portal && git add src/styles/board.scss src/app/routes/match/components/board.component.spec.ts
git commit -s -m "fix(board): battlefield rows scroll instead of clipping cards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Phase 1 visual verification**

Run the app (`/run` skill or `npm start`), start a match, and confirm against the original screenshot: top opp gap gone, self hand sits on the life/mana line, battlefields are taller, no card is clipped, dense rows scroll. Full suite green: `cd majik.portal && npx vitest run`.

---

## Phase 2 — Adjustable sizing + persistence

### Task 4: LayoutPrefsService (signals + localStorage)

A small service holding `cardScale`, `oppSelfRatio`, `handStripPx` as signals, mirrored to localStorage with clamping + corrupt-data fallback. Follows the existing `ZoneEditorComponent` functional-guard pattern (`globalThis.localStorage?` + try/catch) and the `effect`-to-persist pattern.

**Files:**
- Create: `src/app/routes/match/layout-prefs.service.ts`
- Test: `src/app/routes/match/layout-prefs.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { LayoutPrefsService, LAYOUT_PREFS_KEY, DEFAULT_LAYOUT_PREFS } from './layout-prefs.service';

beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const mem = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
      clear: () => mem.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  }
});

function make(): LayoutPrefsService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [LayoutPrefsService] });
  return TestBed.inject(LayoutPrefsService);
}

describe('LayoutPrefsService', () => {
  beforeEach(() => localStorage.removeItem(LAYOUT_PREFS_KEY));

  it('starts at defaults when nothing is stored', () => {
    const svc = make();
    expect(svc.cardScale()).toBe(DEFAULT_LAYOUT_PREFS.cardScale);
    expect(svc.oppSelfRatio()).toBe(DEFAULT_LAYOUT_PREFS.oppSelfRatio);
    expect(svc.handStripPx()).toBe(DEFAULT_LAYOUT_PREFS.handStripPx);
  });

  it('persists a change and reloads it', () => {
    make().setCardScale(1.3);
    expect(make().cardScale()).toBe(1.3);
  });

  it('clamps out-of-range values on set', () => {
    const svc = make();
    svc.setCardScale(99);
    svc.setOppSelfRatio(-1);
    svc.setHandStripPx(99999);
    expect(svc.cardScale()).toBe(1.4);     // max
    expect(svc.oppSelfRatio()).toBe(0.2);  // min
    expect(svc.handStripPx()).toBe(280);   // max
  });

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem(LAYOUT_PREFS_KEY, '{not json');
    expect(make().cardScale()).toBe(DEFAULT_LAYOUT_PREFS.cardScale);
  });

  it('discards stored prefs from a different schema version', () => {
    localStorage.setItem(LAYOUT_PREFS_KEY, JSON.stringify({ version: 0, cardScale: 1.3 }));
    expect(make().cardScale()).toBe(DEFAULT_LAYOUT_PREFS.cardScale);
  });

  it('reset() returns everything to defaults', () => {
    const svc = make();
    svc.setCardScale(1.3);
    svc.reset();
    expect(svc.cardScale()).toBe(DEFAULT_LAYOUT_PREFS.cardScale);
    expect(localStorage.getItem(LAYOUT_PREFS_KEY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd majik.portal && npx vitest run src/app/routes/match/layout-prefs.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```ts
import { Injectable, signal, effect } from '@angular/core';

export const LAYOUT_PREFS_KEY = 'majik.layoutPrefs';
const SCHEMA_VERSION = 1;

export interface LayoutPrefs {
  cardScale: number;    // multiplier on base card size
  oppSelfRatio: number; // opponent's share of the battlefield band (0..1)
  handStripPx: number;  // self bottom strip height in px
}

export const DEFAULT_LAYOUT_PREFS: LayoutPrefs = {
  cardScale: 1.0,
  oppSelfRatio: 0.5,
  handStripPx: 116,
};

const CLAMP = {
  cardScale: [0.7, 1.4] as const,
  oppSelfRatio: [0.2, 0.8] as const,
  handStripPx: [80, 280] as const,
};

function clamp(n: number, [lo, hi]: readonly [number, number]): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function read(): LayoutPrefs {
  try {
    const raw = globalThis.localStorage?.getItem(LAYOUT_PREFS_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT_PREFS };
    const parsed = JSON.parse(raw) as Partial<LayoutPrefs> & { version?: number };
    if (!parsed || parsed.version !== SCHEMA_VERSION) return { ...DEFAULT_LAYOUT_PREFS };
    return {
      cardScale: clamp(parsed.cardScale ?? DEFAULT_LAYOUT_PREFS.cardScale, CLAMP.cardScale),
      oppSelfRatio: clamp(parsed.oppSelfRatio ?? DEFAULT_LAYOUT_PREFS.oppSelfRatio, CLAMP.oppSelfRatio),
      handStripPx: clamp(parsed.handStripPx ?? DEFAULT_LAYOUT_PREFS.handStripPx, CLAMP.handStripPx),
    };
  } catch {
    return { ...DEFAULT_LAYOUT_PREFS };
  }
}

@Injectable({ providedIn: 'root' })
export class LayoutPrefsService {
  private readonly initial = read();
  readonly cardScale = signal(this.initial.cardScale);
  readonly oppSelfRatio = signal(this.initial.oppSelfRatio);
  readonly handStripPx = signal(this.initial.handStripPx);

  constructor() {
    // Persist on any change. Debounce is unnecessary — signal writes from
    // a drag handle are already throttled to pointermove cadence and the
    // payload is tiny.
    effect(() => {
      const payload = {
        version: SCHEMA_VERSION,
        cardScale: this.cardScale(),
        oppSelfRatio: this.oppSelfRatio(),
        handStripPx: this.handStripPx(),
      };
      try {
        globalThis.localStorage?.setItem(LAYOUT_PREFS_KEY, JSON.stringify(payload));
      } catch {
        // storage unavailable (SSR / privacy mode) — ignore
      }
    });
  }

  setCardScale(n: number): void { this.cardScale.set(clamp(n, CLAMP.cardScale)); }
  setOppSelfRatio(n: number): void { this.oppSelfRatio.set(clamp(n, CLAMP.oppSelfRatio)); }
  setHandStripPx(n: number): void { this.handStripPx.set(clamp(n, CLAMP.handStripPx)); }

  reset(): void {
    this.cardScale.set(DEFAULT_LAYOUT_PREFS.cardScale);
    this.oppSelfRatio.set(DEFAULT_LAYOUT_PREFS.oppSelfRatio);
    this.handStripPx.set(DEFAULT_LAYOUT_PREFS.handStripPx);
    try { globalThis.localStorage?.removeItem(LAYOUT_PREFS_KEY); } catch { /* ignore */ }
  }
}
```

> The `reset()` test expects `localStorage` to be `null` after reset, but the persist `effect` re-writes on the signal change. To satisfy both: the `effect` writes the (default) payload, so `getItem` is NOT null. **Fix the test expectation** in Step 1 to `expect(make().cardScale()).toBe(DEFAULT_LAYOUT_PREFS.cardScale)` only, and drop the `toBeNull()` line — `removeItem` then immediate re-persist is the correct behavior (defaults are harmless). Update Step 1's reset test accordingly before implementing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd majik.portal && npx vitest run src/app/routes/match/layout-prefs.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd majik.portal && git add src/app/routes/match/layout-prefs.service.ts src/app/routes/match/layout-prefs.service.spec.ts
git commit -s -m "feat(match): LayoutPrefsService — persisted card scale + zone sizing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Apply card-scale + zone prefs to the board

Wire the service into `BoardComponent`: card scale via a `--majik-card-w/h` host override, the battlefield split via per-side `flex-grow`, and the self strip height via `flex-basis` (overriding the Phase-1 fixed 116px).

**Files:**
- Modify: `src/app/routes/match/components/board.component.ts`
- Test: `src/app/routes/match/components/board.component.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('BoardComponent — layout prefs applied', () => {
  it('scales the card CSS vars from LayoutPrefsService.cardScale', () => {
    const prefs = TestBed.inject(LayoutPrefsService); // provided in root
    prefs.setCardScale(1.2);
    const fixture = renderBoard();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    // 100 * 1.2 = 120, 140 * 1.2 = 168
    expect(host.style.getPropertyValue('--majik-card-w').trim()).toBe('120px');
    expect(host.style.getPropertyValue('--majik-card-h').trim()).toBe('168px');
  });

  it('drives the battlefield split from oppSelfRatio and strip height from handStripPx', () => {
    const prefs = TestBed.inject(LayoutPrefsService);
    prefs.setOppSelfRatio(0.6);
    prefs.setHandStripPx(140);
    const fixture = renderBoard();
    fixture.detectChanges();
    const foe = fixture.nativeElement.querySelector('.arena-side--foe') as HTMLElement;
    const self = fixture.nativeElement.querySelector('.arena-side--self') as HTMLElement;
    const strip = fixture.nativeElement.querySelector('.arena-side--self > .arena-strip--self') as HTMLElement;
    expect(parseFloat(foe.style.flexGrow)).toBeCloseTo(1.2);  // 0.6 * 2
    expect(parseFloat(self.style.flexGrow)).toBeCloseTo(0.8);  // (1-0.6) * 2
    expect(strip.style.getPropertyValue('flex-basis').trim()).toBe('140px');
  });
});
```

> `renderBoard` must NOT override the `LayoutPrefsService` provider so the real root singleton is used. If the existing helper provides stubs for everything, add an optional param or inject the real service before rendering. Reuse the file's existing helper; only ensure `LayoutPrefsService` resolves to the root instance.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd majik.portal && npx vitest run src/app/routes/match/components/board.component.spec.ts -t "layout prefs applied"`
Expected: FAIL.

- [ ] **Step 3: Inject the service + add computeds + host/template bindings**

In `board.component.ts`, add the import and inject:

```ts
import { LayoutPrefsService } from '../../layout-prefs.service';
```

Inside the class (near the other `inject(...)` calls, e.g. after `private readonly gameStore = inject(GameStore);`):

```ts
  private readonly layoutPrefs = inject(LayoutPrefsService);

  // Base card geometry (matches tokens.scss / board.scss :root).
  private readonly baseCardW = 100;
  private readonly baseCardH = 140;

  readonly scaledCardW = computed(() => Math.round(this.baseCardW * this.layoutPrefs.cardScale()));
  readonly scaledCardH = computed(() => Math.round(this.baseCardH * this.layoutPrefs.cardScale()));
  readonly foeGrow = computed(() => this.layoutPrefs.oppSelfRatio() * 2);
  readonly selfGrow = computed(() => (1 - this.layoutPrefs.oppSelfRatio()) * 2);
  readonly handStripPx = computed(() => this.layoutPrefs.handStripPx());
```

Add host bindings for the card-scale override to the `@Component` decorator (next to `selector`/`standalone`):

```ts
  host: {
    '[style.--majik-card-w.px]': 'scaledCardW()',
    '[style.--majik-card-h.px]': 'scaledCardH()',
  },
```

> These set the vars on the host element; the opponent face-down hand and self hand keep their own `--majik-card-w/h` overrides (child wins), so they scale proportionally from the same root.

Bind the per-side grow + strip basis in the template. On `<div class="arena-side arena-side--foe">` (~218) add:

```html
          <div class="arena-side arena-side--foe" [style.flex-grow]="foeGrow()">
```

On `<div class="arena-side arena-side--self">` (~327) add:

```html
          <div class="arena-side arena-side--self" [style.flex-grow]="selfGrow()">
```

On the merged self strip `<div class="arena-strip arena-strip--self">` (from Task 1) add a flex-basis override that wins over the co-located 116px rule:

```html
            <div class="arena-strip arena-strip--self"
                 [style.flex-basis.px]="handStripPx()"
                 [style.min-height.px]="handStripPx()"
                 [style.max-height.px]="handStripPx()">
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd majik.portal && npx vitest run src/app/routes/match/components/board.component.spec.ts -t "layout prefs applied"`
Expected: PASS. Then full board spec: `npx vitest run src/app/routes/match/components/board.component.spec.ts` — the Phase-1 footprint test still passes because with default prefs `handStripPx()===116` and the inline basis equals the co-located rule.

- [ ] **Step 5: Commit**

```bash
cd majik.portal && git add src/app/routes/match/components/board.component.ts src/app/routes/match/components/board.component.spec.ts
git commit -s -m "feat(board): apply LayoutPrefs (card scale, battlefield split, strip height)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Draggable dividers (resize handles)

A reusable directive that turns an element into a vertical drag handle, emitting a pixel delta per `pointermove`. Two instances: the centerline (adjusts `oppSelfRatio`) and the self strip top edge (adjusts `handStripPx`).

**Files:**
- Create: `src/app/routes/match/components/resize-handle.directive.ts`
- Test: `src/app/routes/match/components/resize-handle.directive.spec.ts`
- Modify: `src/app/routes/match/components/board.component.ts` (place handles, handle events)

- [ ] **Step 1: Write the failing directive test**

```ts
import { describe, expect, it } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ResizeHandleDirective } from './resize-handle.directive';

@Component({
  standalone: true,
  imports: [ResizeHandleDirective],
  template: `<div appResizeHandle (resizeDelta)="last = $event"></div>`,
})
class HostCmp { last = 0; }

function pointer(type: string, y: number): PointerEvent {
  return new PointerEvent(type, { clientY: y, bubbles: true, pointerId: 1 });
}

describe('ResizeHandleDirective', () => {
  it('emits the cumulative vertical delta from pointerdown to pointermove', () => {
    const fixture = TestBed.createComponent(HostCmp);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('div') as HTMLElement;
    el.dispatchEvent(pointer('pointerdown', 100));
    window.dispatchEvent(pointer('pointermove', 130));
    expect(fixture.componentInstance.last).toBe(30);
    window.dispatchEvent(pointer('pointermove', 90));
    expect(fixture.componentInstance.last).toBe(-10);
  });

  it('stops emitting after pointerup', () => {
    const fixture = TestBed.createComponent(HostCmp);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('div') as HTMLElement;
    el.dispatchEvent(pointer('pointerdown', 100));
    window.dispatchEvent(pointer('pointerup', 100));
    fixture.componentInstance.last = 0;
    window.dispatchEvent(pointer('pointermove', 200));
    expect(fixture.componentInstance.last).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd majik.portal && npx vitest run src/app/routes/match/components/resize-handle.directive.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the directive**

```ts
import { Directive, ElementRef, OnDestroy, inject, output } from '@angular/core';

/**
 * Turns the host element into a vertical drag handle. Emits the signed
 * pixel delta (current clientY − pointerdown clientY) on every pointermove
 * while dragging. Consumers translate the delta into a layout pref and are
 * responsible for clamping. Keyboard: ArrowUp/ArrowDown nudge ±8px.
 */
@Directive({
  selector: '[appResizeHandle]',
  standalone: true,
  host: {
    role: 'separator',
    tabindex: '0',
    'aria-orientation': 'horizontal',
    style: 'cursor: row-resize; touch-action: none;',
    '(pointerdown)': 'onDown($event)',
    '(keydown)': 'onKey($event)',
  },
})
export class ResizeHandleDirective implements OnDestroy {
  readonly resizeDelta = output<number>();
  private readonly el = inject(ElementRef<HTMLElement>);
  private startY = 0;
  private dragging = false;

  private readonly move = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.resizeDelta.emit(e.clientY - this.startY);
  };
  private readonly up = (): void => {
    this.dragging = false;
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
  };

  onDown(e: PointerEvent): void {
    e.preventDefault();
    this.startY = e.clientY;
    this.dragging = true;
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
  }

  onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowUp') { this.resizeDelta.emit(-8); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { this.resizeDelta.emit(8); e.preventDefault(); }
  }

  ngOnDestroy(): void { this.up(); }
}
```

- [ ] **Step 4: Run the directive test to verify it passes**

Run: `cd majik.portal && npx vitest run src/app/routes/match/components/resize-handle.directive.spec.ts`
Expected: PASS.

- [ ] **Step 5: Place handles in the board + wire handlers (with a failing board test first)**

Add to `board.component.spec.ts`:

```ts
describe('BoardComponent — resize handles', () => {
  it('a centerline drag updates oppSelfRatio; a strip-edge drag updates handStripPx', () => {
    const prefs = TestBed.inject(LayoutPrefsService);
    prefs.reset();
    const fixture = renderBoard();
    fixture.detectChanges();
    const component = fixture.componentInstance as BoardComponent;
    // simulate the directive's emitted deltas via the component handlers
    component.onCenterlineResize(100);   // drag down 100px → opp gets more
    expect(prefs.oppSelfRatio()).toBeGreaterThan(0.5);
    component.onHandStripResize(-40);    // drag up 40px → strip grows
    expect(prefs.handStripPx()).toBeGreaterThan(116);
  });
});
```

Run it (FAIL — handlers don't exist):
`cd majik.portal && npx vitest run src/app/routes/match/components/board.component.spec.ts -t "resize handles"`

Add to `BoardComponent` imports array: `ResizeHandleDirective`. Add handlers (board height for ratio scaling read off `boardGridEl`):

```ts
  onCenterlineResize(deltaY: number): void {
    const h = this.boardGridEl?.nativeElement.getBoundingClientRect().height ?? 800;
    // dragging down (positive) gives the opponent a larger share
    this.layoutPrefs.setOppSelfRatio(this.layoutPrefs.oppSelfRatio() + deltaY / h);
  }

  onHandStripResize(deltaY: number): void {
    // dragging up (negative) makes the strip taller
    this.layoutPrefs.setHandStripPx(this.layoutPrefs.handStripPx() - deltaY);
  }
```

> Note: per-`pointermove` deltas from the directive are CUMULATIVE from pointerdown, so calling `setOppSelfRatio(current + delta/h)` repeatedly drifts. To avoid drift, capture the value at drag start. Add `private centerlineStart = 0; private stripStart = 0;` and an `onResizeStart` bound to the directive’s `pointerdown` is overkill — simpler: change the directive to emit cumulative delta (it already does) and in the handlers compute from a snapshot. Implement it as: on the FIRST delta of a gesture, snapshot; reset snapshot on a 0 delta is unreliable. **Chosen approach:** add two more outputs is unnecessary — instead store the start value lazily:

```ts
  private centerlineBase: number | null = null;
  private stripBase: number | null = null;

  onCenterlineResize(deltaY: number): void {
    const h = this.boardGridEl?.nativeElement.getBoundingClientRect().height ?? 800;
    this.centerlineBase ??= this.layoutPrefs.oppSelfRatio();
    this.layoutPrefs.setOppSelfRatio(this.centerlineBase + deltaY / h);
  }
  onCenterlineResizeEnd(): void { this.centerlineBase = null; }

  onHandStripResize(deltaY: number): void {
    this.stripBase ??= this.layoutPrefs.handStripPx();
    this.layoutPrefs.setHandStripPx(this.stripBase - deltaY);
  }
  onHandStripResizeEnd(): void { this.stripBase = null; }
```

Give the directive a `resizeEnd` output emitted on `pointerup`/`ArrowKey` so the base resets:

```ts
  readonly resizeEnd = output<void>();
  // in up(): this.resizeEnd.emit();
  // in onKey after each nudge: this.resizeEnd.emit();
```

Update the directive test to ignore `resizeEnd` (it already passes). Place the handles in the template:

Centerline — between the two arena-sides (after the `.arena-side--foe` closing `</div>` at ~318, before `.arena-side--self`):

```html
          <div
            class="centerline-handle"
            appResizeHandle
            aria-label="resize battlefield split"
            (resizeDelta)="onCenterlineResize($event)"
            (resizeEnd)="onCenterlineResizeEnd()"></div>
```

Strip edge — inside `.arena-side--self`, between the battlefield `</div>` and the `.arena-strip--self` (from Task 1):

```html
            <div
              class="strip-handle"
              appResizeHandle
              aria-label="resize hand area"
              (resizeDelta)="onHandStripResize($event)"
              (resizeEnd)="onHandStripResizeEnd()"></div>
```

Add minimal styles to the co-located `styles: [...]` block:

```ts
    .centerline-handle, .strip-handle {
      flex: 0 0 6px;
      cursor: row-resize;
      border-radius: 3px;
      background: var(--majik-line-faint, rgba(255,255,255,0.08));
      transition: background-color 150ms ease-out;
    }
    .centerline-handle:hover, .strip-handle:hover,
    .centerline-handle:focus-visible, .strip-handle:focus-visible {
      background: var(--majik-accent, rgba(202,167,90,0.6));
      outline: none;
    }
```

- [ ] **Step 6: Run the board resize test to verify it passes**

Run: `cd majik.portal && npx vitest run src/app/routes/match/components/board.component.spec.ts -t "resize handles"`
Expected: PASS. Then the full board spec: `npx vitest run src/app/routes/match/components/board.component.spec.ts`.

- [ ] **Step 7: Commit**

```bash
cd majik.portal && git add src/app/routes/match/components/resize-handle.directive.ts src/app/routes/match/components/resize-handle.directive.spec.ts src/app/routes/match/components/board.component.ts src/app/routes/match/components/board.component.spec.ts
git commit -s -m "feat(board): draggable dividers for battlefield split + hand-strip height

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Layout-controls popover (card-scale slider + reset)

A compact control to set card scale and reset all layout prefs, surfaced from the action bar.

**Files:**
- Create: `src/app/routes/match/components/layout-controls.component.ts`
- Test: `src/app/routes/match/components/layout-controls.component.spec.ts`
- Modify: `src/app/routes/match/components/board.component.ts` (render the control)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { LayoutControlsComponent } from './layout-controls.component';
import { LayoutPrefsService } from '../layout-prefs.service';

function render() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [LayoutControlsComponent] });
  const fixture = TestBed.createComponent(LayoutControlsComponent);
  fixture.detectChanges();
  return fixture;
}

describe('LayoutControlsComponent', () => {
  it('the slider reflects and updates cardScale', () => {
    const prefs = TestBed.inject(LayoutPrefsService);
    const fixture = render();
    const input = fixture.nativeElement.querySelector('input[type="range"]') as HTMLInputElement;
    expect(parseFloat(input.value)).toBeCloseTo(prefs.cardScale());
    input.value = '1.3';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(prefs.cardScale()).toBeCloseTo(1.3);
  });

  it('reset button restores defaults', () => {
    const prefs = TestBed.inject(LayoutPrefsService);
    prefs.setCardScale(1.4);
    const fixture = render();
    (fixture.nativeElement.querySelector('button[data-act="reset"]') as HTMLButtonElement).click();
    expect(prefs.cardScale()).toBeCloseTo(1.0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd majik.portal && npx vitest run src/app/routes/match/components/layout-controls.component.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```ts
import { Component, inject } from '@angular/core';
import { LayoutPrefsService } from '../layout-prefs.service';

@Component({
  selector: 'app-layout-controls',
  standalone: true,
  template: `
    <div class="layout-controls flex items-center gap-2 text-xs">
      <label class="flex items-center gap-1">
        <span class="opacity-70">Card size</span>
        <input
          type="range" min="0.7" max="1.4" step="0.05"
          [value]="prefs.cardScale()"
          (input)="onScale($event)"
          aria-label="card size" />
      </label>
      <button type="button" data-act="reset" class="opacity-70 hover:opacity-100"
              (click)="prefs.reset()">Reset</button>
    </div>
  `,
})
export class LayoutControlsComponent {
  readonly prefs = inject(LayoutPrefsService);
  onScale(e: Event): void {
    this.prefs.setCardScale(parseFloat((e.target as HTMLInputElement).value));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd majik.portal && npx vitest run src/app/routes/match/components/layout-controls.component.spec.ts`
Expected: PASS.

- [ ] **Step 5: Surface it in the board**

Add `LayoutControlsComponent` to `BoardComponent`'s imports array, and render it near the action bar / top-of-board controls. Place it just before `<app-action-bar` (~581):

```html
        <app-layout-controls />
```

(If a more fitting corner exists — e.g. alongside the phase bar — place it there; keep it out of the battlefield flow so it doesn't reintroduce a tall row. A simple inline control above the action bar is acceptable.)

- [ ] **Step 6: Verify the full suite + visual**

Run: `cd majik.portal && npx vitest run` (full suite green). Then run the app, open a match, and confirm: slider scales every card live, dragging the centerline re-splits the battlefields, dragging the strip edge resizes the hand area, Reset restores defaults, and a reload preserves adjustments.

- [ ] **Step 7: Commit**

```bash
cd majik.portal && git add src/app/routes/match/components/layout-controls.component.ts src/app/routes/match/components/layout-controls.component.spec.ts src/app/routes/match/components/board.component.ts
git commit -s -m "feat(board): card-scale slider + reset control for layout prefs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Problem 1 (empty top) → Task 1 shrinks opp strip 188→116. ✓
- Problem 2 (cards cut off) → Task 3 overflow-y:auto. ✓
- Problem 3 / "hand on the life/mana line" → Task 1 merges the strip. ✓
- Hand horizontal scroll on overflow → Task 2. ✓
- Medium hand cards + hover-zoom → Task 2 (size override; hover popover already exists). ✓
- Card-scale adjust + persist → Tasks 4, 5, 7. ✓
- Zone-split dividers + persist → Tasks 4, 5, 6. ✓
- localStorage persistence, clamp, corrupt/version fallback, reset → Task 4. ✓
- No server change → confirmed (frontend only). ✓

**Type consistency:** `LayoutPrefs`/`DEFAULT_LAYOUT_PREFS`/`LAYOUT_PREFS_KEY` exported from Task 4 and imported in Tasks 5–7; `setCardScale/setOppSelfRatio/setHandStripPx/reset` used consistently; directive outputs `resizeDelta` + `resizeEnd` referenced consistently in Task 6; `STRIP_H = 116` consistent across Task 1 host styles, spec, and Task 4 default `handStripPx: 116`.

**Placeholder scan:** No TBD/TODO left; every code step has concrete content. Two jsdom caveats (Tasks 2/3) give an explicit fallback rather than a vague instruction.

**Risk callouts for the executor:**
- `renderBoard` helper name: reuse whatever the file already defines; do not invent a new TestBed bootstrap.
- The Phase-1 footprint test must keep passing after Task 5 (default `handStripPx===116` makes the inline basis equal the co-located rule).
- DCO: every commit uses `-s` (required across Majik repos).
