import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CardSnapshot, GameState, GamePlayer } from '../../../core/match/match.types';

interface PromptInfo {
  expectedKinds?: string[];
  playerId?: string;
  description?: string;
}

export type PromptKind = 'targets' | 'mulligan' | 'x' | 'mode' | 'bottom' | 'attackers' | 'blockers' | 'none';

export interface PromptDecision {
  kind: PromptKind;
  targetInstanceIds?: string[];
  cardInstanceIds?: string[];
  keep?: boolean;
  x?: number;
  modeIndex?: number;
  attackers?: { attackerInstanceId: string; defenderId: string }[];
  blockers?: { attackerInstanceId: string; blockerInstanceId: string }[];
}

interface CandidateCard {
  card: CardSnapshot;
  zone: 'battlefield' | 'hand';
  controllerName: string;
}

export function detectKind(kinds: string[] | undefined): PromptKind {
  const ks = (kinds ?? []).map(k => k.toLowerCase());
  if (ks.some(k => k.includes('attacker'))) return 'attackers';
  if (ks.some(k => k.includes('blocker'))) return 'blockers';
  if (ks.some(k => k.includes('target'))) return 'targets';
  if (ks.some(k => k.includes('mulligan'))) return 'mulligan';
  if (ks.some(k => k === 'bottom' || k.includes('bottom'))) return 'bottom';
  if (ks.some(k => k === 'x' || k.includes('xcommand') || k.includes('choose-x'))) return 'x';
  if (ks.some(k => k === 'mode' || k.includes('mode'))) return 'mode';
  return 'none';
}

@Component({
  selector: 'app-prompt-overlay',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (kind() !== 'none') {
      <div
        #overlayRoot
        class="prompt-overlay fixed inset-x-0 top-0 z-50 mx-auto mt-3 max-w-3xl rounded bg-black/80 p-3 shadow-xl"
        [attr.data-kind]="kind()"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="titleFor(kind())"
        (keydown)="onOverlayKeydown($event)">
        <div class="mb-2 flex items-center justify-between">
          <div>
            <h3 class="prompt-overlay__title text-sm font-semibold">{{ titleFor(kind()) }}</h3>
            @if (prompt()?.description; as d) {
              <p class="text-xs opacity-70">{{ d }}</p>
            }
          </div>
          @if (kind() !== 'mulligan') {
            <!-- CR 103.4: mulligan has no opt-out — every player must answer keep-or-mulligan. -->
            <button
              type="button"
              class="rounded border border-white/20 px-2 py-0.5 text-xs hover:bg-white/10"
              (click)="onCancel()">
              Cancel
            </button>
          }
        </div>

        @switch (kind()) {
          @case ('targets') {
            <div class="flex items-center justify-between text-xs">
              <span class="opacity-70">{{ selected().length }} selected</span>
              <button
                type="button"
                class="rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10"
                [disabled]="selected().length === 0"
                (click)="confirmTargets()">
                Confirm
              </button>
            </div>
            <div class="mt-2 grid grid-cols-3 gap-2 text-xs">
              @for (cand of candidates(); track cand.card.instanceId) {
                <button
                  type="button"
                  class="flex items-start justify-between rounded border px-2 py-1 text-left"
                  [class.border-amber-400]="isSelected(cand.card.instanceId)"
                  [class.bg-amber-400/10]="isSelected(cand.card.instanceId)"
                  [class.border-white/15]="!isSelected(cand.card.instanceId)"
                  (click)="toggle(cand.card.instanceId)">
                  <span>
                    <span class="font-medium">{{ cand.card.name }}</span>
                    <span class="ml-1 opacity-50">({{ cand.zone }})</span>
                  </span>
                  <span class="opacity-60">{{ cand.controllerName }}</span>
                </button>
              } @empty {
                <p class="col-span-3 opacity-50">No candidates in play.</p>
              }
            </div>
          }

          @case ('mulligan') {
            <div class="flex items-center gap-3 text-xs">
              <button
                type="button"
                class="rounded border border-emerald-400 px-3 py-1 text-emerald-300 hover:bg-emerald-400/10"
                (click)="decision.emit({ kind: 'mulligan', keep: true })">
                Keep
              </button>
              <button
                type="button"
                class="rounded border border-red-400 px-3 py-1 text-red-300 hover:bg-red-400/10"
                (click)="decision.emit({ kind: 'mulligan', keep: false })">
                Mulligan
              </button>
            </div>
          }

          @case ('x') {
            <form class="flex items-center gap-2 text-xs" (submit)="confirmX($event)">
              <label class="flex items-center gap-2">
                <span class="opacity-70">X =</span>
                <input
                  type="number"
                  class="w-20 rounded border border-white/15 bg-black/30 px-2 py-1 outline-none focus:border-amber-400"
                  min="0"
                  [(ngModel)]="xValue"
                  name="x" />
              </label>
              <button
                type="submit"
                class="rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10">
                Confirm
              </button>
            </form>
          }

          @case ('mode') {
            <div class="flex items-center gap-2 text-xs">
              @for (i of modeOptions; track i) {
                <button
                  type="button"
                  class="rounded border border-white/15 px-3 py-1 hover:bg-white/10"
                  (click)="decision.emit({ kind: 'mode', modeIndex: i })">
                  Mode {{ i }}
                </button>
              }
            </div>
          }

          @case ('attackers') {
            <div class="flex flex-col gap-2 text-xs">
              <span class="opacity-70">Pick creatures to attack {{ opponent()?.name ?? 'opponent' }} ({{ selected().length }} selected).</span>
              <div class="grid grid-cols-3 gap-2">
                @for (c of selfCreatures(); track c.instanceId) {
                  <button
                    type="button"
                    class="rounded border px-2 py-1 text-left"
                    [class.border-amber-400]="isSelected(c.instanceId)"
                    [class.bg-amber-400/10]="isSelected(c.instanceId)"
                    [class.border-white/15]="!isSelected(c.instanceId)"
                    [disabled]="c.tapped || c.summoningSickness"
                    (click)="toggle(c.instanceId)">
                    {{ c.name }}
                    @if (c.tapped) { <span class="opacity-50"> (tapped)</span> }
                    @if (c.summoningSickness) { <span class="opacity-50"> (sick)</span> }
                  </button>
                } @empty {
                  <span class="col-span-3 opacity-50">No creatures.</span>
                }
              </div>
              <button
                type="button"
                class="self-start rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10"
                (click)="confirmAttackers()">
                Confirm attackers (or skip with none)
              </button>
            </div>
          }

          @case ('blockers') {
            <div class="flex flex-col gap-2 text-xs">
              <span class="opacity-70">
                Assign blockers to attackers. Each blocker can block at most one attacker; an attacker may be blocked by multiple blockers (CR 509.1).
              </span>
              @if (attackerList().length > 0 && eligibleBlockers().length > 0) {
                <div class="overflow-x-auto">
                  <table class="min-w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th class="border-b border-white/10 px-2 py-1 text-left font-medium opacity-70">Attacker \\ Blocker</th>
                        @for (b of eligibleBlockers(); track b.instanceId) {
                          <th class="border-b border-white/10 px-2 py-1 text-center font-medium">{{ b.name }}</th>
                        }
                      </tr>
                    </thead>
                    <tbody>
                      @for (atk of attackerList(); track atk.instanceId) {
                        <tr>
                          <td class="border-b border-white/5 px-2 py-1 font-medium">{{ atk.name }}</td>
                          @for (b of eligibleBlockers(); track b.instanceId) {
                            <td class="border-b border-white/5 px-2 py-1 text-center">
                              <input
                                type="checkbox"
                                [attr.aria-label]="'Assign ' + b.name + ' to block ' + atk.name"
                                [checked]="isAssigned(b.instanceId, atk.instanceId)"
                                (change)="toggleBlockerAssignment(b.instanceId, atk.instanceId)" />
                            </td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else if (attackerList().length === 0) {
                <span class="opacity-50">No attackers.</span>
              } @else {
                <span class="opacity-50">No eligible blockers.</span>
              }
              <button
                type="button"
                class="self-start rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10"
                (click)="confirmBlockers()">
                Confirm blocks
              </button>
            </div>
          }

          @case ('bottom') {
            <div class="flex flex-col gap-2 text-xs">
              <span class="opacity-70">Click cards to bottom them ({{ selected().length }} selected).</span>
              <div class="grid grid-cols-3 gap-2">
                @for (c of selfHand(); track c.instanceId) {
                  <button
                    type="button"
                    class="rounded border px-2 py-1 text-left"
                    [class.border-amber-400]="isSelected(c.instanceId)"
                    [class.bg-amber-400/10]="isSelected(c.instanceId)"
                    [class.border-white/15]="!isSelected(c.instanceId)"
                    (click)="toggle(c.instanceId)">
                    {{ c.name }}
                  </button>
                } @empty {
                  <span class="col-span-3 opacity-50">Hand empty.</span>
                }
              </div>
              <button
                type="button"
                class="self-start rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10"
                (click)="confirmBottom()">
                Confirm bottoming
              </button>
            </div>
          }
        }
      </div>
    }
  `
})
export class PromptOverlayComponent implements AfterViewInit, OnDestroy {
  readonly state = input<GameState | null>(null);
  readonly prompt = input<PromptInfo | null>(null);
  readonly selfPlayerIds = input<string[]>([]);

  readonly decision = output<PromptDecision>();
  readonly cancel = output<void>();

  // Emit in-progress assignment state so the board can overlay SVG
  // combat lines on top of the battlefield. Keys mirror the wire DTO
  // for DeclareAttackers / DeclareBlockers — the board reads them
  // directly without translating.
  readonly assignmentsChanged = output<{
    kind: 'attackers' | 'blockers';
    attackers?: { attackerInstanceId: string; defenderId: string }[];
    blockers?: { attackerInstanceId: string; blockerInstanceId: string }[];
  }>();

  // Element that had focus before the overlay opened — we hand it back
  // on dismiss so a keyboard user lands where they were (typically the
  // action-bar "Pass priority" button or a card-view tile).
  @ViewChild('overlayRoot') private overlayRoot?: ElementRef<HTMLElement>;
  private previousActiveElement: HTMLElement | null = null;

  // Confirm-on-Enter is implemented at the overlay level so it works
  // regardless of which focusable element happens to be active.
  readonly confirmRequested = signal(0);

  readonly selected = signal<string[]>([]);
  readonly modeOptions = [0, 1, 2, 3] as const;
  // Maps blockerInstanceId -> attackerInstanceId. Each blocker can be
  // assigned to at most one attacker (UI enforces). Multiple blockers
  // may share an attacker — that's what CR 509.1 allows.
  readonly blockerAssignments = signal<Record<string, string>>({});
  xValue = 0;

  readonly kind = computed<PromptKind>(() => detectKind(this.prompt()?.expectedKinds));

  readonly self = computed<GamePlayer | null>(() => {
    const s = this.state();
    if (!s) return null;
    const owned = this.selfPlayerIds();
    return s.players.find(p => owned.includes(p.id)) ?? null;
  });

  readonly selfHand = computed<CardSnapshot[]>(() => this.self()?.hand.cards ?? []);

  readonly opponent = computed<GamePlayer | null>(() => {
    const s = this.state();
    if (!s) return null;
    const me = this.self();
    return s.players.find(p => p.id !== me?.id) ?? null;
  });

  readonly selfCreatures = computed<CardSnapshot[]>(() =>
    (this.self()?.battlefield.cards ?? []).filter(c =>
      (c.types ?? []).some(t => t.toLowerCase().includes('creature'))
    )
  );

  // Subset of selfCreatures that can legally block (untapped). Used as
  // columns in the blockers grid.
  readonly eligibleBlockers = computed<CardSnapshot[]>(() =>
    this.selfCreatures().filter(c => !c.tapped)
  );

  readonly attackerList = computed<CardSnapshot[]>(() =>
    (this.opponent()?.battlefield.cards ?? []).filter(c => c.tapped &&
      (c.types ?? []).some(t => t.toLowerCase().includes('creature'))
    )
  );

  readonly candidates = computed<CandidateCard[]>(() => {
    const s = this.state();
    if (!s) return [];
    const out: CandidateCard[] = [];
    for (const player of s.players) {
      for (const c of player.battlefield.cards) {
        out.push({ card: c, zone: 'battlefield', controllerName: player.name });
      }
    }
    return out;
  });

  titleFor(k: PromptKind): string {
    switch (k) {
      case 'targets': return 'Choose targets';
      case 'mulligan': return 'Mulligan?';
      case 'x': return 'Choose X';
      case 'mode': return 'Choose mode';
      case 'bottom': return 'Bottom cards';
      case 'attackers': return 'Declare attackers';
      case 'blockers': return 'Declare blockers';
      default: return '';
    }
  }

  isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  toggle(id: string): void {
    const cur = this.selected();
    this.selected.set(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
    // For attackers, re-emit live assignment state so the board's SVG
    // combat overlay can draw the arrows immediately.
    if (this.kind() === 'attackers') this.emitAssignmentsForKind();
  }

  confirmTargets(): void {
    this.decision.emit({ kind: 'targets', targetInstanceIds: this.selected() });
    this.selected.set([]);
  }

  confirmBottom(): void {
    this.decision.emit({ kind: 'bottom', cardInstanceIds: this.selected() });
    this.selected.set([]);
  }

  confirmX(evt: Event): void {
    evt.preventDefault();
    this.decision.emit({ kind: 'x', x: Number(this.xValue) || 0 });
  }

  confirmAttackers(): void {
    const opp = this.opponent();
    const defenderId = opp?.id ?? '';
    const attackers = this.selected().map(id => ({ attackerInstanceId: id, defenderId }));
    this.decision.emit({ kind: 'attackers', attackers });
    this.selected.set([]);
  }

  // Compose the live attackers list for the SVG overlay. Reads
  // selected() + the opponent's id, same as confirmAttackers but
  // without resetting selection.
  private currentAttackerAssignments(): { attackerInstanceId: string; defenderId: string }[] {
    const defenderId = this.opponent()?.id ?? '';
    return this.selected().map(id => ({ attackerInstanceId: id, defenderId }));
  }

  private emitAssignmentsForKind(): void {
    const k = this.kind();
    if (k === 'attackers') {
      this.assignmentsChanged.emit({ kind: 'attackers', attackers: this.currentAttackerAssignments() });
    } else if (k === 'blockers') {
      const blockers = Object.entries(this.blockerAssignments()).map(
        ([blockerInstanceId, attackerInstanceId]) => ({ attackerInstanceId, blockerInstanceId })
      );
      this.assignmentsChanged.emit({ kind: 'blockers', blockers });
    }
  }

  isAssigned(blockerId: string, attackerId: string): boolean {
    return this.blockerAssignments()[blockerId] === attackerId;
  }

  // Toggle a blocker -> attacker assignment. Selecting a blocker for a
  // new attacker implicitly clears any prior assignment for that
  // blocker (a creature can only block one attacker per CR 509.1).
  // Clicking the same cell again clears the assignment ("no block").
  toggleBlockerAssignment(blockerId: string, attackerId: string): void {
    const map = { ...this.blockerAssignments() };
    if (map[blockerId] === attackerId) {
      delete map[blockerId];
    } else {
      map[blockerId] = attackerId;
    }
    this.blockerAssignments.set(map);
    if (this.kind() === 'blockers') this.emitAssignmentsForKind();
  }

  confirmBlockers(): void {
    // Multiple blockers can map to the same attacker — that's the whole
    // point of this UI. Server accepts the resulting list as-is; CR 509.2
    // ordering will be a follow-up.
    const blockers = Object.entries(this.blockerAssignments()).map(
      ([blockerInstanceId, attackerInstanceId]) => ({ attackerInstanceId, blockerInstanceId })
    );
    this.decision.emit({ kind: 'blockers', blockers });
    this.blockerAssignments.set({});
  }

  onCancel(): void {
    this.selected.set([]);
    this.cancel.emit();
  }

  // -----------------------------------------------------------------
  // Focus management — capture the previously-focused element when the
  // overlay opens, push focus to the first focusable child, and trap
  // Tab cycles within the overlay. On unmount we restore focus to the
  // element that had it pre-open.
  // -----------------------------------------------------------------

  ngAfterViewInit(): void {
    // Remember where focus was so we can restore it on close.
    const active = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    this.previousActiveElement = active && active !== document.body ? active : null;
    // Move focus into the overlay after Angular renders the kind-specific
    // body. A single rAF defer is enough to clear the change-detection
    // cycle that created the inner @switch contents.
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => this.focusFirstFocusable());
    } else {
      this.focusFirstFocusable();
    }
  }

  ngOnDestroy(): void {
    // Best-effort focus return — if the prior element is gone (e.g. it
    // was removed during the prompt), drop back to body silently.
    const prev = this.previousActiveElement;
    if (prev && typeof prev.focus === 'function' && document.body.contains(prev)) {
      try { prev.focus(); } catch { /* swallow — non-fatal */ }
    }
    this.previousActiveElement = null;
  }

  /** Focuses the first focusable element inside the overlay root. */
  focusFirstFocusable(): void {
    const root = this.overlayRoot?.nativeElement;
    if (!root) return;
    const items = this.focusableChildren(root);
    if (items.length > 0) {
      try { items[0].focus(); } catch { /* swallow */ }
    }
  }

  /** Keydown handler on the overlay root — handles Tab trap + Enter. */
  onOverlayKeydown(evt: KeyboardEvent): void {
    if (evt.key === 'Enter') {
      // Forward Enter as "confirm primary" only when:
      //   * the user is on the dialog surface (not inside an input/textarea/select);
      //   * the kind has a confirmable selection state.
      const target = evt.target as HTMLElement | null;
      if (target && this.isFormField(target)) return;
      if (this.tryConfirmPrimary()) {
        evt.preventDefault();
      }
      return;
    }
    if (evt.key !== 'Tab') return;
    const root = this.overlayRoot?.nativeElement;
    if (!root) return;
    const items = this.focusableChildren(root);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (evt.shiftKey) {
      if (active === first || !root.contains(active)) {
        last.focus();
        evt.preventDefault();
      }
    } else {
      if (active === last) {
        first.focus();
        evt.preventDefault();
      }
    }
  }

  /**
   * Confirm the primary action for the current prompt if eligible. Returns
   * true when an action was emitted. Used by the Enter binding (overlay
   * keydown) and the match-page `Enter` host shortcut.
   */
  tryConfirmPrimary(): boolean {
    switch (this.kind()) {
      case 'targets':
        if (this.selected().length === 0) return false;
        this.confirmTargets();
        return true;
      case 'attackers':
        // Empty selection is a valid "skip combat" choice (CR 508.2)
        this.confirmAttackers();
        return true;
      case 'blockers':
        this.confirmBlockers();
        return true;
      case 'bottom':
        if (this.selected().length === 0) return false;
        this.confirmBottom();
        return true;
      default:
        return false;
    }
  }

  private isFormField(el: HTMLElement): boolean {
    return el instanceof HTMLInputElement
      || el instanceof HTMLTextAreaElement
      || el instanceof HTMLSelectElement;
  }

  private focusableChildren(root: HTMLElement): HTMLElement[] {
    const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(sel));
    return nodes.filter(n => !n.hasAttribute('disabled') && !n.getAttribute('aria-hidden'));
  }
}
