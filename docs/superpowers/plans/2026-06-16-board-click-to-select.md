# Board Click-to-Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player click objects on the battlefield to choose targets, creature picks, attackers, and blockers — with legal objects highlighted and illegal ones dimmed — replacing the modal candidate grid for board-resident prompts.

**Architecture:** A single injectable `SelectionService` (Angular signals) owns the in-flight selection set and the active selection mode derived from the current prompt. The board component reads it to mark cards (`data-targetable`/`data-dimmed`/`data-selected`) and handle clicks; the prompt-overlay renders a slim banner (instruction + Done/Confirm/Cancel) for the four in-scope kinds and its existing modal grid for everything else. No server/DTO/OpenAPI change — decisions reuse the existing `PromptDecision` → `GameCommand` translation in `match.ts`.

**Tech Stack:** Angular 21 standalone components, NgRx Signals, `@angular/core` signals/computed, `ng test --no-watch` (jsdom), Tailwind v4 + co-located component `styles[]`.

---

## Background facts (verified against current code)

- `PromptEnvelope` (`src/app/core/match/match.types.ts:185`) carries `expectedKinds: string[]`, `candidates?: CardSnapshot[]`, and (from portal #138) `choiceView?: { kind: string; min: number; max: number }`. Confirm this field exists; if `min`/`max` are missing, add them (Task 1).
- `detectKind()` (`prompt-overlay.component.ts:114`) maps `expectedKinds` → `PromptKind` (`'targets' | 'choice' | 'attackers' | 'blockers' | …`).
- `prompt-overlay` `candidates` computed (`prompt-overlay.component.ts:935`) prefers `prompt().candidates` (engine-filtered legal pool), else falls back to all battlefield permanents.
- `selfCreatures` / `eligibleBlockers` / `attackerList` computeds exist (`prompt-overlay.component.ts:902-918`).
- Decision flow: overlay emits `decision` (`PromptDecision`), `match.ts onPromptDecision()` → `translateDecision()` (`match.ts:772`) → `send(cmd)` → `game.clearPrompt()`. Decision kinds already handled: `targets` (`targetInstanceIds`), `choice` (`selectedInstanceIds` + `kind`), `attackers` (`attackers`), `blockers` (`blockers`).
- Board cards render `<app-card-view [snapshot]="c" [attr.data-card-id]="c.instanceId" zone="…">` (`board.component.ts`), card component at `src/app/ui/card-view.component.ts`.
- Board already draws SVG combat arrows from a `liveAssignments` input via `recomputeCombatLines()`; overlay relays `assignmentsChanged`.
- Match route wires `<app-board>` and `<app-prompt-overlay>` as siblings under `match.ts`, both able to inject route-provided services.
- Tests run via `ng test --no-watch`; jsdom does NOT load `board.scss` — any CSS asserted in a test must live in the component `styles[]`. Use `//` comments only inside inline template literals.

## File structure

- Create: `src/app/core/match/selection.service.ts` — signal service: selection mode + selected set + helpers. One responsibility: in-flight board selection state.
- Create: `src/app/core/match/selection.service.spec.ts` — unit tests for the service.
- Modify: `src/app/core/match/match.types.ts` — ensure `choiceView.min/max`; add `SelectionMode` type.
- Modify: `src/app/ui/card-view.component.ts` — `targetable`/`dimmed`/`selected` inputs + co-located styles.
- Modify: `src/app/routes/match/components/board.component.ts` — bind selection attrs, click handlers, auto-submit, attacker/blocker on-board.
- Modify: `src/app/routes/match/components/prompt-overlay.component.ts` — slim banner for in-scope kinds; suppress grid for them.
- Modify: `src/app/routes/match/match.ts` — provide `SelectionService`, feed it the prompt, relay submit decisions.
- Test: co-located `*.spec.ts` next to each modified component.

## In-scope kinds (constant)

```ts
// selection.service.ts
export const BOARD_SELECT_KINDS = ['targets', 'choice', 'attackers', 'blockers'] as const;
export type BoardSelectKind = typeof BOARD_SELECT_KINDS[number];
```

---

### Task 1: Selection types + `choiceView` min/max

**Files:**
- Modify: `src/app/core/match/match.types.ts`

- [ ] **Step 1: Confirm/extend `choiceView`.** Open `match.types.ts`, find `PromptEnvelope`. Ensure it has:

```ts
  choiceView?: { kind: string; min: number; max: number };
```

If `choiceView` exists without `min`/`max`, add them. If it already has them, no change.

- [ ] **Step 2: Add the `SelectionMode` type** near `PromptDecision`:

```ts
// Derived view of the active prompt for on-board selection. Null when no
// board-resident selection is in progress (off-board prompts use the modal).
export interface SelectionMode {
  kind: 'targets' | 'choice' | 'attackers' | 'blockers';
  candidateIds: ReadonlySet<string>; // legal, board-locatable instanceIds
  min: number;
  max: number; // Number.MAX_SAFE_INTEGER for open-ended (attackers/blockers)
  sourceLabel: string; // instruction text, e.g. prompt.label/description
  choiceKind?: string; // echo for 'choice' decisions (choiceView.kind)
  cancellable: boolean;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/core/match/match.types.ts
git commit -s -m "feat(match): selection-mode types for on-board selection"
```

---

### Task 2: SelectionService (mode derivation + selected set)

**Files:**
- Create: `src/app/core/match/selection.service.ts`
- Test: `src/app/core/match/selection.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { SelectionService } from './selection.service';
import type { PromptEnvelope, GameState } from './match.types';

function prompt(p: Partial<PromptEnvelope>): PromptEnvelope {
  return { gameId: 'g', playerId: 'p', expectedKinds: [], ...p };
}

describe('SelectionService', () => {
  let svc: SelectionService;
  beforeEach(() => { TestBed.configureTestingModule({}); svc = TestBed.inject(SelectionService); });

  it('derives a targets selection mode from a board-resident candidate pool', () => {
    const board = new Set(['a', 'b', 'c']);
    svc.setBoardInstanceIds(board);
    svc.setPrompt(prompt({
      expectedKinds: ['ChooseTargetsCommand'],
      candidates: [{ instanceId: 'a' } as any, { instanceId: 'b' } as any],
      choiceView: undefined,
      label: 'Bolt: any target',
    }));
    const m = svc.mode();
    expect(m?.kind).toBe('targets');
    expect([...(m!.candidateIds)].sort()).toEqual(['a', 'b']);
    expect(m!.min).toBe(1);
    expect(m!.max).toBe(1);
  });

  it('falls back to no selection mode when a candidate is not board-locatable', () => {
    svc.setBoardInstanceIds(new Set(['a']));
    svc.setPrompt(prompt({
      expectedKinds: ['ChooseTargetsCommand'],
      candidates: [{ instanceId: 'a' } as any, { instanceId: 'offboard' } as any],
    }));
    expect(svc.mode()).toBeNull(); // modal handles it
  });

  it('uses choiceView min/max for a choice prompt', () => {
    svc.setBoardInstanceIds(new Set(['x', 'y']));
    svc.setPrompt(prompt({
      expectedKinds: ['ChoiceCommand'],
      candidates: [{ instanceId: 'x' } as any, { instanceId: 'y' } as any],
      choiceView: { kind: 'PickOne', min: 1, max: 1 },
      label: 'Choose a creature to sacrifice',
    }));
    const m = svc.mode();
    expect(m?.kind).toBe('choice');
    expect(m?.choiceKind).toBe('PickOne');
  });

  it('toggles selection and resets when the prompt changes', () => {
    svc.setBoardInstanceIds(new Set(['a', 'b']));
    svc.setPrompt(prompt({ expectedKinds: ['ChooseTargetsCommand'], candidates: [{ instanceId: 'a' } as any, { instanceId: 'b' } as any] }));
    svc.toggle('a');
    expect(svc.selected()).toEqual(['a']);
    svc.setPrompt(prompt({ expectedKinds: ['ChooseTargetsCommand'], candidates: [{ instanceId: 'a' } as any] }));
    expect(svc.selected()).toEqual([]); // reset on prompt change
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx ng test --no-watch --include='**/selection.service.spec.ts'`
Expected: FAIL — `SelectionService` not found.

- [ ] **Step 3: Implement the service**

```ts
import { Injectable, signal, computed } from '@angular/core';
import type { PromptEnvelope, SelectionMode } from './match.types';

const OPEN_ENDED = Number.MAX_SAFE_INTEGER;

@Injectable()
export class SelectionService {
  private readonly _prompt = signal<PromptEnvelope | null>(null);
  private readonly _boardIds = signal<ReadonlySet<string>>(new Set());
  private readonly _selected = signal<string[]>([]);

  readonly selected = this._selected.asReadonly();

  /** instanceIds currently rendered on the board (battlefield + hand). */
  setBoardInstanceIds(ids: ReadonlySet<string>): void { this._boardIds.set(ids); }

  /** New prompt → recompute mode and reset selection. */
  setPrompt(p: PromptEnvelope | null): void {
    this._prompt.set(p);
    this._selected.set([]);
  }

  readonly mode = computed<SelectionMode | null>(() => {
    const p = this._prompt();
    if (!p) return null;
    const kind = this.boardKind(p.expectedKinds);
    if (!kind) return null;

    // Targets/choice need a board-locatable candidate pool. Combat kinds
    // declare from own creatures (resolved in the board component) so they
    // do not require a candidates list here.
    if (kind === 'targets' || kind === 'choice') {
      const cands = p.candidates;
      if (!cands || cands.length === 0) return null; // no legal pool → modal
      const ids = cands.map(c => c.instanceId);
      const board = this._boardIds();
      if (!ids.every(id => board.has(id))) return null; // mixed-zone → modal
      const { min, max } = this.bounds(kind, p);
      return {
        kind, min, max,
        candidateIds: new Set(ids),
        sourceLabel: p.label ?? p.description ?? '',
        choiceKind: p.choiceView?.kind,
        cancellable: kind === 'targets', // spell-cast targeting is cancellable
      };
    }

    // attackers / blockers: open-ended set declaration; candidate gating is
    // done by the board against own creatures.
    return {
      kind, min: 0, max: OPEN_ENDED,
      candidateIds: new Set(),
      sourceLabel: p.label ?? p.description ?? '',
      cancellable: false,
    };
  });

  toggle(id: string): void {
    const cur = this._selected();
    this._selected.set(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
  }

  clear(): void { this._selected.set([]); }

  private boardKind(kinds: string[]): SelectionMode['kind'] | null {
    const ks = (kinds ?? []).map(k => k.toLowerCase());
    if (ks.some(k => k.includes('attacker'))) return 'attackers';
    if (ks.some(k => k.includes('blocker'))) return 'blockers';
    if (ks.some(k => k.includes('target'))) return 'targets';
    if (ks.some(k => k.includes('choicecommand') || k === 'choice')) return 'choice';
    return null;
  }

  private bounds(kind: 'targets' | 'choice', p: PromptEnvelope): { min: number; max: number } {
    if (kind === 'choice' && p.choiceView) return { min: p.choiceView.min, max: p.choiceView.max };
    // targets: the engine does not ship min/max yet; default to exactly one.
    // (Multi-target spells without a shipped count still work via the modal
    //  fallback path because this is only reached for board-resident pools.)
    return { min: 1, max: 1 };
  }
}
```

> NOTE: `boardKind` ordering mirrors `detectKind` (specific combat kinds before targets) to keep the two consistent. If the engine later ships target min/max on the envelope, replace the `bounds` default with those fields.

- [ ] **Step 4: Run test, verify it passes**

Run: `npx ng test --no-watch --include='**/selection.service.spec.ts'`
Expected: PASS (4 specs).

- [ ] **Step 5: Commit**

```bash
git add src/app/core/match/selection.service.ts src/app/core/match/selection.service.spec.ts
git commit -s -m "feat(match): SelectionService derives board selection mode + selected set"
```

---

### Task 3: Card-view visual affordance

**Files:**
- Modify: `src/app/ui/card-view.component.ts`
- Test: `src/app/ui/card-view.component.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
import { TestBed } from '@angular/core/testing';
import { CardViewComponent } from './card-view.component';

function render(inputs: Record<string, unknown>) {
  const f = TestBed.createComponent(CardViewComponent);
  Object.entries({ snapshot: { instanceId: 'a', name: 'X', types: ['Creature'] }, ...inputs })
    .forEach(([k, v]) => f.componentRef.setInput(k, v));
  f.detectChanges();
  return f.nativeElement.querySelector('[data-card-id]') ?? f.nativeElement.firstElementChild;
}

describe('CardViewComponent selection affordance', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [CardViewComponent] }));

  it('marks a targetable card', () => {
    const el = render({ targetable: true });
    expect(el.getAttribute('data-targetable')).toBe('true');
  });
  it('marks a dimmed card', () => {
    const el = render({ dimmed: true });
    expect(el.getAttribute('data-dimmed')).toBe('true');
  });
  it('marks a selected card', () => {
    const el = render({ selectedForTarget: true });
    expect(el.getAttribute('data-selected')).toBe('true');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx ng test --no-watch --include='**/card-view.component.spec.ts'`
Expected: FAIL — inputs `targetable`/`dimmed`/`selectedForTarget` unknown.

- [ ] **Step 3: Add inputs + host bindings + co-located styles.** In `card-view.component.ts` add signal inputs and bind them as data-attributes on the card root element (the element that already carries the card visuals). Add to the component decorator `styles[]` (NOT board.scss):

```ts
// inputs (with the other input() declarations)
readonly targetable = input(false);
readonly dimmed = input(false);
readonly selectedForTarget = input(false);
```

On the root element of the template add:

```html
[attr.data-targetable]="targetable() ? 'true' : null"
[attr.data-dimmed]="dimmed() ? 'true' : null"
[attr.data-selected]="selectedForTarget() ? 'true' : null"
```

Add to `styles: [ ... ]`:

```css
:host [data-targetable='true'], :host([data-targetable='true']) {
  outline: 2px solid var(--majik-accent, #fbbf24);
  outline-offset: 1px;
  box-shadow: 0 0 10px 1px rgba(251, 191, 36, 0.55);
  cursor: pointer;
}
:host [data-dimmed='true'], :host([data-dimmed='true']) {
  opacity: 0.4;
  pointer-events: none;
  filter: grayscale(0.4);
}
:host [data-selected='true'], :host([data-selected='true']) {
  outline: 3px solid var(--majik-accent, #fbbf24);
  box-shadow: 0 0 14px 2px rgba(251, 191, 36, 0.85);
}
```

> Place the attribute bindings on whichever element the existing `[attr.data-card-id]` / visual frame is on so the outline wraps the rendered card. Mirror however the existing `is-tapped` / `card--castable` markers are applied.

- [ ] **Step 4: Run test, verify it passes**

Run: `npx ng test --no-watch --include='**/card-view.component.spec.ts'`
Expected: PASS (3 specs).

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/card-view.component.ts src/app/ui/card-view.component.spec.ts
git commit -s -m "feat(card-view): targetable/dimmed/selected visual affordance"
```

---

### Task 4: Board click-to-select for targets + choice

**Files:**
- Modify: `src/app/routes/match/components/board.component.ts`
- Test: `src/app/routes/match/components/board.component.spec.ts` (extend or create)

- [ ] **Step 1: Write the failing test** (component-level; drives a board card click and asserts a decision is emitted on auto-submit)

```ts
import { TestBed } from '@angular/core/testing';
import { BoardComponent } from './board.component';
import { SelectionService } from '../../../core/match/selection.service';

function creature(id: string) {
  return { instanceId: id, name: id, types: ['Creature'], power: 1, toughness: 1, tapped: false, summoningSickness: false } as any;
}

describe('BoardComponent on-board target selection', () => {
  let svc: SelectionService;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BoardComponent], providers: [SelectionService] });
    svc = TestBed.inject(SelectionService);
  });

  it('auto-submits a fixed single-target selection on click', () => {
    const f = TestBed.createComponent(BoardComponent);
    const cmp = f.componentInstance;
    const emitted: any[] = [];
    cmp.boardDecision.subscribe((d: any) => emitted.push(d));
    // minimal state: opponent creature 'z' is the only legal target
    f.componentRef.setInput('state', { players: [
      { id: 'me', name: 'Me', battlefield: { cards: [] }, hand: { cards: [] } },
      { id: 'foe', name: 'Foe', battlefield: { cards: [creature('z')] }, hand: { cards: [] } },
    ] } as any);
    f.componentRef.setInput('selfPlayerIds', ['me']);
    f.detectChanges();
    svc.setBoardInstanceIds(new Set(['z']));
    svc.setPrompt({ gameId: 'g', playerId: 'me', expectedKinds: ['ChooseTargetsCommand'], candidates: [creature('z')], label: 'Bolt' } as any);
    f.detectChanges();

    cmp.onBoardCardClick(creature('z'));
    expect(emitted).toEqual([{ kind: 'targets', targetInstanceIds: ['z'] }]);
  });

  it('ignores clicks on non-candidate cards', () => {
    const f = TestBed.createComponent(BoardComponent);
    const cmp = f.componentInstance;
    const emitted: any[] = [];
    cmp.boardDecision.subscribe((d: any) => emitted.push(d));
    f.componentRef.setInput('state', { players: [{ id: 'me', name: 'Me', battlefield: { cards: [creature('z')] }, hand: { cards: [] } }] } as any);
    f.componentRef.setInput('selfPlayerIds', ['me']);
    f.detectChanges();
    svc.setBoardInstanceIds(new Set(['z']));
    svc.setPrompt({ gameId: 'g', playerId: 'me', expectedKinds: ['ChooseTargetsCommand'], candidates: [creature('z')] } as any);
    f.detectChanges();
    cmp.onBoardCardClick(creature('not-z'));
    expect(emitted).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx ng test --no-watch --include='**/board.component.spec.ts'`
Expected: FAIL — `onBoardCardClick` / `boardDecision` undefined.

- [ ] **Step 3: Implement board selection wiring.** In `board.component.ts`:

1. Inject the service: `private readonly selection = inject(SelectionService);`
2. Add an output: `readonly boardDecision = output<{ kind: string; targetInstanceIds?: string[]; selectedInstanceIds?: string[]; choiceKind?: string }>();`
3. Add helpers:

```ts
// True when an on-board selection mode is active.
readonly inSelection = computed(() => this.selection.mode() !== null);

isTargetable(id: string): boolean {
  const m = this.selection.mode();
  if (!m) return false;
  if (m.kind === 'targets' || m.kind === 'choice') return m.candidateIds.has(id);
  return false; // attackers/blockers handled in Tasks 6/7
}
isSelectedForTarget(id: string): boolean { return this.selection.selected().includes(id); }
isDimmed(id: string): boolean { return this.inSelection() && !this.isTargetable(id) && !this.isSelectedForTarget(id); }

onBoardCardClick(card: { instanceId: string }): void {
  const m = this.selection.mode();
  if (!m || (m.kind !== 'targets' && m.kind !== 'choice')) return;
  if (!m.candidateIds.has(card.instanceId)) return; // illegal — ignore
  this.selection.toggle(card.instanceId);
  this.maybeAutoSubmit(m);
}

private maybeAutoSubmit(m: NonNullable<ReturnType<SelectionService['mode']>>): void {
  const n = this.selection.selected().length;
  if (m.min === m.max && n === m.max) this.submitSelection(m);
}

submitSelection(m: NonNullable<ReturnType<SelectionService['mode']>>): void {
  const ids = this.selection.selected();
  if (m.kind === 'targets') this.boardDecision.emit({ kind: 'targets', targetInstanceIds: ids });
  else if (m.kind === 'choice') this.boardDecision.emit({ kind: 'choice', selectedInstanceIds: ids, choiceKind: m.choiceKind });
  this.selection.clear();
}
```

4. Bind the affordance + click on each `<app-card-view>` (every zone-rendered card — battlefield both sides, and hand if a candidate can live there). Example for a battlefield card:

```html
<app-card-view
  [snapshot]="c"
  [attr.data-card-id]="c.instanceId"
  [targetable]="isTargetable(c.instanceId)"
  [dimmed]="isDimmed(c.instanceId)"
  [selectedForTarget]="isSelectedForTarget(c.instanceId)"
  (click)="onBoardCardClick(c)"
  ... existing bindings (contextmenu, animate, etc.) ... />
```

> Apply the same four bindings to each `app-card-view` instance across the zones. Keep existing `(contextmenu)`/`(dblclick)` handlers; the new `(click)` only acts when a selection mode is active (guarded inside `onBoardCardClick`), so it does not interfere with normal play.

- [ ] **Step 4: Run test, verify it passes**

Run: `npx ng test --no-watch --include='**/board.component.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/routes/match/components/board.component.ts src/app/routes/match/components/board.component.spec.ts
git commit -s -m "feat(board): click-to-select targets/choice with highlight+dim affordance"
```

---

### Task 5: Slim banner + suppress modal grid for in-scope kinds; wire match.ts

**Files:**
- Modify: `src/app/routes/match/components/prompt-overlay.component.ts`
- Modify: `src/app/routes/match/match.ts`
- Test: extend `prompt-overlay.component.spec.ts`

- [ ] **Step 1: Write the failing test** (overlay renders the slim banner, not the grid, for a board-resident targets prompt; Done/Cancel buttons present per cancellable)

```ts
it('renders the slim banner (not the candidate grid) for a board-resident targets prompt', () => {
  // selection mode active via SelectionService
  selection.setBoardInstanceIds(new Set(['z']));
  selection.setPrompt({ gameId: 'g', playerId: 'me', expectedKinds: ['ChooseTargetsCommand'], candidates: [{ instanceId: 'z' } as any], label: 'Bolt' } as any);
  fixture.componentRef.setInput('prompt', selection['_prompt']?.() ?? null);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  expect(host.querySelector('[data-banner="board-select"]')).toBeTruthy();
  expect(host.querySelector('[data-grid="targets"]')).toBeFalsy(); // grid suppressed
});
```

> Adjust the input plumbing to however the spec already injects prompt + SelectionService. If `_prompt` is private, expose a tiny public getter or pass the same envelope to both `setPrompt` and the component input.

- [ ] **Step 2: Run test, verify it fails**

Run: `npx ng test --no-watch --include='**/prompt-overlay.component.spec.ts'`
Expected: FAIL — banner element absent.

- [ ] **Step 3: Implement.**

1. Inject `SelectionService` in the overlay: `private readonly selection = inject(SelectionService);`
2. Add `readonly boardMode = computed(() => this.selection.mode());`
3. In the template, gate the existing in-scope `@case` blocks so the GRID is suppressed when `boardMode()` is set. Tag the existing targets grid container with `[attr.data-grid]="'targets'"` and wrap it with `@if (!boardMode()) { … existing grid … }`. Do the same for the attackers/blockers/choice cases.
4. Add the slim banner, rendered when `boardMode()` is non-null:

```html
@if (boardMode(); as bm) {
  <div data-banner="board-select" class="flex items-center justify-between gap-3 text-xs">
    <span class="opacity-80">{{ bm.sourceLabel || titleFor(kind()) }}
      — {{ selection.selected().length }}{{ bm.max < 9e15 ? ('/' + bm.max) : '' }} selected</span>
    <span class="flex gap-2">
      @if (bm.kind === 'attackers') {
        <button type="button" (click)="confirmBoardAttackers()">Confirm attackers</button>
      } @else if (bm.kind === 'blockers') {
        <button type="button" (click)="confirmBoardBlockers()">Confirm blocks</button>
      } @else {
        <button type="button"
          [disabled]="selection.selected().length < bm.min"
          (click)="confirmBoardSelection(bm)">Done</button>
      }
      @if (bm.cancellable) {
        <button type="button" (click)="onCancel()">Cancel</button>
      }
    </span>
  </div>
}
```

5. Add overlay methods that delegate the explicit (non-auto) submit to the same decision output the overlay already emits:

```ts
confirmBoardSelection(bm: NonNullable<ReturnType<SelectionService['mode']>>): void {
  const ids = this.selection.selected();
  if (bm.kind === 'targets') this.decision.emit({ kind: 'targets', targetInstanceIds: ids });
  else if (bm.kind === 'choice') this.decision.emit({ kind: 'choice', selectedInstanceIds: ids, kind2: bm.choiceKind } as any);
  this.selection.clear();
}
```

> Use the EXACT existing `PromptDecision` field names for `choice` (the ones `translateDecision` reads — `selectedInstanceIds` + the choice kind). Check `match.ts:772` `translateDecision` and match them; do not invent `kind2`.

6. In `match.ts`:
   - Provide `SelectionService` in the match route component `providers: [SelectionService]` so board + overlay share ONE instance.
   - Feed the service the prompt + board ids: in the existing `prompt$` subscription (after `game.setPrompt(envelope)`), call `this.selection.setPrompt(envelope)`. Compute the board instanceId set from `game.state()` (all battlefield + hand cards of all players) and call `this.selection.setBoardInstanceIds(...)` whenever state changes (effect or in the state subscription).
   - Subscribe to the board's new `(boardDecision)` output and route it through the SAME `onPromptDecision()` path the overlay uses, so translation + send + `clearPrompt()` are unchanged:

```html
<app-board ... (boardDecision)="onPromptDecision($event)" />
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx ng test --no-watch --include='**/prompt-overlay.component.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/routes/match/components/prompt-overlay.component.ts src/app/routes/match/match.ts src/app/routes/match/components/prompt-overlay.component.spec.ts
git commit -s -m "feat(match): slim board-select banner; route board decisions; suppress modal grid for board prompts"
```

---

### Task 6: Attackers on-board declaration

**Files:**
- Modify: `src/app/routes/match/components/board.component.ts`
- Test: extend `board.component.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('declares attackers by clicking own untapped creatures and confirms the set', () => {
  const f = TestBed.createComponent(BoardComponent);
  const cmp = f.componentInstance;
  const emitted: any[] = [];
  cmp.boardDecision.subscribe((d: any) => emitted.push(d));
  f.componentRef.setInput('state', { players: [
    { id: 'me', name: 'Me', battlefield: { cards: [creature('a'), creature('b')] }, hand: { cards: [] } },
  ] } as any);
  f.componentRef.setInput('selfPlayerIds', ['me']);
  f.detectChanges();
  svc.setPrompt({ gameId: 'g', playerId: 'me', expectedKinds: ['DeclareAttackersCommand'], label: 'Declare attackers' } as any);
  f.detectChanges();

  cmp.onBoardCardClick(creature('a'));
  cmp.onBoardCardClick(creature('b'));
  cmp.confirmAttackersFromBoard();
  expect(emitted).toEqual([{ kind: 'attackers', attackers: ['a', 'b'] }]);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx ng test --no-watch --include='**/board.component.spec.ts'`
Expected: FAIL — attackers path not handled / `confirmAttackersFromBoard` missing.

- [ ] **Step 3: Implement.** Extend `isTargetable` + `onBoardCardClick` + add confirm/emit + relay `assignmentsChanged` to the existing SVG:

```ts
// own untapped non-sick creatures are attack-eligible
private ownCreatureIds(): Set<string> {
  const s = this.state(); const me = new Set(this.selfPlayerIds());
  const ids = new Set<string>();
  for (const p of s?.players ?? []) if (me.has(p.id))
    for (const c of p.battlefield.cards)
      if ((c.types ?? []).some(t => t.toLowerCase().includes('creature')) && !c.tapped && !c.summoningSickness)
        ids.add(c.instanceId);
  return ids;
}
```

In `isTargetable`, for `kind === 'attackers'` return `this.ownCreatureIds().has(id)`.

In `onBoardCardClick`, add an `attackers` branch:

```ts
if (m.kind === 'attackers') {
  if (!this.ownCreatureIds().has(card.instanceId)) return;
  this.selection.toggle(card.instanceId);
  this.emitAttackerLines();
  return;
}
```

Add:

```ts
private emitAttackerLines(): void {
  this.assignmentsChanged.emit({ kind: 'attackers', attackers: this.selection.selected() });
}
confirmAttackersFromBoard(): void {
  this.boardDecision.emit({ kind: 'attackers', attackers: this.selection.selected() } as any);
  this.selection.clear();
}
```

> `assignmentsChanged` already feeds the live SVG arrows in `match.ts` (`liveAssignments`); reuse it. The overlay banner's `Confirm attackers` button (Task 5) should call into the same submit — wire the banner button to call a board method via the shared service or move `confirmAttackersFromBoard` emission to flow through `boardDecision`. SIMPLEST: have the overlay banner emit the decision directly from the SelectionService selected set (mirror `confirmBoardSelection`) so board and overlay don't need to call each other.

For consistency, implement the attackers/blockers confirm in the OVERLAY banner methods (`confirmBoardAttackers`/`confirmBoardBlockers`) reading `selection.selected()` — the board only handles clicks + live lines. Update Task 5's `confirmBoardAttackers` to:

```ts
confirmBoardAttackers(): void {
  this.decision.emit({ kind: 'attackers', attackers: this.selection.selected() });
  this.selection.clear();
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx ng test --no-watch --include='**/board.component.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/routes/match/components/board.component.ts src/app/routes/match/components/board.component.spec.ts src/app/routes/match/components/prompt-overlay.component.ts
git commit -s -m "feat(board): on-board attacker declaration with live arrows"
```

---

### Task 7: Blockers on-board pairing

**Files:**
- Modify: `src/app/routes/match/components/board.component.ts`
- Test: extend `board.component.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('pairs a blocker to an attacker by two clicks and confirms', () => {
  const f = TestBed.createComponent(BoardComponent);
  const cmp = f.componentInstance;
  const emitted: any[] = [];
  cmp.boardDecision.subscribe((d: any) => emitted.push(d));
  const atk = { ...creature('atk'), tapped: true };
  f.componentRef.setInput('state', { players: [
    { id: 'me', name: 'Me', battlefield: { cards: [creature('blk')] }, hand: { cards: [] } },
    { id: 'foe', name: 'Foe', battlefield: { cards: [atk] }, hand: { cards: [] } },
  ] } as any);
  f.componentRef.setInput('selfPlayerIds', ['me']);
  f.detectChanges();
  svc.setPrompt({ gameId: 'g', playerId: 'me', expectedKinds: ['DeclareBlockersCommand'], label: 'Declare blockers' } as any);
  f.detectChanges();

  cmp.onBoardCardClick(creature('blk'));   // pick blocker
  cmp.onBoardCardClick(atk);               // assign to attacker
  cmp.confirmBlockersFromBoard();
  expect(emitted).toEqual([{ kind: 'blockers', blockers: [{ blockerInstanceId: 'blk', attackerInstanceId: 'atk' }] }]);
});
```

> Confirm the exact `blockers` decision element shape (`{ blockerInstanceId, attackerInstanceId }`) against `prompt-overlay.component.ts` `confirmBlockers()` / `match.ts translateDecision`. Match it precisely.

- [ ] **Step 2: Run test, verify it fails**

Run: `npx ng test --no-watch --include='**/board.component.spec.ts'`
Expected: FAIL — blocker pairing not handled.

- [ ] **Step 3: Implement.** Add a pending-blocker signal + pairing map:

```ts
private readonly pendingBlocker = signal<string | null>(null);
private readonly blockPairs = signal<Array<{ blockerInstanceId: string; attackerInstanceId: string }>>([]);

private attackingIds(): Set<string> {
  const s = this.state(); const me = new Set(this.selfPlayerIds());
  const ids = new Set<string>();
  for (const p of s?.players ?? []) if (!me.has(p.id))
    for (const c of p.battlefield.cards)
      if (c.tapped && (c.types ?? []).some(t => t.toLowerCase().includes('creature')))
        ids.add(c.instanceId); // attacking creatures are the (tapped) enemy creatures
  return ids;
}
```

In `isTargetable` for `kind === 'blockers'`: highlight own untapped creatures (potential blockers) AND, when a blocker is pending, the attacking creatures. In `onBoardCardClick` add a `blockers` branch:

```ts
if (m.kind === 'blockers') {
  const mine = this.ownCreatureIds(); // untapped own creatures
  if (mine.has(card.instanceId)) { this.pendingBlocker.set(card.instanceId); return; }
  const pend = this.pendingBlocker();
  if (pend && this.attackingIds().has(card.instanceId)) {
    this.blockPairs.update(ps => [...ps.filter(p => p.blockerInstanceId !== pend),
      { blockerInstanceId: pend, attackerInstanceId: card.instanceId }]);
    this.pendingBlocker.set(null);
    this.assignmentsChanged.emit({ kind: 'blockers', blockers: this.blockPairs() });
  }
  return;
}
confirmBlockersFromBoard(): void {
  this.boardDecision.emit({ kind: 'blockers', blockers: this.blockPairs() } as any);
  this.blockPairs.set([]); this.pendingBlocker.set(null); this.selection.clear();
}
```

> Note `ownCreatureIds()` (Task 6) filters out tapped/sick; for blockers tapped creatures cannot block, so untapped-only is correct, but DROP the `summoningSickness` filter for blockers (sick creatures CAN block). Add a `forBlock` parameter to `ownCreatureIds(forBlock = false)` that skips the sickness check when true, and call `this.ownCreatureIds(true)` in the blockers branch.

As in Task 6, the OVERLAY banner's `Confirm blocks` button (`confirmBoardBlockers`) should emit the decision from shared state. Since blocker pairs live on the board, expose them via the board's `boardDecision` on its own confirm, OR lift `blockPairs` into `SelectionService`. SIMPLEST consistent approach: move `blockPairs` + `pendingBlocker` into `SelectionService` so the overlay banner button can read them. Update `confirmBoardBlockers` in the overlay:

```ts
confirmBoardBlockers(): void {
  this.decision.emit({ kind: 'blockers', blockers: this.selection.blockPairs() });
  this.selection.resetCombat();
}
```

Add to `SelectionService`: `blockPairs` signal + `setPendingBlocker`/`addBlockPair`/`resetCombat()` helpers; the board calls those instead of local signals. (Keeps ONE selection-state owner per the spec.)

- [ ] **Step 4: Run test, verify it passes**

Run: `npx ng test --no-watch --include='**/board.component.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/routes/match/components/board.component.ts src/app/routes/match/components/board.component.spec.ts src/app/core/match/selection.service.ts src/app/routes/match/components/prompt-overlay.component.ts
git commit -s -m "feat(board): on-board blocker pairing with live arrows"
```

---

### Task 8: Edge cases — reset, illegal-drop, decline

**Files:**
- Modify: `src/app/core/match/selection.service.ts`
- Test: extend `selection.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('drops a selected id that is no longer a candidate when the prompt updates', () => {
  svc.setBoardInstanceIds(new Set(['a', 'b']));
  svc.setPrompt(prompt({ expectedKinds: ['ChooseTargetsCommand'], candidates: [{ instanceId: 'a' } as any, { instanceId: 'b' } as any] }));
  svc.toggle('a');
  // re-prompt without 'a' as a candidate → selection reset (already covered) ;
  svc.setPrompt(prompt({ expectedKinds: ['ChooseTargetsCommand'], candidates: [{ instanceId: 'b' } as any] }));
  expect(svc.selected()).toEqual([]);
});

it('treats an optional (min 0) choice as declinable with an empty set', () => {
  svc.setBoardInstanceIds(new Set(['a']));
  svc.setPrompt(prompt({ expectedKinds: ['ChoiceCommand'], candidates: [{ instanceId: 'a' } as any], choiceView: { kind: 'PickN', min: 0, max: 1 } }));
  const m = svc.mode();
  expect(m?.min).toBe(0);
  expect(svc.selected()).toEqual([]); // Done at 0 = decline
});
```

- [ ] **Step 2: Run, verify pass/fail.** The reset is already implemented (Task 2). The min=0 case should pass with Task 2 bounds. Run:

Run: `npx ng test --no-watch --include='**/selection.service.spec.ts'`
Expected: both PASS (if so, this task only adds coverage). If the min=0 case fails because `bounds` ignores `choiceView`, fix `bounds` to honor `choiceView` for `choice`.

- [ ] **Step 3: Confirm decline wiring.** Ensure the overlay banner `Done` is enabled when `selected.length >= min` (so min=0 → enabled at 0) — already specified in Task 5. No code change if green.

- [ ] **Step 4: Commit**

```bash
git add src/app/core/match/selection.service.ts src/app/core/match/selection.service.spec.ts
git commit -s -m "test(match): selection reset + optional-decline edge cases"
```

---

### Task 9: Full suite + build + lint

- [ ] **Step 1: Run the full unit suite**

Run: `npx ng test --no-watch`
Expected: all green (existing + new specs).

- [ ] **Step 2: Production build / typecheck**

Run: `npm run build`
Expected: success (pre-existing bundle-budget warning is acceptable).

- [ ] **Step 3: Manual smoke (optional, if a dev server is available).** Activate Yawgmoth: the board dims non-creatures, highlights your other creatures; clicking one auto-submits the sacrifice; then the target prompt highlights creatures for the −1/−1 counter; Done/Decline works. Declare attackers/blockers by clicking on the board.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin HEAD
gh pr create --repo bg9m9r/majik.portal --title "feat(match): on-board click-to-select for targets, choices, attackers, blockers" \
  --body "Implements docs/superpowers/specs/2026-06-16-board-click-to-select-design.md. Click objects on the board to choose; legal objects highlighted, illegal dimmed. No server/contract change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr merge --repo bg9m9r/majik.portal --squash --auto
```

---

## Self-review

- **Spec coverage:** selection mode (T1/T2), highlight+dim affordance (T3), click+auto-submit fixed (T4), slim banner + grid suppression + cancel (T5), attackers (T6), blockers (T7), reset/optional-decline edge cases (T8), full verify (T9). Off-board modal fallback = mode()→null path (T2). Player-as-target non-goal: not implemented (documented). All spec sections covered.
- **No duplicated selection state:** `SelectionService` is the single owner (selected set + combat pairs); board handles clicks, overlay banner handles Done/Confirm/Cancel — both read the service. T6/T7 explicitly move combat pairs into the service.
- **Type consistency:** decision field names (`targetInstanceIds`, `selectedInstanceIds`+choice kind, `attackers`, `blockers:[{blockerInstanceId,attackerInstanceId}]`) MUST be reconciled against `match.ts translateDecision` during T5–T7; the plan flags every spot to verify rather than guessing. `mode()` return type reused via `ReturnType<SelectionService['mode']>`.
- **jsdom/test gotchas:** asserted CSS in card-view `styles[]`; `ng test --no-watch`; no backticks-in-template hazards introduced.
- **Open verification items the implementer MUST check against real code (flagged inline):** exact `PromptDecision` choice field name; exact blockers decision element shape; which template element carries the card frame for the affordance attributes; whether `choiceView` already has min/max.
