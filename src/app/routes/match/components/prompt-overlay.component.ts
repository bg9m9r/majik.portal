import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ViewportService } from '../../../core/ui/viewport.service';
import { FormsModule } from '@angular/forms';
import { CardSnapshot, GameState, GamePlayer, SelectionMode } from '../../../core/match/match.types';
import { SelectionService } from '../../../core/match/selection.service';
import { CardTileComponent } from '../../../ui/card-tile.component';

interface PromptInfo {
  expectedKinds?: string[];
  playerId?: string;
  description?: string;
  // CR 701.19a — library-search prompts ship the engine-pre-filtered
  // candidate list + a human-readable predicate label here. The
  // overlay reads them straight off the envelope to render a picker;
  // the library is otherwise hidden in GameState under CR 706.
  candidates?: CardSnapshot[];
  label?: string;
  // Full library snapshot (top-to-bottom order). Present only when the
  // companion core PR has deployed. When absent, the overlay falls back
  // to the flat candidates list — no breakage during the transient
  // deploy window between portal deploy and core deploy.
  libraryView?: CardSnapshot[];
  // CR 701.42 — surveil prompts ship the peeked top-N (top-to-bottom)
  // here. The overlay renders each card with two buttons ("graveyard"
  // / "keep on top") and assembles a ChooseSurveilCommand partition.
  // Privacy: per-recipient SignalR routing (same as libraryView).
  surveilView?: CardSnapshot[];
  // CR 701.20 — scry prompts ship the peeked top-N (top-to-bottom) here.
  // Surveil's near-twin: the overlay renders each card with two buttons
  // ("to bottom" / "keep on top") and assembles a ChooseScryCommand
  // partition. The only difference from surveil is the non-kept cards go
  // to the BOTTOM of the library (CR 701.20a) instead of the graveyard.
  // Privacy: per-recipient SignalR routing (same as surveilView).
  scryView?: CardSnapshot[];
  // CR 117.x / 605.1 — Yes/No "may" prompts (shock-land "pay 2 life?"
  // is the current caller). Carries the question text + optional
  // source-card label so the modal can be titled by the triggering
  // permanent. Yes/No labels default to "Yes" / "No" when the engine
  // doesn't override.
  yesNoView?: {
    question: string;
    yesLabel?: string;
    noLabel?: string;
    sourceCardName?: string | null;
  };
  // CR 701.15 — reveal-and-choose prompts (Malevolent Rumble, Impulse,
  // Sleight of Hand, See the Unwritten, …). Ships the FULL revealed
  // pile (so the portal modal can show every card) plus the engine-
  // filtered eligible InstanceIds (highlighted + clickable). Optional
  // flag toggles the Decline button. Privacy: per-recipient SignalR
  // routing (same as libraryView / surveilView).
  revealView?: {
    revealed: CardSnapshot[];
    eligibleInstanceIds: string[];
    optional: boolean;
    label: string;
  };
  // London mulligan — number of cards the player must put on the bottom
  // (= mulligans taken). Drives the "Bottom N card(s)" label and gates the
  // confirm button to exactly N selected. Absent on every other prompt.
  bottomCount?: number;
  // CR 700.6 / 701.x — generic declarative-choice descriptor (Yawgmoth's
  // "Sacrifice another creature" cost, Grist, MDFC/Gift/Sungold Sentinel,
  // Suppression Ray, Serra's Emissary, …). Non-null ONLY on the generic
  // ChoiceCommand prompt; the pickable cards ride on `candidates`. `kind`
  // is the ChoiceKind enum name ("PickOne" / "PickN") echoed back verbatim
  // in the ChoiceCommand response; the overlay enforces the min..max
  // selection bounds. Without it the player wedged holding priority
  // awaiting a ChoiceCommand the UI never rendered (core PR #2959).
  choiceView?: {
    kind: string;
    min: number;
    max: number;
  };
}

export type PromptKind =
  | 'targets'
  | 'mulligan'
  | 'x'
  | 'mode'
  | 'bottom'
  | 'attackers'
  | 'blockers'
  | 'mana'
  | 'mana-cancel'
  | 'libraryPick'
  | 'surveil'
  | 'scry'
  | 'yesNo'
  | 'revealPick'
  | 'choice'
  | 'none';

export interface PromptDecision {
  kind: PromptKind;
  targetInstanceIds?: string[];
  cardInstanceIds?: string[];
  keep?: boolean;
  x?: number;
  modeIndex?: number;
  attackers?: { attackerInstanceId: string; defenderId: string }[];
  blockers?: { attackerInstanceId: string; blockerInstanceId: string }[];
  sourceInstanceIds?: string[];
  // CR 701.19a — id of the picked candidate, or `null` for the legal
  // "find nothing" branch (the player may decline to choose).
  selectedInstanceId?: string | null;
  // CR 701.42 — partition of the peeked top-N into graveyard-bound and
  // top-bound buckets. topOrderInstanceIds order is honoured: index 0
  // becomes the new top of the library. Together they must cover the
  // peeked set exactly once (server validates).
  toGraveyardInstanceIds?: string[];
  topOrderInstanceIds?: string[];
  // CR 701.20 — partition of the peeked top-N for a scry prompt into
  // bottom-bound and top-bound buckets. Surveil's near-twin: the only
  // difference is the non-kept cards go to the BOTTOM of the library
  // rather than the graveyard. topOrderInstanceIds is shared with surveil
  // (index 0 becomes the new top); toBottomInstanceIds is the scry-only
  // bucket. Together they must cover the peeked set exactly once (server
  // validates).
  toBottomInstanceIds?: string[];
  // CR 117.x / 605.1 — bool answer for an optional "may" prompt
  // (shock-land "pay 2 life?", future painlands / slowlands, etc.).
  answer?: boolean;
  // CR 701.15 — id of the picked eligible card on a reveal-and-choose
  // prompt, or `null` to decline (only legal when revealView.optional
  // is true OR no eligible cards exist).
  pickedInstanceId?: string | null;
  // CR 700.6 / 701.x — generic declarative-choice response. `choiceKind`
  // echoes the prompt's choiceView.kind back verbatim (the engine resolves
  // the picks against it); `selectedInstanceIds` are the picked candidate
  // ids (1 for PickOne, min..max for PickN).
  choiceKind?: string;
  selectedInstanceIds?: string[];
}

interface CandidateCard {
  card: CardSnapshot;
  zone: 'battlefield' | 'hand';
  controllerName: string;
}

// CR 701.19a — a presentational grouping of library cards by name. The
// library can hold many duplicates (3× Verdant Catacombs); rather than one
// tile per instance, the picker renders ONE art tile per unique name with a
// count badge. `instanceIds` holds every instance of that name in first-
// appearance order; `eligibleInstanceId` is the first eligible instance to
// select on click (null when the whole stack is ineligible/muted). Grouping
// is purely visual — the emitted wire pick is still a single instanceId.
interface LibraryStack {
  name: string;
  count: number;
  instanceIds: string[];
  eligible: boolean;
  eligibleInstanceId: string | null;
}

export function detectKind(kinds: string[] | undefined): PromptKind {
  const ks = (kinds ?? []).map(k => k.toLowerCase());
  // CR 701.19a — match BEFORE 'targets' / 'mode' / 'mulligan' so the
  // server's literal "ChooseLibraryPickCommand" envelope routes to the
  // dedicated library-search picker rather than the generic targets
  // grid (which only reads from the battlefield + can't see the
  // candidates).
  if (ks.some(k => k.includes('libraryp') || k.includes('library-pick') || k.includes('chooselibrary'))) return 'libraryPick';
  // CR 701.42 — match BEFORE 'targets' / 'mode' for the same reason as
  // libraryPick: the server's literal "ChooseSurveilCommand" envelope
  // must route to the surveil modal, not the generic targets grid.
  if (ks.some(k => k.includes('surveil') || k.includes('choosesurveil'))) return 'surveil';
  // CR 701.20 — match BEFORE 'targets' / 'mode' (and AFTER surveil so the
  // distinct envelopes never alias): the server's literal
  // "ChooseScryCommand" envelope must route to the scry modal, not the
  // generic targets grid. Scry is surveil's near-twin (top vs bottom
  // instead of top vs graveyard).
  if (ks.some(k => k.includes('scry') || k.includes('choosescry'))) return 'scry';
  // CR 117.x / 605.1 — Yes/No modal. The server ships the literal
  // "ChooseYesNoCommand" envelope (or the shorter "chooseYesNo"
  // discriminator if normalised); both must route to the dedicated
  // yes/no modal rather than fall through to a generic catch-all.
  if (ks.some(k => k.includes('yesno') || k.includes('chooseyesno'))) return 'yesNo';
  // CR 701.15 — reveal-and-choose modal (Malevolent Rumble, Impulse,
  // Sleight of Hand, See the Unwritten, …). Match BEFORE the generic
  // 'targets' fallback so the server's literal "ChooseFromRevealedCommand"
  // envelope routes to the dedicated reveal modal instead of being
  // mis-detected as a targets prompt (the revealed cards aren't on the
  // battlefield — the generic targets grid couldn't see them).
  if (ks.some(k => k.includes('fromrevealed') || k.includes('choosefromrevealed') || k.includes('reveal-pick'))) return 'revealPick';
  if (ks.some(k => k.includes('attacker'))) return 'attackers';
  if (ks.some(k => k.includes('blocker'))) return 'blockers';
  if (ks.some(k => k.includes('target'))) return 'targets';
  if (ks.some(k => k.includes('mulligan'))) return 'mulligan';
  if (ks.some(k => k === 'bottom' || k.includes('bottom'))) return 'bottom';
  if (ks.some(k => k === 'x' || k.includes('xcommand') || k.includes('choose-x'))) return 'x';
  // Match before 'mode' since 'choosemodecommand' would otherwise win.
  if (ks.some(k => k === 'mana' || k.includes('choosemanacommand') || k.includes('choose-mana'))) return 'mana';
  if (ks.some(k => k === 'mode' || k.includes('mode'))) return 'mode';
  // CR 700.6 / 701.x — generic declarative-choice catch (Yawgmoth's
  // "Sacrifice another creature" cost, Grist, MDFC/Gift/Sungold Sentinel,
  // Suppression Ray, Serra's Emissary, …). This MUST come LAST among the
  // command-type branches: a more specific command (ChooseYesNoCommand,
  // ChooseLibraryPickCommand, ChooseSurveilCommand, ChooseFromRevealedCommand,
  // targets/attackers/blockers/mode/mana/…) always wins. The generic
  // ChoiceCommand is the fall-through for PickOne/PickN choices that have
  // no dedicated UI of their own — without it the player wedged holding
  // priority (core PR #2959).
  if (ks.some(k => k.includes('choicecommand') || k === 'choice')) return 'choice';
  return 'none';
}

@Component({
  selector: 'app-prompt-overlay',
  standalone: true,
  imports: [FormsModule, CardTileComponent],
  styles: [`
    // Mobile bottom-sheet: full-width, anchored to the bottom edge; board stays visible above.
    .prompt-sheet {
      inset-inline: 0;
      bottom: 0;
      border-top-left-radius: 12px;
      border-top-right-radius: 12px;
      max-height: 60vh;
      overflow-y: auto;
    }
  `],
  template: `
    @if (kind() !== 'none') {
      <div
        #overlayRoot
        class="prompt-overlay fixed z-50 bg-black/80 p-3 shadow-xl"
        [class.prompt-sheet]="sheetMode()"
        [class.inset-x-0]="!sheetMode()"
        [class.top-0]="!sheetMode()"
        [class.mx-auto]="!sheetMode()"
        [class.mt-3]="!sheetMode()"
        [class.max-w-3xl]="!sheetMode()"
        [class.rounded]="!sheetMode()"
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
          @if (showCancelButton()) {
            <!--
              CR 601.2 — the user may abort a spell cast at any point
              before the announcement is fully resolved (target picker,
              mode picker, X picker, mana payment). Once the spell hits
              the stack, the cast is locked in.

              Cancel is hidden for every other prompt kind: there is no
              take-back for a triggered library-pick after a tutor
              resolves, no opt-out from mulligan (CR 103.4), no "skip"
              for combat declarations (the player chooses NO attackers
              by confirming an empty set), no escape from a yes/no
              "may" prompt the engine is waiting on. Hiding the button
              prevents accidental clicks that produced an unrecoverable
              UX state in v1.
            -->
            <button
              type="button"
              class="rounded border border-white/20 px-2 py-0.5 text-xs hover:bg-white/10"
              (click)="onCancel()">
              Cancel
            </button>
          }
        </div>

        @if (boardMode(); as bm) {
          <!--
            On-board click-to-select banner. The board owns the clicks + live
            SVG arrows; this banner is just the instruction + Done/Confirm/
            Cancel control for the four in-scope kinds. The modal grid for
            those kinds is suppressed (see the @if (!boardMode()) wraps below).
          -->
          <div data-banner="board-select" class="flex items-center justify-between gap-3 text-xs">
            <span class="opacity-80">{{ bm.sourceLabel || titleFor(kind()) }}
              — {{ selection.selected().length }}{{ bm.max < 9e15 ? ('/' + bm.max) : '' }} selected</span>
            <span class="flex gap-2">
              @if (bm.kind === 'attackers') {
                <button
                  type="button"
                  class="rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10"
                  (click)="confirmBoardAttackers()">Confirm attackers</button>
              } @else if (bm.kind === 'blockers') {
                <button
                  type="button"
                  class="rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10"
                  (click)="confirmBoardBlockers()">Confirm blocks</button>
              } @else {
                <button
                  type="button"
                  class="rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                  [disabled]="selection.selected().length < bm.min"
                  (click)="confirmBoardSelection(bm)">Done</button>
              }
              @if (bm.cancellable) {
                <button
                  type="button"
                  class="rounded border border-white/20 px-3 py-1 text-white/80 hover:bg-white/10"
                  (click)="onCancel()">Cancel</button>
              }
            </span>
          </div>
        }

        @switch (kind()) {
          @case ('targets') {
            @if (!boardMode()) {
            <div data-grid="targets" class="flex items-center justify-between text-xs">
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
                  class="candidate-tile flex flex-col gap-1 rounded border p-1 text-left"
                  [class.border-amber-400]="isSelected(cand.card.instanceId)"
                  [class.ring-2]="isSelected(cand.card.instanceId)"
                  [class.ring-amber-400]="isSelected(cand.card.instanceId)"
                  [class.bg-amber-400/10]="isSelected(cand.card.instanceId)"
                  [class.border-white/15]="!isSelected(cand.card.instanceId)"
                  [attr.aria-label]="cand.card.name"
                  [attr.aria-pressed]="isSelected(cand.card.instanceId)"
                  (click)="toggle(cand.card.instanceId)">
                  <app-card-tile [name]="cand.card.name" [width]="88" [height]="123" />
                  <span class="candidate-caption flex items-baseline justify-between gap-1 px-0.5 text-[10px]">
                    <span class="opacity-60">({{ cand.zone }})</span>
                    <span class="opacity-50">{{ cand.controllerName }}</span>
                  </span>
                </button>
              } @empty {
                <p class="col-span-3 opacity-50">No candidates in play.</p>
              }
            </div>
            }
          }

          @case ('choice') {
            @if (!boardMode()) {
            <!--
              CR 700.6 / 701.x — generic declarative-choice picker. The
              server ships the pickable cards on candidates and a choiceView
              descriptor { kind, min, max }. Reuses the targets selectable
              grid; Confirm is gated to the [min, max] bounds (PickOne =
              exactly one creature; PickN = min..max). Echoes choiceView.kind
              back in the ChoiceCommand on confirm.
            -->
            <div data-grid="choice" class="flex items-center justify-between text-xs">
              <span class="opacity-70">
                @if (choiceMin() === choiceMax()) {
                  Pick {{ choiceMin() }} ({{ selected().length }} selected)
                } @else {
                  Pick {{ choiceMin() }}–{{ choiceMax() }} ({{ selected().length }} selected)
                }
              </span>
              <button
                type="button"
                class="rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                [disabled]="!canConfirmChoice()"
                (click)="confirmChoice()">
                Confirm
              </button>
            </div>
            <div class="mt-2 grid grid-cols-3 gap-2 text-xs">
              @for (cand of candidates(); track cand.card.instanceId) {
                <button
                  type="button"
                  class="candidate-tile flex flex-col gap-1 rounded border p-1 text-left"
                  [class.border-amber-400]="isSelected(cand.card.instanceId)"
                  [class.ring-2]="isSelected(cand.card.instanceId)"
                  [class.ring-amber-400]="isSelected(cand.card.instanceId)"
                  [class.bg-amber-400/10]="isSelected(cand.card.instanceId)"
                  [class.border-white/15]="!isSelected(cand.card.instanceId)"
                  [attr.aria-label]="cand.card.name"
                  [attr.aria-pressed]="isSelected(cand.card.instanceId)"
                  (click)="toggle(cand.card.instanceId)">
                  <app-card-tile [name]="cand.card.name" [width]="88" [height]="123" />
                  <span class="candidate-caption flex items-baseline justify-between gap-1 px-0.5 text-[10px]">
                    <span class="opacity-60">({{ cand.zone }})</span>
                    <span class="opacity-50">{{ cand.controllerName }}</span>
                  </span>
                </button>
              } @empty {
                <p class="col-span-3 opacity-50">No candidates to choose from.</p>
              }
            </div>
            }
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
            @if (!boardMode()) {
            <div data-grid="attackers" class="flex flex-col gap-2 text-xs">
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
          }

          @case ('blockers') {
            @if (!boardMode()) {
            <div data-grid="blockers" class="flex flex-col gap-2 text-xs">
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
          }

          @case ('mana') {
            <div class="flex flex-col gap-2 text-xs">
              <span class="opacity-70">
                @if (prompt()?.description; as d) {
                  {{ d }}
                } @else {
                  Pay the spell's mana cost. Auto-pay taps untapped basics for any unpaid amount after the floating mana pool is consumed.
                }
              </span>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10"
                  (click)="confirmMana()">
                  Auto-pay
                </button>
                <button
                  type="button"
                  class="rounded border border-red-400 px-3 py-1 text-red-300 hover:bg-red-400/10"
                  (click)="cancelMana()">
                  Cancel cast
                </button>
              </div>
            </div>
          }

          @case ('libraryPick') {
            <!--
              CR 701.19a — library search picker. When the companion core
              PR is deployed, the server ships the FULL library snapshot
              (libraryView) plus the engine-pre-filtered eligible subset
              (candidates). The full-library grid renders all cards with
              eligible cards highlighted and ineligible cards muted.
              When libraryView is absent (older server build or
              non-search prompts), the overlay falls back to the flat
              candidates list — no breakage during the transient deploy
              window between portal and core deploys.
            -->
            <div class="flex flex-col gap-2 text-xs">
              @if (prompt()?.label; as lbl) {
                <span class="opacity-70">Find: {{ lbl }}.</span>
              } @else {
                <span class="opacity-70">Pick a card from your library, or decline.</span>
              }
              <!--
                CR 701.19a — when the engine pre-filtered the candidate
                list down to ZERO eligible cards (a tutor whose stated
                quality nothing in the library satisfies — e.g. Green
                Sun's Zenith into a deck with no green creatures), the
                player has still searched. Show a clear banner so the
                player SEES the failed search instead of wondering why
                the spell did nothing. Companion to the engine-side
                LibrarySearch refactor — prior to that fix the engine
                silently no-op'd and this branch never fired.
              -->
              @if (eligibleInstanceIds().size === 0) {
                <span
                  data-testid="library-pick-empty-banner"
                  class="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-200">
                  No matching cards in your library — search found nothing
                  (CR 701.19a).
                </span>
              }
              <div class="flex items-center gap-2">
                <input
                  type="search"
                  class="flex-1 rounded border border-white/15 bg-black/30 px-2 py-1 outline-none focus:border-amber-400"
                  placeholder="Filter by name…"
                  aria-label="Filter library cards"
                  [ngModel]="libraryPickFilter()"
                  (ngModelChange)="libraryPickFilter.set($event)"
                  name="library-pick-filter" />
                @if (hasLibraryView()) {
                  <span class="opacity-50">eligible: {{ visibleEligibleCount() }} / {{ filteredLibraryView().length }}</span>
                } @else {
                  <span class="opacity-50">{{ filteredLibraryCandidates().length }} / {{ libraryCandidates().length }}</span>
                }
              </div>

              @if (hasLibraryView()) {
                <!--
                  Full-library grid — shows all cards in deck order.
                  Eligible cards (in candidates[]) are full-opacity and
                  clickable; ineligible cards are muted (opacity-30) and
                  not interactive. This mirrors CR 701.19a: the player
                  looks through the entire library and picks an eligible
                  card or declines.
                -->
                <!--
                  Art-tile stacks (CR 701.19a). Duplicate cards are grouped
                  by name into a single art tile with a count badge so a deck
                  with 3× Verdant Catacombs shows ONE tile reading "3" rather
                  than three identical rows. Eligible stacks come first
                  (clickable + selectable), muted (ineligible) stacks after
                  (dimmed, non-interactive). Selection still resolves to a
                  single eligible instanceId of the clicked stack.
                -->
                <div class="max-h-96 overflow-y-auto rounded border border-white/10">
                  <div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2 p-2">
                    @for (stack of eligibleLibraryStacks(); track stack.name) {
                      <button
                        type="button"
                        class="rounded transition-shadow"
                        [class.ring-2]="isLibraryStackSelected(stack)"
                        [class.ring-amber-400]="isLibraryStackSelected(stack)"
                        [attr.data-eligible]="true"
                        [attr.data-stack-name]="stack.name"
                        (click)="selectLibraryCandidate(stack.eligibleInstanceId!)">
                        <app-card-tile [name]="stack.name" [count]="stack.count > 1 ? stack.count : 0" [width]="120" [height]="168" />
                      </button>
                    }
                    @for (stack of mutedLibraryStacks(); track stack.name) {
                      <div
                        class="rounded opacity-30 cursor-not-allowed"
                        [attr.data-muted]="true"
                        [attr.data-stack-name]="stack.name"
                        [attr.tabindex]="-1"
                        title="not eligible">
                        <app-card-tile [name]="stack.name" [count]="stack.count > 1 ? stack.count : 0" [width]="120" [height]="168" />
                      </div>
                    }
                    @if (filteredLibraryView().length === 0) {
                      <p class="col-span-full p-2 opacity-50">No matching cards.</p>
                    }
                  </div>
                </div>
              } @else {
                <!--
                  Fallback: flat candidates list (legacy behaviour).
                  Rendered when libraryView is absent — e.g. before the
                  companion core PR deploys to majik-api.
                -->
                <div class="max-h-96 overflow-y-auto rounded border border-white/10">
                  <div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2 p-2">
                    @for (c of filteredLibraryCandidates(); track c.instanceId) {
                      <button
                        type="button"
                        class="rounded transition-shadow"
                        [class.ring-2]="selectedLibraryInstanceId() === c.instanceId"
                        [class.ring-amber-400]="selectedLibraryInstanceId() === c.instanceId"
                        (click)="selectLibraryCandidate(c.instanceId)">
                        <app-card-tile [name]="c.name" [width]="120" [height]="168" />
                      </button>
                    } @empty {
                      <p class="col-span-full p-2 opacity-50">No matching cards.</p>
                    }
                  </div>
                </div>
              }

              <div class="flex items-center gap-2">
                <!--
                  Empty-candidates branch: "Search and pick" cannot fire
                  (nothing eligible) so we hide it; the only legal action
                  is to acknowledge the failed search. The wire shape is
                  identical to "Pick nothing" — ChooseLibraryPickCommand
                  with SelectedInstanceId = null. CR 701.19a permits a
                  player to find no card whether or not anything matched.
                -->
                @if (eligibleInstanceIds().size === 0) {
                  <button
                    type="button"
                    data-testid="library-pick-acknowledge"
                    class="rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10"
                    (click)="confirmLibraryPickNothing()">
                    OK
                  </button>
                } @else {
                  <button
                    type="button"
                    class="rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                    [disabled]="!selectedLibraryInstanceId()"
                    (click)="confirmLibraryPick()">
                    Search and pick
                  </button>
                  <button
                    type="button"
                    class="rounded border border-white/20 px-3 py-1 text-white/80 hover:bg-white/10"
                    (click)="confirmLibraryPickNothing()">
                    Pick nothing
                  </button>
                }
              </div>
            </div>
          }

          @case ('surveil') {
            <!--
              CR 701.42 — surveil modal. Server peeked the top N of the
              surveilling player's library and shipped them in
              surveilView (top-to-bottom). Each peeked card gets two
              radio-style buttons: "to graveyard" or "keep on top". The
              order they appear in the surveilView is the order the
              cards CURRENTLY sit on top of the library (index 0 = top),
              so the kept-on-top buckets stay in surveilView order for
              the wire payload. Confirm is gated on every card having a
              decision (server validates the partition coverage too).
            -->
            <div class="flex flex-col gap-2 text-xs">
              @if (prompt()?.label; as lbl) {
                <span class="opacity-70">Decide each card: send to graveyard, or keep on top of your library.</span>
              }
              <div class="flex flex-col gap-1">
                @for (c of surveilPeeked(); track c.instanceId; let i = $index) {
                  <div
                    class="flex items-center justify-between rounded border border-white/15 px-2 py-1"
                    [attr.data-surveil-row]="c.instanceId">
                    <span class="flex-1">
                      <span class="opacity-50">#{{ i + 1 }}</span>
                      <span class="ml-2 font-medium">{{ c.name }}</span>
                      <span class="ml-2 opacity-60">{{ c.manaCost }}</span>
                      @if (c.power !== null && c.toughness !== null) {
                        <span class="ml-2 opacity-70">{{ c.power }}/{{ c.toughness }}</span>
                      }
                    </span>
                    <span class="flex items-center gap-1">
                      <button
                        type="button"
                        class="rounded border px-2 py-0.5"
                        [class.border-red-400]="surveilDecisions()[c.instanceId] === 'graveyard'"
                        [class.bg-red-400/10]="surveilDecisions()[c.instanceId] === 'graveyard'"
                        [class.text-red-300]="surveilDecisions()[c.instanceId] === 'graveyard'"
                        [class.border-white/15]="surveilDecisions()[c.instanceId] !== 'graveyard'"
                        [attr.data-surveil-action]="'graveyard'"
                        (click)="setSurveilDecision(c.instanceId, 'graveyard')">
                        To graveyard
                      </button>
                      <button
                        type="button"
                        class="rounded border px-2 py-0.5"
                        [class.border-emerald-400]="surveilDecisions()[c.instanceId] === 'top'"
                        [class.bg-emerald-400/10]="surveilDecisions()[c.instanceId] === 'top'"
                        [class.text-emerald-300]="surveilDecisions()[c.instanceId] === 'top'"
                        [class.border-white/15]="surveilDecisions()[c.instanceId] !== 'top'"
                        [attr.data-surveil-action]="'top'"
                        (click)="setSurveilDecision(c.instanceId, 'top')">
                        Keep on top
                      </button>
                    </span>
                  </div>
                } @empty {
                  <span class="opacity-50">No cards to surveil (library empty).</span>
                }
              </div>
              <div class="flex items-center gap-3">
                <span class="opacity-60">
                  graveyard: {{ surveilToGraveyardCount() }} | top: {{ surveilToTopCount() }} / {{ surveilPeeked().length }}
                </span>
                <button
                  type="button"
                  class="rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                  [disabled]="!surveilReady()"
                  (click)="confirmSurveil()">
                  Confirm surveil
                </button>
              </div>
            </div>
          }

          @case ('scry') {
            <!--
              CR 701.20 — scry modal. Surveil's near-twin. Server peeked
              the top N of the scrying player's library and shipped them in
              scryView (top-to-bottom). Each peeked card gets two radio-
              style buttons: "to bottom" or "keep on top". The order the
              cards appear in scryView is the order they CURRENTLY sit on
              top of the library (index 0 = top); cards kept on top stay in
              that relative order for the wire payload (index 0 of
              topOrderInstanceIds becomes the new top). The only difference
              from surveil is the non-kept bucket goes to the BOTTOM of the
              library (CR 701.20a) rather than the graveyard. Confirm is
              gated on every card having a decision (server validates the
              partition coverage too).
            -->
            <div class="flex flex-col gap-2 text-xs">
              @if (prompt()?.label; as lbl) {
                <span class="opacity-70">Decide each card: put on the bottom of your library, or keep on top.</span>
              }
              <div class="flex flex-col gap-1">
                @for (c of scryPeeked(); track c.instanceId; let i = $index) {
                  <div
                    class="flex items-center justify-between rounded border border-white/15 px-2 py-1"
                    [attr.data-scry-row]="c.instanceId">
                    <span class="flex-1">
                      <span class="opacity-50">#{{ i + 1 }}</span>
                      <span class="ml-2 font-medium">{{ c.name }}</span>
                      <span class="ml-2 opacity-60">{{ c.manaCost }}</span>
                      @if (c.power !== null && c.toughness !== null) {
                        <span class="ml-2 opacity-70">{{ c.power }}/{{ c.toughness }}</span>
                      }
                    </span>
                    <span class="flex items-center gap-1">
                      <button
                        type="button"
                        class="rounded border px-2 py-0.5"
                        [class.border-red-400]="scryDecisions()[c.instanceId] === 'bottom'"
                        [class.bg-red-400/10]="scryDecisions()[c.instanceId] === 'bottom'"
                        [class.text-red-300]="scryDecisions()[c.instanceId] === 'bottom'"
                        [class.border-white/15]="scryDecisions()[c.instanceId] !== 'bottom'"
                        [attr.data-scry-action]="'bottom'"
                        (click)="setScryDecision(c.instanceId, 'bottom')">
                        To bottom
                      </button>
                      <button
                        type="button"
                        class="rounded border px-2 py-0.5"
                        [class.border-emerald-400]="scryDecisions()[c.instanceId] === 'top'"
                        [class.bg-emerald-400/10]="scryDecisions()[c.instanceId] === 'top'"
                        [class.text-emerald-300]="scryDecisions()[c.instanceId] === 'top'"
                        [class.border-white/15]="scryDecisions()[c.instanceId] !== 'top'"
                        [attr.data-scry-action]="'top'"
                        (click)="setScryDecision(c.instanceId, 'top')">
                        Keep on top
                      </button>
                    </span>
                  </div>
                } @empty {
                  <span class="opacity-50">No cards to scry (library empty).</span>
                }
              </div>
              <div class="flex items-center gap-3">
                <span class="opacity-60">
                  bottom: {{ scryToBottomCount() }} | top: {{ scryToTopCount() }} / {{ scryPeeked().length }}
                </span>
                <button
                  type="button"
                  class="rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                  [disabled]="!scryReady()"
                  (click)="confirmScry()">
                  Confirm scry
                </button>
              </div>
            </div>
          }

          @case ('yesNo') {
            <!--
              CR 117.x / 605.1 — Yes/No "may" modal. Shock-land
              "pay 2 life?" is the seed caller; the same shape covers
              every binder-chain optional rider (painlands, slowlands,
              future may-clauses). The question copy comes from the
              engine verbatim (it knows the exact wording); the buttons
              default to "Yes" / "No" but the engine may override per
              prompt (e.g. "Pay 2 life" / "Enter tapped").
            -->
            <div class="flex flex-col gap-3 text-xs">
              @if (yesNoQuestion(); as q) {
                <p class="text-sm">{{ q }}</p>
              }
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="rounded border border-emerald-400 px-3 py-1 text-emerald-300 hover:bg-emerald-400/10"
                  [attr.data-yesno-action]="'yes'"
                  (click)="answerYesNo(true)">
                  {{ yesNoYesLabel() }}
                </button>
                <button
                  type="button"
                  class="rounded border border-red-400 px-3 py-1 text-red-300 hover:bg-red-400/10"
                  [attr.data-yesno-action]="'no'"
                  (click)="answerYesNo(false)">
                  {{ yesNoNoLabel() }}
                </button>
              </div>
            </div>
          }

          @case ('revealPick') {
            <!--
              CR 701.15 — reveal-and-choose modal. Server peeked the top
              N of the caster's library (or any equivalent reveal) and
              shipped them in revealView.revealed. Cards whose instanceId
              is in revealView.eligibleInstanceIds are clickable +
              highlighted; the rest are muted/non-clickable so the player
              SEES every revealed card (CR 701.15 — revealed cards are
              visible) while only legal picks are interactive.

              When eligible is empty (no card matched the predicate —
              "no permanent in the top 4" for Malevolent Rumble), only
              Decline is enabled and the player acknowledges the failed
              pick. When the prompt is optional ('you may'), the Decline
              button is always rendered alongside the picker.
            -->
            <div class="flex flex-col gap-2 text-xs">
              <span class="opacity-70">{{ revealPickLabel() }}</span>
              @if (revealPickEligibleIds().size === 0) {
                <span
                  data-testid="reveal-pick-empty-banner"
                  class="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-200">
                  No eligible card in the reveal — only decline is available.
                </span>
              }
              <div class="max-h-96 overflow-y-auto rounded border border-white/10">
                <div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2 p-2">
                  @for (c of revealPickRevealed(); track c.instanceId) {
                    @if (revealPickEligibleIds().has(c.instanceId)) {
                      <button
                        type="button"
                        class="rounded transition-shadow"
                        [class.ring-2]="selectedRevealInstanceId() === c.instanceId"
                        [class.ring-amber-400]="selectedRevealInstanceId() === c.instanceId"
                        [attr.data-eligible]="true"
                        [attr.data-instance-id]="c.instanceId"
                        (click)="selectRevealCandidate(c.instanceId)">
                        <app-card-tile [name]="c.name" [width]="120" [height]="168" />
                      </button>
                    } @else {
                      <div
                        class="rounded opacity-30 cursor-not-allowed"
                        [attr.data-muted]="true"
                        [attr.data-instance-id]="c.instanceId"
                        [attr.tabindex]="-1"
                        title="not eligible">
                        <app-card-tile [name]="c.name" [width]="120" [height]="168" />
                      </div>
                    }
                  } @empty {
                    <p class="col-span-full p-2 opacity-50">No cards were revealed.</p>
                  }
                </div>
              </div>
              <div class="flex items-center gap-2">
                @if (revealPickEligibleIds().size > 0) {
                  <button
                    type="button"
                    data-testid="reveal-pick-confirm"
                    class="rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                    [disabled]="!selectedRevealInstanceId()"
                    (click)="confirmRevealPick()">
                    Done
                  </button>
                }
                @if (revealPickOptional() || revealPickEligibleIds().size === 0) {
                  <button
                    type="button"
                    data-testid="reveal-pick-decline"
                    class="rounded border border-white/20 px-3 py-1 text-white/80 hover:bg-white/10"
                    (click)="confirmRevealPickDecline()">
                    Decline
                  </button>
                }
              </div>
            </div>
          }

          @case ('bottom') {
            <div class="flex flex-col gap-2 text-xs">
              @if (requiredBottom(); as need) {
                <span class="opacity-70">Put {{ need }} card{{ need === 1 ? '' : 's' }} on the bottom ({{ selected().length }}/{{ need }} selected).</span>
              } @else {
                <span class="opacity-70">Click cards to bottom them ({{ selected().length }} selected).</span>
              }
              <div class="grid grid-cols-3 gap-2">
                @for (c of selfHand(); track c.instanceId) {
                  <button
                    type="button"
                    class="rounded border px-2 py-1 text-left disabled:opacity-40 disabled:cursor-not-allowed"
                    [class.border-amber-400]="isSelected(c.instanceId)"
                    [class.bg-amber-400/10]="isSelected(c.instanceId)"
                    [class.border-white/15]="!isSelected(c.instanceId)"
                    [disabled]="!isSelected(c.instanceId) && bottomSelectionFull()"
                    (click)="toggle(c.instanceId)">
                    {{ c.name }}
                  </button>
                } @empty {
                  <span class="col-span-3 opacity-50">Hand empty.</span>
                }
              </div>
              <button
                type="button"
                class="self-start rounded border border-amber-400 px-3 py-1 text-amber-300 hover:bg-amber-400/10 disabled:opacity-40 disabled:cursor-not-allowed"
                [disabled]="!canConfirmBottom()"
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
  readonly cancelled = output<void>();

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
  // CR 701.19a — library-search picker state. selectedLibraryInstanceId
  // tracks the highlighted candidate; libraryPickFilter is a free-form
  // name-substring filter so the picker scales past a few candidates
  // (e.g. Green Sun's Zenith for X=4 on a fat deck). Both reset
  // implicitly when the picker unmounts (new prompt envelope).
  // libraryPickFilter is a WritableSignal (not a plain field) so the
  // filteredLibraryCandidates computed reacts to filter changes; the
  // [(ngModel)] binding uses the underlying setter directly via the
  // signal-as-model glue.
  readonly selectedLibraryInstanceId = signal<string | null>(null);
  readonly libraryPickFilter = signal<string>('');

  // CR 701.15 — reveal-and-choose picker state. selectedRevealInstanceId
  // tracks the clicked eligible card; resets implicitly on next prompt.
  readonly selectedRevealInstanceId = signal<string | null>(null);

  // CR 701.42 — surveil partition state. Maps a peeked card's instanceId
  // to 'graveyard' | 'top'. Cards not yet decided are absent (unset);
  // surveilReady() flips true only when every peeked card has a
  // decision, which gates the Confirm button (matches the server's
  // partition-coverage validation).
  readonly surveilDecisions = signal<Record<string, 'graveyard' | 'top'>>({});

  // CR 701.20 — scry partition state. Surveil's near-twin: maps a peeked
  // card's instanceId to 'bottom' | 'top'. Cards not yet decided are
  // absent (unset); scryReady() flips true only when every peeked card has
  // a decision, which gates the Confirm button (matches the server's
  // partition-coverage validation). The 'bottom' bucket is the only
  // difference from surveil's 'graveyard' bucket.
  readonly scryDecisions = signal<Record<string, 'bottom' | 'top'>>({});

  readonly kind = computed<PromptKind>(() => detectKind(this.prompt()?.expectedKinds));

  // Shared on-board selection state (provided at the match route so board +
  // overlay use ONE instance). When mode() is non-null the overlay renders
  // the slim banner instead of the modal grid for the in-scope kind; the
  // board owns the clicks + live arrows. `selection` is public so the banner
  // template can read selected()/blockPairs() directly.
  readonly selection = inject(SelectionService);
  readonly boardMode = computed<SelectionMode | null>(() => this.selection.mode());

  private readonly viewport = inject(ViewportService);
  // True when the overlay should render as a bottom-anchored sheet instead
  // of the centered max-w-3xl modal. Only applies to non-board-mode prompts
  // (the slim banner has its own layout and is not affected).
  readonly sheetMode = computed(() => this.viewport.isMobileBoard() && !this.boardMode());

  // Explicit (non-auto) submit for a board-resident targets/choice pick:
  // the banner's Done button. Emits the SAME PromptDecision the modal grid
  // would, so match.ts.translateDecision is unchanged. choiceKind is the
  // field translateDecision reads back (NOT a kind2 placeholder).
  confirmBoardSelection(bm: SelectionMode): void {
    const ids = this.selection.selected();
    if (bm.kind === 'targets') {
      this.decision.emit({ kind: 'targets', targetInstanceIds: ids });
    } else if (bm.kind === 'choice') {
      this.decision.emit({ kind: 'choice', selectedInstanceIds: ids, choiceKind: bm.choiceKind });
    }
    this.selection.clear();
  }

  // Confirm an on-board attacker declaration. Reads the shared selected set
  // and stamps each attacker with the opponent (the only defender the engine
  // supports today). Empty set = a valid "no attacks".
  confirmBoardAttackers(): void {
    const defenderId = this.opponent()?.id ?? '';
    const attackers = this.selection.selected().map(id => ({ attackerInstanceId: id, defenderId }));
    this.decision.emit({ kind: 'attackers', attackers });
    this.selection.clear();
  }

  // Confirm an on-board blocker declaration. Reads the shared blocker-pair
  // list the board built. Element shape mirrors the wire DeclareBlockers:
  // { attackerInstanceId, blockerInstanceId }.
  confirmBoardBlockers(): void {
    this.decision.emit({ kind: 'blockers', blockers: this.selection.blockPairs() });
    this.selection.resetCombat();
  }

  // Required number of cards to bottom (London mulligan). Null when the
  // server didn't send a count (older build / transient deploy window) —
  // the bottom UI then falls back to "any non-zero selection".
  readonly requiredBottom = computed<number | null>(() => {
    const n = this.prompt()?.bottomCount;
    return typeof n === 'number' && n > 0 ? n : null;
  });

  // Confirm-bottoming is enabled only when EXACTLY the required number of
  // cards is selected; deselecting back below N re-disables it. With no
  // server count, fall back to "at least one selected".
  readonly canConfirmBottom = computed<boolean>(() => {
    const need = this.requiredBottom();
    const n = this.selected().length;
    return need === null ? n > 0 : n === need;
  });

  // True once the selection has hit the required count — used to disable
  // not-yet-selected cards so the player can't pick more than N.
  readonly bottomSelectionFull = computed<boolean>(() => {
    const need = this.requiredBottom();
    return need !== null && this.selected().length >= need;
  });

  /**
   * CR 601.2 — the cast of a spell can be aborted at any sub-step up to
   * the spell being fully announced. The portal models that as the
   * cluster of mid-cast prompts:
   *  - `targets`  — choosing targets for the spell on the stack;
   *  - `x`        — choosing X for a variable-cost spell;
   *  - `mode`     — choosing a mode for a modal spell;
   *  - `mana`     — paying the mana cost.
   *
   * Every other prompt kind hides Cancel. Mulligan has no opt-out
   * (CR 103.4). Library-pick / surveil run as part of an already-
   * resolved triggered/static effect — there's no take-back. Combat
   * declarations use empty-selection to "skip" rather than dismiss the
   * overlay. Yes/No "may" prompts (shock land "pay 2 life?") need a
   * positive answer from the engine to continue.
   *
   * Mirrored by the spec coverage in `prompt-overlay.component.spec.ts`
   * (one assertion per kind in the cancel-button audit block).
   */
  readonly showCancelButton = computed<boolean>(() => {
    const k = this.kind();
    return k === 'targets' || k === 'x' || k === 'mode' || k === 'mana';
  });

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

  // CR 115.3 / 608.2c — when the engine ships a machine-readable legal
  // target pool on the prompt envelope (PromptDto.Candidates, server PR
  // #2582), the target picker must offer ONLY those cards. An illegal
  // target (e.g. an enemy land for "target land you control") must not
  // appear in the list at all. The envelope candidates are bare
  // CardSnapshots (no zone/controller), so we resolve those facets by
  // matching instanceId against the visible game state where possible;
  // an unresolved candidate (e.g. a hidden-zone target) still renders
  // with sensible fallbacks rather than being dropped.
  //
  // Only when the engine ships NO candidate list (a description-only
  // target prompt from an older/partial build) do we fall back to the
  // broad "every battlefield permanent" set so the player isn't locked
  // out — same graceful-degradation contract the library/reveal pickers
  // use for their respective views.
  readonly candidates = computed<CandidateCard[]>(() => {
    const promptCandidates = this.prompt()?.candidates;
    if (promptCandidates) {
      return promptCandidates.map(c => this.toCandidateCard(c));
    }
    // Fallback: no engine-supplied legal pool — offer the broad
    // battlefield set (legacy behaviour) so the user can still act.
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

  // Resolve a bare envelope candidate's zone + controller by locating it
  // in the visible game state. Falls back to ('battlefield', '') when the
  // card isn't found in any visible zone (e.g. a hidden-zone target the
  // engine still considered legal) so the candidate is always offered.
  private toCandidateCard(c: CardSnapshot): CandidateCard {
    const s = this.state();
    if (s) {
      for (const player of s.players) {
        if (player.battlefield.cards.some(x => x.instanceId === c.instanceId)) {
          return { card: c, zone: 'battlefield', controllerName: player.name };
        }
        if (player.hand.cards.some(x => x.instanceId === c.instanceId)) {
          return { card: c, zone: 'hand', controllerName: player.name };
        }
      }
    }
    return { card: c, zone: 'battlefield', controllerName: '' };
  }

  // CR 701.19a — library-search candidates ride on the prompt envelope
  // because the library zone is hidden in GameState under CR 706.
  readonly libraryCandidates = computed<CardSnapshot[]>(() =>
    this.prompt()?.candidates ?? []
  );

  // Full library snapshot from the envelope (top-to-bottom order).
  // Present only once the companion core PR has deployed. When absent,
  // `hasLibraryView` is false and the overlay falls back to the flat
  // candidates list (today's behaviour).
  readonly libraryView = computed<CardSnapshot[]>(() =>
    this.prompt()?.libraryView ?? []
  );

  // True when the server has shipped a full libraryView on this prompt.
  // Drives the template switch between the full-library grid and the
  // legacy flat-candidates list.
  readonly hasLibraryView = computed<boolean>(() =>
    (this.prompt()?.libraryView?.length ?? 0) > 0
  );

  // Set of eligible instanceIds for O(1) lookup in the grid template.
  readonly eligibleInstanceIds = computed<Set<string>>(() =>
    new Set(this.libraryCandidates().map(c => c.instanceId))
  );

  // Case-insensitive name-substring filter applied to the library
  // candidate list. Empty filter leaves the list untouched so the user
  // doesn't have to type to see the full set.
  readonly filteredLibraryCandidates = computed<CardSnapshot[]>(() => {
    const q = this.libraryPickFilter().trim().toLowerCase();
    const all = this.libraryCandidates();
    if (!q) return all;
    return all.filter(c => c.name.toLowerCase().includes(q));
  });

  // When libraryView is present, filter the FULL library (not just
  // candidates) by the same name substring. Eligible cards retain their
  // eligibility marker regardless of filter state.
  readonly filteredLibraryView = computed<CardSnapshot[]>(() => {
    const q = this.libraryPickFilter().trim().toLowerCase();
    const all = this.libraryView();
    if (!q) return all;
    return all.filter(c => c.name.toLowerCase().includes(q));
  });

  // Count of eligible cards visible after applying the current filter.
  // Shown as "eligible: X / Y" alongside the filter input.
  readonly visibleEligibleCount = computed<number>(() => {
    const eligible = this.eligibleInstanceIds();
    return this.filteredLibraryView().filter(c => eligible.has(c.instanceId)).length;
  });

  // CR 701.19a — group the (filtered) full library by card name into stacks
  // for the art-tile picker. Eligible and muted stacks are split so the
  // template can render the eligible-vs-muted halves without re-walking the
  // list. A name is treated as eligible if ≥1 of its instances is eligible
  // (defensive — for library search eligibility is by card identity so all
  // instances of a name share it, but we don't rely on that). First-
  // appearance order is preserved for a stable, sensible layout.
  private groupLibraryStacks(): { eligible: LibraryStack[]; muted: LibraryStack[] } {
    const eligibleIds = this.eligibleInstanceIds();
    const order: string[] = [];
    const byName = new Map<string, LibraryStack>();
    for (const c of this.filteredLibraryView()) {
      let stack = byName.get(c.name);
      if (!stack) {
        stack = { name: c.name, count: 0, instanceIds: [], eligible: false, eligibleInstanceId: null };
        byName.set(c.name, stack);
        order.push(c.name);
      }
      stack.count += 1;
      stack.instanceIds.push(c.instanceId);
      if (eligibleIds.has(c.instanceId)) {
        stack.eligible = true;
        if (stack.eligibleInstanceId === null) stack.eligibleInstanceId = c.instanceId;
      }
    }
    const eligible: LibraryStack[] = [];
    const muted: LibraryStack[] = [];
    for (const name of order) {
      const stack = byName.get(name)!;
      (stack.eligible ? eligible : muted).push(stack);
    }
    return { eligible, muted };
  }

  readonly eligibleLibraryStacks = computed<LibraryStack[]>(() => this.groupLibraryStacks().eligible);
  readonly mutedLibraryStacks = computed<LibraryStack[]>(() => this.groupLibraryStacks().muted);

  // True when the current selection belongs to the given stack (any of its
  // instances), so the template can show the selected ring on the right tile.
  isLibraryStackSelected(stack: LibraryStack): boolean {
    const sel = this.selectedLibraryInstanceId();
    return sel !== null && stack.instanceIds.includes(sel);
  }

  // CR 701.42 — peeked top-N of the surveilling player's library.
  // Library zone is hidden in GameState (CR 706), so the cards must
  // ride on the prompt envelope.
  readonly surveilPeeked = computed<CardSnapshot[]>(() =>
    this.prompt()?.surveilView ?? []
  );

  // True iff every peeked card has been classified ('graveyard' | 'top').
  // Drives the Confirm button's enabled state.
  readonly surveilReady = computed<boolean>(() => {
    const peeked = this.surveilPeeked();
    if (peeked.length === 0) return false;
    const decisions = this.surveilDecisions();
    return peeked.every(c => decisions[c.instanceId] === 'graveyard'
      || decisions[c.instanceId] === 'top');
  });

  // Convenience selectors used by the template to label the live counts
  // next to each bucket.
  readonly surveilToGraveyardCount = computed<number>(() =>
    Object.values(this.surveilDecisions()).filter(v => v === 'graveyard').length);
  readonly surveilToTopCount = computed<number>(() =>
    Object.values(this.surveilDecisions()).filter(v => v === 'top').length);

  // CR 701.20 — peeked top-N of the scrying player's library (surveil's
  // near-twin). Library zone is hidden in GameState (CR 706), so the cards
  // ride on the prompt envelope's scryView in top-to-bottom order.
  readonly scryPeeked = computed<CardSnapshot[]>(() =>
    this.prompt()?.scryView ?? []
  );

  // True iff every peeked card has been classified ('bottom' | 'top').
  // Drives the Confirm button's enabled state.
  readonly scryReady = computed<boolean>(() => {
    const peeked = this.scryPeeked();
    if (peeked.length === 0) return false;
    const decisions = this.scryDecisions();
    return peeked.every(c => decisions[c.instanceId] === 'bottom'
      || decisions[c.instanceId] === 'top');
  });

  // Convenience selectors used by the template to label the live counts
  // next to each bucket.
  readonly scryToBottomCount = computed<number>(() =>
    Object.values(this.scryDecisions()).filter(v => v === 'bottom').length);
  readonly scryToTopCount = computed<number>(() =>
    Object.values(this.scryDecisions()).filter(v => v === 'top').length);

  // CR 117.x / 605.1 — Yes/No prompt copy. Reads off the prompt
  // envelope's yesNoView block; defaults to empty string + "Yes" / "No"
  // when the view is absent so the template can still render (defense
  // in depth — the modal should never render with no question, but if
  // it does the buttons remain usable).
  readonly yesNoQuestion = computed<string>(() =>
    this.prompt()?.yesNoView?.question ?? '');
  readonly yesNoYesLabel = computed<string>(() =>
    this.prompt()?.yesNoView?.yesLabel ?? 'Yes');
  readonly yesNoNoLabel = computed<string>(() =>
    this.prompt()?.yesNoView?.noLabel ?? 'No');

  // CR 701.15 — reveal-and-choose computeds. Read off the prompt
  // envelope's revealView block; default to empty when absent so the
  // template renders defensively without crashing on a malformed
  // prompt envelope.
  readonly revealPickRevealed = computed<CardSnapshot[]>(() =>
    this.prompt()?.revealView?.revealed ?? []);
  readonly revealPickEligibleIds = computed<Set<string>>(() =>
    new Set(this.prompt()?.revealView?.eligibleInstanceIds ?? []));
  readonly revealPickOptional = computed<boolean>(() =>
    this.prompt()?.revealView?.optional ?? false);
  readonly revealPickLabel = computed<string>(() =>
    this.prompt()?.revealView?.label ?? 'Pick a card.');

  // CR 700.6 / 701.x — generic declarative-choice computeds. The descriptor
  // rides on the prompt's choiceView; the pickable cards come through the
  // shared `candidates()` machinery (same grid as targets). Defaults to a
  // single-pick (min=max=1) when the view is absent so the modal still
  // renders defensively rather than crashing on a malformed envelope.
  readonly choiceMin = computed<number>(() => {
    const n = this.prompt()?.choiceView?.min;
    return typeof n === 'number' && n >= 0 ? n : 1;
  });
  readonly choiceMax = computed<number>(() => {
    const n = this.prompt()?.choiceView?.max;
    return typeof n === 'number' && n >= 1 ? n : 1;
  });
  readonly choiceKindName = computed<string>(() =>
    this.prompt()?.choiceView?.kind ?? 'PickOne');

  // Confirm is enabled only when the selection count is within the
  // choiceView's [min, max] bounds (PickOne = exactly 1; PickN = min..max).
  readonly canConfirmChoice = computed<boolean>(() => {
    const n = this.selected().length;
    return n >= this.choiceMin() && n <= this.choiceMax();
  });

  titleFor(k: PromptKind): string {
    switch (k) {
      case 'targets': return 'Choose targets';
      case 'mulligan': return 'Mulligan?';
      case 'x': return 'Choose X';
      case 'mode': return 'Choose mode';
      case 'bottom': {
        const n = this.requiredBottom();
        return n === null ? 'Bottom cards' : `Bottom ${n} card${n === 1 ? '' : 's'}`;
      }
      case 'attackers': return 'Declare attackers';
      case 'blockers': return 'Declare blockers';
      case 'mana': return 'Pay mana cost';
      case 'libraryPick': return 'Search your library';
      case 'surveil': return 'Surveil';
      case 'scry': return 'Scry';
      case 'revealPick': return 'Choose from revealed cards';
      case 'choice': return 'Choose';
      case 'yesNo': {
        // Title the modal after the triggering permanent when the engine
        // provided one ("Overgrown Tomb"); fall back to a generic label
        // for prompts without a source-card context.
        const src = this.prompt()?.yesNoView?.sourceCardName;
        return src ?? 'Choose';
      }
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

  // CR 700.6 / 701.x — emit the generic declarative-choice response. Echoes
  // the prompt's choiceView.kind back verbatim (the engine resolves the
  // picks against it) and ships the selected candidate instance ids.
  // MatchPage.translateDecision turns this into the wire ChoiceCommand
  // ($type: 'choice'). Guarded on the same min..max bounds the button is
  // gated to, so a stray Enter can't submit an out-of-bounds pick.
  confirmChoice(): void {
    if (!this.canConfirmChoice()) return;
    this.decision.emit({
      kind: 'choice',
      choiceKind: this.choiceKindName(),
      selectedInstanceIds: this.selected(),
    });
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

  confirmMana(): void {
    // Empty sourceInstanceIds → server's ManaPaymentResolver auto-taps
    // untapped basics for the unpaid deficit after the floating pool is
    // consumed first (server PR #438).
    this.decision.emit({ kind: 'mana', sourceInstanceIds: [] });
  }

  cancelMana(): void {
    this.decision.emit({ kind: 'mana-cancel' });
  }

  // CR 701.19a — library-search picker handlers. Selection is local
  // state (no server round-trip on click); only confirmLibraryPick /
  // confirmLibraryPickNothing emit the wire ChooseLibraryPickCommand.
  selectLibraryCandidate(id: string): void {
    this.selectedLibraryInstanceId.set(
      this.selectedLibraryInstanceId() === id ? null : id);
  }

  confirmLibraryPick(): void {
    const id = this.selectedLibraryInstanceId();
    if (!id) return;
    this.decision.emit({ kind: 'libraryPick', selectedInstanceId: id });
    this.selectedLibraryInstanceId.set(null);
    this.libraryPickFilter.set('');
  }

  confirmLibraryPickNothing(): void {
    // CR 701.19a — declining to choose from a successful search is
    // legal. `null` selectedInstanceId is the wire shape for that
    // branch; the server-side resolver translates it to a no-pick
    // (Green Sun's Zenith etc. simply shuffle without tutoring).
    this.decision.emit({ kind: 'libraryPick', selectedInstanceId: null });
    this.selectedLibraryInstanceId.set(null);
    this.libraryPickFilter.set('');
  }

  // CR 701.15 — reveal-and-choose picker handlers. Click toggles the
  // selection (same UX as libraryPick); Done emits the picked id;
  // Decline emits null. The brief explicitly forbids a Cancel button
  // here (the reveal is mid-resolve, not mid-cast — no take-back).
  selectRevealCandidate(id: string): void {
    this.selectedRevealInstanceId.set(
      this.selectedRevealInstanceId() === id ? null : id);
  }

  confirmRevealPick(): void {
    const id = this.selectedRevealInstanceId();
    if (!id) return;
    this.decision.emit({ kind: 'revealPick', pickedInstanceId: id });
    this.selectedRevealInstanceId.set(null);
  }

  confirmRevealPickDecline(): void {
    // CR 116.1b — declining a 'you may' clause. Null pickedInstanceId
    // is the wire shape for that branch; server resolves to no-op for
    // the picked card (rest of the reveal still moves to the engine-
    // specified rest destination).
    this.decision.emit({ kind: 'revealPick', pickedInstanceId: null });
    this.selectedRevealInstanceId.set(null);
  }

  // Compact "Creature — Elf Druid" type line for the picker rows. The
  // CardSnapshot.types is already strongly typed but we render a single
  // line to keep each row scannable.
  libraryCardTypeLine(card: CardSnapshot): string {
    return (card.types ?? []).join(' ');
  }

  // CR 701.42 — record/toggle a single peeked card's surveil decision.
  // Clicking the already-set choice clears it (so the row goes back to
  // "undecided", forcing the player to re-pick before Confirm enables).
  setSurveilDecision(instanceId: string, choice: 'graveyard' | 'top'): void {
    const map = { ...this.surveilDecisions() };
    if (map[instanceId] === choice) {
      delete map[instanceId];
    } else {
      map[instanceId] = choice;
    }
    this.surveilDecisions.set(map);
  }

  // Assemble the wire ChooseSurveilCommand payload. Top-order is taken
  // from the peeked-list's natural order (server.PromptDto.SurveilView
  // ships top-to-bottom; cards the player chose to keep on top stay in
  // that relative order — index 0 of the resulting list becomes the new
  // top of the library).
  confirmSurveil(): void {
    const peeked = this.surveilPeeked();
    const decisions = this.surveilDecisions();
    const toGraveyardInstanceIds: string[] = [];
    const topOrderInstanceIds: string[] = [];
    for (const c of peeked) {
      const choice = decisions[c.instanceId];
      if (choice === 'graveyard') toGraveyardInstanceIds.push(c.instanceId);
      else if (choice === 'top') topOrderInstanceIds.push(c.instanceId);
    }
    this.decision.emit({ kind: 'surveil', toGraveyardInstanceIds, topOrderInstanceIds });
    this.surveilDecisions.set({});
  }

  // CR 701.20 — record/toggle a single peeked card's scry decision
  // (surveil's near-twin). Clicking the already-set choice clears it (so
  // the row goes back to "undecided", forcing the player to re-pick before
  // Confirm enables).
  setScryDecision(instanceId: string, choice: 'bottom' | 'top'): void {
    const map = { ...this.scryDecisions() };
    if (map[instanceId] === choice) {
      delete map[instanceId];
    } else {
      map[instanceId] = choice;
    }
    this.scryDecisions.set(map);
  }

  // Assemble the wire ChooseScryCommand payload. Top-order is taken from
  // the peeked-list's natural order (PromptDto.ScryView ships top-to-
  // bottom; cards the player chose to keep on top stay in that relative
  // order — index 0 of the resulting list becomes the new top of library).
  // The non-kept cards go to the BOTTOM of the library (CR 701.20a), the
  // only difference from surveil's graveyard bucket.
  confirmScry(): void {
    const peeked = this.scryPeeked();
    const decisions = this.scryDecisions();
    const toBottomInstanceIds: string[] = [];
    const topOrderInstanceIds: string[] = [];
    for (const c of peeked) {
      const choice = decisions[c.instanceId];
      if (choice === 'bottom') toBottomInstanceIds.push(c.instanceId);
      else if (choice === 'top') topOrderInstanceIds.push(c.instanceId);
    }
    this.decision.emit({ kind: 'scry', toBottomInstanceIds, topOrderInstanceIds });
    this.scryDecisions.set({});
  }

  // CR 117.x / 605.1 — emit the bool answer for an optional "may"
  // prompt. Shock-land is the seed caller; future binder-chain prompts
  // (painlands, slowlands, etc.) reuse this path unchanged. The server's
  // ChooseYesNoCommand only carries { Answer: bool }; no per-button
  // payload reshape needed.
  answerYesNo(answer: boolean): void {
    this.decision.emit({ kind: 'yesNo', answer });
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
    this.cancelled.emit();
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
        if (!this.canConfirmBottom()) return false;
        this.confirmBottom();
        return true;
      case 'choice':
        if (!this.canConfirmChoice()) return false;
        this.confirmChoice();
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
