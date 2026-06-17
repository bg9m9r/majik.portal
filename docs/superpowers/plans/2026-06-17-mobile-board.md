# Mobile Match Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the match board playable on a phone in landscape, reusing the existing two-seat layout scaled down rather than rebuilding it for portrait.

**Architecture:** A new root `ViewportService` exposes `isMobileBoard` / `isPortrait` signals (pointer-coarse + small viewport via `matchMedia`). The match board reads these to: cap card scale smaller, compress chrome, show a rotate-to-play overlay in portrait, disable CDK drag, and route hand-play / ability-activation through single taps. Card targeting/combat is already a tap flow (#140 `SelectionService`), so this plan does not touch it. Non-board prompts get a bottom-sheet on mobile. Desktop (fine pointer) is entirely unaffected — every change is gated behind `isMobileBoard`.

**Tech Stack:** Angular 21 standalone components + signals, Tailwind v4, Angular CDK drag-drop, vitest + TestBed (`ng test --no-watch`). jsdom does NOT load `board.scss` — asserted CSS must live in component `styles[]`; use `//` comments only inside inline template literals.

**Foundation already on main (do NOT rebuild):** `LayoutPrefsService` (adjustable+persisted `cardScale`, `src/app/routes/match/layout-prefs.service.ts`), `SelectionService` (#140 on-board click-to-select for targets/choice/attackers/blockers, `src/app/core/match/selection.service.ts`), clickable player HUD (#141).

**Rollout:** Three independently shippable PRs — Slice 1 (Tasks 1–4: it lays out on a phone), Slice 2 (Tasks 5–7: tap to play/activate), Slice 3 (Tasks 8–9: preview + bottom-sheet). Portal has **no build/test CI gate** (auto-merges on `dco` alone) → run `ng test --no-watch` locally before every merge.

---

## File Structure

**New files:**
- `src/app/core/ui/viewport.service.ts` — root service; `isMobileBoard`, `isPortrait`, raw `width`/`height` signals from `matchMedia` + resize.
- `src/app/core/ui/viewport.service.spec.ts` — unit tests (mock `matchMedia` + viewport).
- `src/app/routes/match/components/rotate-overlay.component.ts` — presentational "rotate to play" full-screen prompt.
- `src/app/routes/match/components/rotate-overlay.component.spec.ts`.
- `src/app/ui/long-press.directive.ts` — `(longPress)` output; pointer-hold with move-cancel.
- `src/app/ui/long-press.directive.spec.ts`.

**Modified files:**
- `src/app/routes/match/layout-prefs.service.ts` — widen `CLAMP.cardScale` floor.
- `src/app/routes/match/components/board.component.ts` — inject `ViewportService`; mobile scale cap; `mobile-board` host class; `[cdkDragDisabled]`; mobile tap dispatch; `(longPress)` wiring; compressed-chrome CSS in `styles[]`.
- `src/app/routes/match/match.ts` — render `<app-rotate-overlay>` in the Playing case.
- `src/app/routes/match/components/prompt-overlay.component.ts` — bottom-sheet container branch when `isMobileBoard` and not in board-select mode.

---

# Slice 1 — Landscape layout (PR 1)

## Task 1: ViewportService

**Files:**
- Create: `src/app/core/ui/viewport.service.ts`
- Test: `src/app/core/ui/viewport.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/core/ui/viewport.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { ViewportService } from './viewport.service';

interface FakeMql {
  matches: boolean;
  listeners: Array<(e: { matches: boolean }) => void>;
}

function installEnv(opts: { coarse: boolean; width: number; height: number }): {
  mql: FakeMql;
  fireResize: (w: number, h: number) => void;
  firePointer: (coarse: boolean) => void;
} {
  const mql: FakeMql = { matches: opts.coarse, listeners: [] };
  (globalThis as any).matchMedia = (q: string) => ({
    matches: q.includes('coarse') ? mql.matches : false,
    media: q,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => mql.listeners.push(cb),
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
      mql.listeners = mql.listeners.filter(l => l !== cb);
    },
  });
  (globalThis as any).innerWidth = opts.width;
  (globalThis as any).innerHeight = opts.height;
  const resizeCbs: Array<() => void> = [];
  const origAdd = globalThis.addEventListener;
  (globalThis as any).addEventListener = (type: string, cb: any) => {
    if (type === 'resize') resizeCbs.push(cb);
    else origAdd.call(globalThis, type, cb);
  };
  return {
    mql,
    fireResize: (w, h) => { (globalThis as any).innerWidth = w; (globalThis as any).innerHeight = h; resizeCbs.forEach(cb => cb()); },
    firePointer: (coarse) => { mql.matches = coarse; mql.listeners.forEach(l => l({ matches: coarse })); },
  };
}

describe('ViewportService', () => {
  it('isMobileBoard is true for coarse pointer on a phone-sized viewport', () => {
    installEnv({ coarse: true, width: 740, height: 360 });
    const vp = TestBed.inject(ViewportService);
    expect(vp.isMobileBoard()).toBe(true);
  });

  it('isMobileBoard is false for a fine pointer (desktop), regardless of size', () => {
    installEnv({ coarse: false, width: 800, height: 400 });
    const vp = TestBed.inject(ViewportService);
    expect(vp.isMobileBoard()).toBe(false);
  });

  it('isMobileBoard is false for coarse pointer on a large (tablet/desktop) viewport', () => {
    installEnv({ coarse: true, width: 1280, height: 800 });
    const vp = TestBed.inject(ViewportService);
    expect(vp.isMobileBoard()).toBe(false);
  });

  it('isPortrait tracks orientation and reacts to resize', () => {
    const env = installEnv({ coarse: true, width: 360, height: 740 });
    const vp = TestBed.inject(ViewportService);
    expect(vp.isPortrait()).toBe(true);
    env.fireResize(740, 360);
    expect(vp.isPortrait()).toBe(false);
  });

  it('reacts when the pointer media query changes', () => {
    const env = installEnv({ coarse: false, width: 740, height: 360 });
    const vp = TestBed.inject(ViewportService);
    expect(vp.isMobileBoard()).toBe(false);
    env.firePointer(true);
    expect(vp.isMobileBoard()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ng test --no-watch -- src/app/core/ui/viewport.service.spec.ts`
Expected: FAIL — cannot find module `./viewport.service`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/app/core/ui/viewport.service.ts
import { Injectable, OnDestroy, computed, signal } from '@angular/core';

// Short-side threshold below which a coarse-pointer device is treated as a
// phone (vs a tablet/touch-laptop). Landscape phones are ~360-430 tall.
const PHONE_SHORT_SIDE_MAX = 540;

@Injectable({ providedIn: 'root' })
export class ViewportService implements OnDestroy {
  private readonly coarse = signal(false);
  private readonly width = signal(0);
  private readonly height = signal(0);
  private readonly teardown: Array<() => void> = [];

  constructor() {
    const mql = globalThis.matchMedia?.('(pointer: coarse)');
    if (mql) {
      this.coarse.set(mql.matches);
      const onChange = (e: { matches: boolean }) => this.coarse.set(e.matches);
      mql.addEventListener('change', onChange);
      this.teardown.push(() => mql.removeEventListener('change', onChange));
    }
    const onResize = () => {
      this.width.set(globalThis.innerWidth ?? 0);
      this.height.set(globalThis.innerHeight ?? 0);
    };
    onResize();
    globalThis.addEventListener?.('resize', onResize);
    this.teardown.push(() => globalThis.removeEventListener?.('resize', onResize));
  }

  /** Taller than wide. */
  readonly isPortrait = computed(() => this.height() > this.width());

  /** Coarse pointer on a phone-sized viewport — the only gate for mobile-board behaviour. */
  readonly isMobileBoard = computed(
    () => this.coarse() && Math.min(this.width(), this.height()) <= PHONE_SHORT_SIDE_MAX,
  );

  ngOnDestroy(): void {
    this.teardown.forEach(fn => fn());
    this.teardown.length = 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ng test --no-watch -- src/app/core/ui/viewport.service.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/core/ui/viewport.service.ts src/app/core/ui/viewport.service.spec.ts
git commit -s -m "feat(mobile): ViewportService — isMobileBoard / isPortrait signals"
```

---

## Task 2: Mobile card-scale cap

The board exposes `--majik-card-scale` from `LayoutPrefsService.cardScale()` via a computed `cardScale` (board.component.ts ~line 1289). On mobile we cap that scale smaller so two seats fit a short landscape height, while still letting the user shrink further. The clamp floor is currently `0.7` (layout-prefs.service.ts:21) — too high for mobile; widen it to `0.45`.

**Files:**
- Modify: `src/app/routes/match/layout-prefs.service.ts:21`
- Modify: `src/app/routes/match/components/board.component.ts` (inject `ViewportService`; change the `cardScale` computed)
- Test: `src/app/routes/match/components/board.component.spec.ts` (existing)

- [ ] **Step 1: Write the failing test**

Add to `board.component.spec.ts` (follow the file's existing TestBed setup; it already provides `LayoutPrefsService` and the board's other deps). Provide a `ViewportService` stub via `useValue`:

```typescript
import { ViewportService } from '../../../core/ui/viewport.service';
import { signal } from '@angular/core';

function mobileVpStub(isMobile: boolean) {
  return { isMobileBoard: signal(isMobile), isPortrait: signal(false) } as unknown as ViewportService;
}

describe('BoardComponent mobile card scale', () => {
  it('caps the effective card scale at the mobile default on mobile', () => {
    // LayoutPrefsService default cardScale is 1.0
    TestBed.configureTestingModule({
      providers: [{ provide: ViewportService, useValue: mobileVpStub(true) }],
    });
    const fixture = TestBed.createComponent(BoardComponent);
    const cmp = fixture.componentInstance;
    expect(cmp.cardScale()).toBeCloseTo(0.6); // MOBILE_CARD_SCALE
  });

  it('uses the full pref scale on desktop', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: ViewportService, useValue: mobileVpStub(false) }],
    });
    const fixture = TestBed.createComponent(BoardComponent);
    expect(fixture.componentInstance.cardScale()).toBeCloseTo(1.0);
  });
});
```

> Note: the existing `board.component.spec.ts` already configures the full provider set for `BoardComponent`. Merge these two `it` blocks into that file's existing `describe`, reusing its `beforeEach` providers and adding only the `ViewportService` override per test. Do not duplicate the whole provider list.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ng test --no-watch -- src/app/routes/match/components/board.component.spec.ts`
Expected: FAIL — `cardScale()` returns `1.0` on mobile (cap not applied); also `ViewportService` not yet injected.

- [ ] **Step 3: Implement**

In `layout-prefs.service.ts`, widen the floor:

```typescript
export const CLAMP = {
  cardScale: [0.45, 1.4] as const, // floor lowered from 0.7 so mobile can shrink below the desktop minimum
  oppSelfRatio: [0.2, 0.8] as const,
  handStripPx: [80, 280] as const,
};
```

In `board.component.ts`, add the constant near the top of the file (module scope):

```typescript
// Effective card-scale ceiling on a phone: two seats + hands must fit a short
// landscape height. The user can still shrink further via the layout slider.
const MOBILE_CARD_SCALE = 0.6;
```

Inject `ViewportService` in the constructor/`inject()` block alongside the existing `layoutPrefs` injection:

```typescript
private readonly viewport = inject(ViewportService);
```

Change the `cardScale` computed (board.component.ts ~line 1289) from:

```typescript
readonly cardScale = computed(() => this.layoutPrefs.cardScale());
```

to:

```typescript
readonly cardScale = computed(() =>
  this.viewport.isMobileBoard()
    ? Math.min(this.layoutPrefs.cardScale(), MOBILE_CARD_SCALE)
    : this.layoutPrefs.cardScale(),
);
```

(The downstream `scaledCardW` / `scaledCardH` computeds already derive from `cardScale`, so they pick up the cap automatically.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ng test --no-watch -- src/app/routes/match/components/board.component.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/routes/match/layout-prefs.service.ts src/app/routes/match/components/board.component.ts src/app/routes/match/components/board.component.spec.ts
git commit -s -m "feat(mobile): cap card scale on phones; widen scale clamp floor"
```

---

## Task 3: Rotate-to-play overlay

**Files:**
- Create: `src/app/routes/match/components/rotate-overlay.component.ts`
- Create: `src/app/routes/match/components/rotate-overlay.component.spec.ts`
- Modify: `src/app/routes/match/match.ts` (render in the Playing case, ~lines 133–149)

- [ ] **Step 1: Write the failing test**

```typescript
// rotate-overlay.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { RotateOverlayComponent } from './rotate-overlay.component';
import { ViewportService } from '../../../core/ui/viewport.service';

function vpStub(isMobile: boolean, isPortrait: boolean) {
  return { isMobileBoard: signal(isMobile), isPortrait: signal(isPortrait) } as unknown as ViewportService;
}

describe('RotateOverlayComponent', () => {
  function render(isMobile: boolean, isPortrait: boolean) {
    TestBed.configureTestingModule({
      providers: [{ provide: ViewportService, useValue: vpStub(isMobile, isPortrait) }],
    });
    const f = TestBed.createComponent(RotateOverlayComponent);
    f.detectChanges();
    return f;
  }

  it('shows when mobile + portrait', () => {
    const f = render(true, true);
    expect(f.nativeElement.textContent).toContain('Rotate');
  });

  it('hidden when mobile + landscape', () => {
    const f = render(true, false);
    expect(f.nativeElement.querySelector('[data-testid="rotate-overlay"]')).toBeNull();
  });

  it('hidden on desktop', () => {
    const f = render(false, true);
    expect(f.nativeElement.querySelector('[data-testid="rotate-overlay"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ng test --no-watch -- src/app/routes/match/components/rotate-overlay.component.spec.ts`
Expected: FAIL — cannot find module `./rotate-overlay.component`.

- [ ] **Step 3: Implement**

```typescript
// rotate-overlay.component.ts
import { Component, computed, inject } from '@angular/core';
import { ViewportService } from '../../../core/ui/viewport.service';

@Component({
  selector: 'app-rotate-overlay',
  standalone: true,
  template: `
    @if (show()) {
      <div data-testid="rotate-overlay"
           class="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-[color:var(--majik-bg)] p-8 text-center">
        <div class="rotate-icon text-5xl" aria-hidden="true">⟳</div>
        <h2 class="majik-display-3">Rotate to play</h2>
        <p class="text-sm opacity-70">The match board needs landscape. Turn your device sideways.</p>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .rotate-icon { animation: rotate-hint 2s ease-in-out infinite; }
    @keyframes rotate-hint { 0%,100% { transform: rotate(0); } 50% { transform: rotate(90deg); } }
  `],
})
export class RotateOverlayComponent {
  private readonly viewport = inject(ViewportService);
  readonly show = computed(() => this.viewport.isMobileBoard() && this.viewport.isPortrait());
}
```

In `match.ts`: add `RotateOverlayComponent` to the component `imports` array, and render it inside the Playing case as a sibling of `<app-board>` (it self-gates, so placement is only about z-order — put it last so it overlays):

```html
@case ('Playing') {
  <app-board ... ></app-board>
  @if (game.prompt()) { <app-prompt-overlay ... /> }
  <app-rotate-overlay />
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ng test --no-watch -- src/app/routes/match/components/rotate-overlay.component.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/routes/match/components/rotate-overlay.component.ts src/app/routes/match/components/rotate-overlay.component.spec.ts src/app/routes/match/match.ts
git commit -s -m "feat(mobile): rotate-to-play overlay in portrait"
```

---

## Task 4: Mobile chrome class + compressed CSS

Add a `mobile-board` host class to the board when `isMobileBoard`, and co-locate the compression CSS in the component `styles[]` (jsdom can't load `board.scss`, so any asserted rule must live here). Compression shrinks the seat strips, phase bar, and bottom action bar.

**Files:**
- Modify: `src/app/routes/match/components/board.component.ts` (host binding + `styles[]`)
- Test: `src/app/routes/match/components/board.component.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `board.component.spec.ts`:

```typescript
it('adds the mobile-board host class on mobile', () => {
  TestBed.configureTestingModule({
    providers: [{ provide: ViewportService, useValue: mobileVpStub(true) }],
  });
  const fixture = TestBed.createComponent(BoardComponent);
  fixture.detectChanges();
  expect(fixture.nativeElement.classList.contains('mobile-board')).toBe(true);
});

it('omits the mobile-board host class on desktop', () => {
  TestBed.configureTestingModule({
    providers: [{ provide: ViewportService, useValue: mobileVpStub(false) }],
  });
  const fixture = TestBed.createComponent(BoardComponent);
  fixture.detectChanges();
  expect(fixture.nativeElement.classList.contains('mobile-board')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ng test --no-watch -- src/app/routes/match/components/board.component.spec.ts`
Expected: FAIL — class `mobile-board` absent.

- [ ] **Step 3: Implement**

In the `@Component` host bindings of `board.component.ts`, add:

```typescript
host: {
  // ...existing host bindings preserved...
  '[class.mobile-board]': 'viewport.isMobileBoard()',
},
```

(If host bindings are expressed via `[style.--majik-card-scale]` style attribute keys in the decorator's `host` object, add the `[class.mobile-board]` key alongside them. If the existing code uses `@HostBinding`, add `@HostBinding('class.mobile-board') get mobileBoard() { return this.viewport.isMobileBoard(); }` instead — match whichever pattern the file already uses.)

Append compression rules to the component `styles[]` array (NOT `board.scss`):

```typescript
styles: [`
  // ...existing inline styles preserved...

  // Mobile chrome compression. Only asserted/structural rules live here;
  // board.scss is not loaded under jsdom. Use // comments only.
  :host(.mobile-board) .arena-strip { min-height: 64px; max-height: 64px; }
  :host(.mobile-board) .phase-bar { font-size: 11px; padding-block: 2px; }
  :host(.mobile-board) .action-bar { padding: 4px 6px; gap: 4px; }
  :host(.mobile-board) .hand-row { min-height: var(--majik-card-h); }
`],
```

> Adapt the selectors to the real class names in the template (`.arena-strip`, `.phase-bar`, `.hand-row` are confirmed; verify the action bar's class and substitute). Keep desktop untouched — every rule is scoped under `:host(.mobile-board)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ng test --no-watch -- src/app/routes/match/components/board.component.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/routes/match/components/board.component.ts src/app/routes/match/components/board.component.spec.ts
git commit -s -m "feat(mobile): compress board chrome under mobile-board class"
```

- [ ] **Step 6: Slice 1 PR**

```bash
npx ng test --no-watch   # full suite must pass — no CI build gate
git push -u origin <slice-1-branch>
gh pr create --repo bg9m9r/majik.portal --base main --title "feat(mobile): board landscape layout (slice 1)" --body "ViewportService, mobile card-scale cap, rotate-to-play overlay, chrome compression. Behind isMobileBoard; desktop unchanged."
gh pr merge <n> --repo bg9m9r/majik.portal --auto --squash
```

---

# Slice 2 — Tap to play / activate (PR 2)

## Task 5: Disable CDK drag on mobile

**Files:**
- Modify: `src/app/routes/match/components/board.component.ts` (hand-card `cdkDrag`, ~line 522)
- Test: `src/app/routes/match/components/board.component.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('disables hand-card drag on mobile', () => {
  TestBed.configureTestingModule({
    providers: [{ provide: ViewportService, useValue: mobileVpStub(true) }],
  });
  const fixture = TestBed.createComponent(BoardComponent);
  // ...set up a self-hand card via the component's input/store stub used elsewhere in this spec...
  fixture.detectChanges();
  const handCard = fixture.nativeElement.querySelector('[data-self-hand] [cdkdrag], [data-self-hand] .cdk-drag');
  // CDK reflects disabled state onto the host as .cdk-drag-disabled
  expect(handCard?.classList.contains('cdk-drag-disabled')).toBe(true);
});
```

> Reuse the spec's existing helper for seeding a self-hand card (the file already renders hand cards for the drag tests). If no such helper exists, assert instead on the bound property: expose a test hook `cmp.dragDisabled()` returning `viewport.isMobileBoard()` and assert it is `true`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ng test --no-watch -- src/app/routes/match/components/board.component.spec.ts`
Expected: FAIL — drag not disabled.

- [ ] **Step 3: Implement**

On the hand-card element with `cdkDrag` (board.component.ts ~line 522), add:

```html
<button ... cdkDrag [cdkDragData]="c" [cdkDragDisabled]="viewport.isMobileBoard()">
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ng test --no-watch -- src/app/routes/match/components/board.component.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/routes/match/components/board.component.ts src/app/routes/match/components/board.component.spec.ts
git commit -s -m "feat(mobile): disable hand drag on touch (tap-to-play instead)"
```

---

## Task 6: Tap-to-play from hand

On mobile, a single tap on a self-hand card plays/casts it through the existing play path. Desktop dragging is unchanged (and now disabled only on mobile, Task 5). The existing emission is `castOrPlayRequested` (fired today from `onBattlefieldDrop`, board.component.ts:1735); reuse the same output and the `onHandClicked` translation in `match.ts:736` (which already decides `play-land` vs `cast`).

**Files:**
- Modify: `src/app/routes/match/components/board.component.ts` (hand-card `(click)`; new `onHandCardTap`)
- Test: `src/app/routes/match/components/board.component.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('emits castOrPlayRequested when a self-hand card is tapped on mobile', () => {
  TestBed.configureTestingModule({
    providers: [{ provide: ViewportService, useValue: mobileVpStub(true) }],
  });
  const fixture = TestBed.createComponent(BoardComponent);
  const cmp = fixture.componentInstance;
  const handCard = makeSelfHandCard('inst-1'); // reuse the spec's card factory
  const emitted: unknown[] = [];
  cmp.castOrPlayRequested.subscribe((e: unknown) => emitted.push(e));

  cmp.onHandCardTap(handCard);

  expect(emitted).toHaveLength(1);
});

it('does NOT play on tap on desktop (drag handles it)', () => {
  TestBed.configureTestingModule({
    providers: [{ provide: ViewportService, useValue: mobileVpStub(false) }],
  });
  const fixture = TestBed.createComponent(BoardComponent);
  const cmp = fixture.componentInstance;
  const emitted: unknown[] = [];
  cmp.castOrPlayRequested.subscribe((e: unknown) => emitted.push(e));
  cmp.onHandCardTap(makeSelfHandCard('inst-1'));
  expect(emitted).toHaveLength(0);
});
```

> `makeSelfHandCard` / the card-snapshot factory already exists in the spec for the drag tests — reuse it. `castOrPlayRequested` is the board's existing `@Output`; confirm its exact name in board.component.ts and match the test to it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ng test --no-watch -- src/app/routes/match/components/board.component.spec.ts`
Expected: FAIL — `onHandCardTap` not defined.

- [ ] **Step 3: Implement**

Add a handler that emits the same payload the battlefield-drop path emits, gated to mobile:

```typescript
/** Mobile single-tap play. Desktop uses drag (no-op here). Reuses the
 *  existing castOrPlayRequested output so match.ts translation is unchanged. */
onHandCardTap(card: CardSnapshotLike): void {
  if (!this.viewport.isMobileBoard()) return;
  this.castOrPlayRequested.emit(card); // mirror the onBattlefieldDrop emission shape
}
```

> Match `CardSnapshotLike` to the actual parameter type used by `onBattlefieldDrop` / `cdkDragData` (the card snapshot type the hand renders). Emit exactly what `onBattlefieldDrop` emits — inspect board.component.ts:1735 and copy that payload shape so `match.ts`'s translation (`onHandClicked`, :736) receives what it expects.

Wire the click on the hand-card element (board.component.ts ~line 522):

```html
<button ... (click)="onHandCardTap(c)">
```

> If a `(click)` already exists on that element for selection, branch inside the existing handler: when `viewport.isMobileBoard()` and the card is a playable self-hand card, call `onHandCardTap`; otherwise fall through to current behaviour. Do not add a second competing click handler.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ng test --no-watch -- src/app/routes/match/components/board.component.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/routes/match/components/board.component.ts src/app/routes/match/components/board.component.spec.ts
git commit -s -m "feat(mobile): tap a hand card to play it"
```

---

## Task 7: Tap-to-activate ability

On desktop, activating a permanent's ability uses right-click (`onContextMenu`, board.component.ts:1088) or double-click (`onSelfBattlefieldDoubleClick`, :1124) — both awkward on touch. On mobile, a single tap on a self permanent that has an available activated ability surfaces the same ability menu the context menu builds. (When a card-select prompt is active, board taps belong to `SelectionService` — so this only fires when there is NO active board-select mode.)

**Files:**
- Modify: `src/app/routes/match/components/board.component.ts` (self-permanent tap dispatch; reuse the context-menu ability list)
- Test: `src/app/routes/match/components/board.component.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('opens the ability menu when a self permanent with an activated ability is tapped on mobile (no active prompt)', () => {
  TestBed.configureTestingModule({
    providers: [{ provide: ViewportService, useValue: mobileVpStub(true) }],
  });
  const fixture = TestBed.createComponent(BoardComponent);
  const cmp = fixture.componentInstance;
  const perm = makeSelfPermanentWithAbility('inst-9'); // reuse/extend the spec's factory
  cmp.onBoardCardClick(perm); // existing entry point for board taps

  // The context-menu/ability overlay model the board already uses should now be open.
  expect(cmp.contextMenu()).not.toBeNull(); // match the real menu signal name
});

it('does NOT open the ability menu when a board-select prompt is active', () => {
  TestBed.configureTestingModule({
    providers: [{ provide: ViewportService, useValue: mobileVpStub(true) }],
  });
  const fixture = TestBed.createComponent(BoardComponent);
  const cmp = fixture.componentInstance;
  // Drive SelectionService into an active targets mode via setPrompt(...) so mode() is non-null,
  // then a tap must be consumed by selection, not ability-activation.
  const sel = TestBed.inject(SelectionService);
  sel.setBoardInstanceIds(new Set(['inst-9']));
  sel.setPrompt(targetsPromptFor(['inst-9']));
  cmp.onBoardCardClick(makeSelfPermanentWithAbility('inst-9'));
  expect(cmp.contextMenu()).toBeNull();
});
```

> Replace `contextMenu()` / `makeSelfPermanentWithAbility` / `targetsPromptFor` with the real signal and factory names. The board already has a context-menu overlay model (the `Activate …` entries are built at board.component.ts:690); assert on whatever signal drives that overlay.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ng test --no-watch -- src/app/routes/match/components/board.component.spec.ts`
Expected: FAIL — tap does not open the ability menu on mobile.

- [ ] **Step 3: Implement**

In `onBoardCardClick` (board.component.ts:866), add a mobile branch BEFORE the selection-toggle logic. When there is no active board-select mode (`!this.selection.mode()`), the tapped card is a self permanent, and it has an activated ability, open the same menu `onContextMenu` builds:

```typescript
onBoardCardClick(c: CardSnapshotLike): void {
  // Mobile: with no active card-select prompt, a tap on an own permanent that
  // has an activated ability opens the ability menu (desktop uses right-click).
  if (this.viewport.isMobileBoard() && !this.selection.mode() && this.hasActivatedAbility(c) && this.isOwnPermanent(c)) {
    this.openAbilityMenuFor(c); // reuse the path onContextMenu uses to populate + show the menu
    return;
  }
  // ...existing selection-toggle / attacker / blocker logic unchanged...
}
```

> Implement `openAbilityMenuFor` by factoring the menu-construction half of `onContextMenu` (board.component.ts:1088) into a method both call — do not duplicate the ability-list building. Reuse the existing predicates for "own permanent" and "has an `Activated` ability" (the same checks gating the `Activate …` entries at :690 and the activated-ability lookup at :1160). If those checks are inline, extract them as `isOwnPermanent` / `hasActivatedAbility` helpers.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ng test --no-watch -- src/app/routes/match/components/board.component.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/routes/match/components/board.component.ts src/app/routes/match/components/board.component.spec.ts
git commit -s -m "feat(mobile): tap an own permanent to open its ability menu"
```

- [ ] **Step 6: Slice 2 PR**

```bash
npx ng test --no-watch
git push -u origin <slice-2-branch>
gh pr create --repo bg9m9r/majik.portal --base main --title "feat(mobile): tap to play / activate (slice 2)" --body "Disable hand drag on touch; tap hand card to play; tap own permanent to activate. Behind isMobileBoard."
gh pr merge <n> --repo bg9m9r/majik.portal --auto --squash
```

---

# Slice 3 — Preview + bottom-sheet (PR 3)

## Task 8: Long-press preview directive

A reusable `(longPress)` directive (pointer-hold ~400ms, cancels if the finger moves past a small threshold or lifts early). Wired on board cards to open `CardPopoverService`. Single tap is unaffected (the directive only emits on a held press).

**Files:**
- Create: `src/app/ui/long-press.directive.ts`
- Create: `src/app/ui/long-press.directive.spec.ts`
- Modify: `src/app/routes/match/components/board.component.ts` (apply directive to card elements; open popover)

- [ ] **Step 1: Write the failing test**

```typescript
// long-press.directive.spec.ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LongPressDirective } from './long-press.directive';

@Component({
  standalone: true,
  imports: [LongPressDirective],
  template: `<div appLongPress (longPress)="fired = fired + 1" [longPressDelayMs]="50"></div>`,
})
class Host { fired = 0; }

function pointer(type: string, x = 0, y = 0): PointerEvent {
  return new PointerEvent(type, { clientX: x, clientY: y, bubbles: true });
}

describe('LongPressDirective', () => {
  function setup() {
    const f = TestBed.configureTestingModule({ imports: [Host] }).createComponent(Host);
    f.detectChanges();
    return { f, el: f.nativeElement.querySelector('div') as HTMLElement };
  }

  it('emits longPress after the delay with no movement', async () => {
    const { f, el } = setup();
    el.dispatchEvent(pointer('pointerdown', 10, 10));
    await new Promise(r => setTimeout(r, 80));
    expect(f.componentInstance.fired).toBe(1);
  });

  it('does not emit if released before the delay', async () => {
    const { f, el } = setup();
    el.dispatchEvent(pointer('pointerdown', 10, 10));
    el.dispatchEvent(pointer('pointerup', 10, 10));
    await new Promise(r => setTimeout(r, 80));
    expect(f.componentInstance.fired).toBe(0);
  });

  it('cancels if the pointer moves past the threshold (treated as scroll)', async () => {
    const { f, el } = setup();
    el.dispatchEvent(pointer('pointerdown', 10, 10));
    el.dispatchEvent(pointer('pointermove', 60, 10)); // >10px
    await new Promise(r => setTimeout(r, 80));
    expect(f.componentInstance.fired).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ng test --no-watch -- src/app/ui/long-press.directive.spec.ts`
Expected: FAIL — cannot find module `./long-press.directive`.

- [ ] **Step 3: Implement**

```typescript
// long-press.directive.ts
import { Directive, ElementRef, EventEmitter, Input, OnDestroy, Output, inject } from '@angular/core';

const MOVE_CANCEL_PX = 10;

@Directive({
  selector: '[appLongPress]',
  standalone: true,
  host: {
    '(pointerdown)': 'onDown($event)',
    '(pointermove)': 'onMove($event)',
    '(pointerup)': 'cancel()',
    '(pointercancel)': 'cancel()',
    '(pointerleave)': 'cancel()',
  },
})
export class LongPressDirective implements OnDestroy {
  @Input() longPressDelayMs = 400;
  @Output() longPress = new EventEmitter<PointerEvent>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startX = 0;
  private startY = 0;
  private down: PointerEvent | null = null;

  onDown(e: PointerEvent): void {
    this.down = e;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.timer = setTimeout(() => {
      if (this.down) this.longPress.emit(this.down);
      this.cancel();
    }, this.longPressDelayMs);
  }

  onMove(e: PointerEvent): void {
    if (!this.timer) return;
    if (Math.abs(e.clientX - this.startX) > MOVE_CANCEL_PX || Math.abs(e.clientY - this.startY) > MOVE_CANCEL_PX) {
      this.cancel();
    }
  }

  cancel(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.down = null;
  }

  ngOnDestroy(): void { this.cancel(); }
}
```

In `board.component.ts`: add `LongPressDirective` to `imports`, apply it to the card element, and open the popover. Reuse the existing `popover.show(snapshotToCard(card), rect)` call already used by the context-menu `details` action (board.component.ts:1268):

```html
<app-card-view ... appLongPress (longPress)="onCardLongPress(c, $event)"></app-card-view>
```

```typescript
onCardLongPress(c: CardSnapshotLike, e: PointerEvent): void {
  const rect = (e.target as HTMLElement).getBoundingClientRect();
  this.popover.show(snapshotToCard(c), rect);
}
```

> Use the same `snapshotToCard` + `popover.show(card, rect)` the file already calls at :1268. Apply the directive on the card wrapper used for both battlefields and hands so preview works everywhere. Not gated to mobile — long-press is harmless on desktop (mouse-hold) and keeps one code path.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ng test --no-watch -- src/app/ui/long-press.directive.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/long-press.directive.ts src/app/ui/long-press.directive.spec.ts src/app/routes/match/components/board.component.ts
git commit -s -m "feat(mobile): long-press a card to preview it"
```

---

## Task 9: Bottom-sheet for non-board prompts

`prompt-overlay.component.ts` renders a centered `max-w-3xl` modal (line 190) for non-board prompt kinds (`libraryPick`, `surveil`, `yesNo`, `x`, `mana`, `mode`, `mulligan`, `bottom`, `revealPick`). On mobile, render that same content as a bottom-anchored sheet so the board stays visible. The `#140` slim-banner path (`boardMode()`) is unchanged.

**Files:**
- Modify: `src/app/routes/match/components/prompt-overlay.component.ts` (inject `ViewportService`; swap the container classes when mobile + not board mode; co-locate sheet CSS in `styles[]`)
- Test: `src/app/routes/match/components/prompt-overlay.component.spec.ts` (existing)

- [ ] **Step 1: Write the failing test**

```typescript
import { ViewportService } from '../../../core/ui/viewport.service';
import { signal } from '@angular/core';

function vpStub(isMobile: boolean) {
  return { isMobileBoard: signal(isMobile), isPortrait: signal(false) } as unknown as ViewportService;
}

it('uses the bottom-sheet container for a non-board prompt on mobile', () => {
  // configure the overlay with a yesNo prompt (off-board kind) — reuse the spec's prompt factory
  TestBed.configureTestingModule({
    providers: [{ provide: ViewportService, useValue: vpStub(true) }],
  });
  const fixture = renderOverlayWith(yesNoPrompt()); // reuse existing helper
  const root = fixture.nativeElement.querySelector('.prompt-overlay') as HTMLElement;
  expect(root.classList.contains('prompt-sheet')).toBe(true);
  expect(root.classList.contains('max-w-3xl')).toBe(false);
});

it('keeps the centered modal on desktop', () => {
  TestBed.configureTestingModule({
    providers: [{ provide: ViewportService, useValue: vpStub(false) }],
  });
  const fixture = renderOverlayWith(yesNoPrompt());
  const root = fixture.nativeElement.querySelector('.prompt-overlay') as HTMLElement;
  expect(root.classList.contains('max-w-3xl')).toBe(true);
  expect(root.classList.contains('prompt-sheet')).toBe(false);
});
```

> Reuse the existing `prompt-overlay.component.spec.ts` setup and its prompt factory (it already builds prompts for the modal-grid tests). `yesNoPrompt()` / `renderOverlayWith()` stand in for whatever the file already uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ng test --no-watch -- src/app/routes/match/components/prompt-overlay.component.spec.ts`
Expected: FAIL — `prompt-sheet` class never applied.

- [ ] **Step 3: Implement**

Inject the service:

```typescript
private readonly viewport = inject(ViewportService);
readonly sheetMode = computed(() => this.viewport.isMobileBoard() && !this.boardMode());
```

On the overlay root element (prompt-overlay.component.ts:190), make the container classes conditional. Replace the static class string with a base class plus conditional bindings:

```html
<div class="prompt-overlay fixed z-50 bg-black/80 p-3 shadow-xl"
     [class.prompt-sheet]="sheetMode()"
     [class.inset-x-0]="!sheetMode()"
     [class.top-0]="!sheetMode()"
     [class.mx-auto]="!sheetMode()"
     [class.mt-3]="!sheetMode()"
     [class.max-w-3xl]="!sheetMode()"
     [class.rounded]="!sheetMode()">
```

Add the sheet CSS to the component `styles[]` (jsdom-safe; `//` comments only):

```typescript
styles: [`
  // ...existing inline styles preserved...

  // Mobile bottom-sheet: full-width, anchored to the bottom edge, board stays visible above.
  .prompt-sheet {
    inset-inline: 0;
    bottom: 0;
    border-top-left-radius: 12px;
    border-top-right-radius: 12px;
    max-height: 60vh;
    overflow-y: auto;
  }
`],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ng test --no-watch -- src/app/routes/match/components/prompt-overlay.component.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/routes/match/components/prompt-overlay.component.ts src/app/routes/match/components/prompt-overlay.component.spec.ts
git commit -s -m "feat(mobile): non-board prompts render as a bottom-sheet"
```

- [ ] **Step 6: Slice 3 PR**

```bash
npx ng test --no-watch
git push -u origin <slice-3-branch>
gh pr create --repo bg9m9r/majik.portal --base main --title "feat(mobile): long-press preview + bottom-sheet prompts (slice 3)" --body "Long-press to preview any card; non-board prompts become a bottom-sheet on mobile."
gh pr merge <n> --repo bg9m9r/majik.portal --auto --squash
```

---

## Final manual verification (after all three slices merge)

`ng test` cannot exercise human-seat touch interaction (known live-loop coverage gap). On a real phone (or device-emulation in DevTools with touch + a landscape phone profile), play a full match:

- Portrait shows the rotate overlay; rotating to landscape reveals the board.
- Cards are legibly scaled; wide rows scroll sideways.
- Tap a hand card → it plays; tap an own permanent → ability menu; tap a glowing target → it resolves (the #140 flow).
- Long-press any card → detail popover; releasing/scrolling does not trigger it.
- A `yesNo` / scry / mode prompt appears as a bottom-sheet, board still visible.
- No drag occurs on touch.
```
