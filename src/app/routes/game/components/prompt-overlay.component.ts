import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CardSnapshotDto } from '../../../core/api/models/card-snapshot-dto';
import { GameStateDto } from '../../../core/api/models/game-state-dto';
import { PlayerDto } from '../../../core/api/models/player-dto';

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
  card: CardSnapshotDto;
  zone: 'battlefield' | 'hand';
  controllerName: string;
}

function detectKind(kinds: string[] | undefined): PromptKind {
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
        class="fixed inset-x-0 top-0 z-50 mx-auto mt-3 max-w-3xl rounded border border-amber-500/40 bg-black/80 p-3 shadow-xl"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="titleFor(kind())">
        <div class="mb-2 flex items-center justify-between">
          <div>
            <h3 class="text-sm font-semibold text-amber-300">{{ titleFor(kind()) }}</h3>
            @if (prompt()?.description; as d) {
              <p class="text-xs opacity-70">{{ d }}</p>
            }
          </div>
          <button
            type="button"
            class="rounded border border-white/20 px-2 py-0.5 text-xs hover:bg-white/10"
            (click)="onCancel()">
            Cancel
          </button>
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
              <span class="opacity-70">For each attacker, optionally pick one of your creatures to block.</span>
              <div class="flex flex-col gap-2">
                @for (atk of attackerList(); track atk.instanceId) {
                  <div class="flex items-center gap-2 rounded border border-white/10 px-2 py-1">
                    <span class="w-32 truncate font-medium">{{ atk.name }}</span>
                    <select
                      class="flex-1 rounded border border-white/15 bg-black/30 px-2 py-1"
                      [value]="blockerMap()[atk.instanceId] || ''"
                      (change)="setBlocker(atk.instanceId, $event)">
                      <option value="">(no block)</option>
                      @for (b of selfCreatures(); track b.instanceId) {
                        @if (!b.tapped) {
                          <option [value]="b.instanceId">{{ b.name }}</option>
                        }
                      }
                    </select>
                  </div>
                } @empty {
                  <span class="opacity-50">No attackers.</span>
                }
              </div>
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
export class PromptOverlayComponent {
  readonly state = input<GameStateDto | null>(null);
  readonly prompt = input<PromptInfo | null>(null);
  readonly selfPlayerIds = input<string[]>([]);

  readonly decision = output<PromptDecision>();
  readonly cancel = output<void>();

  readonly selected = signal<string[]>([]);
  readonly modeOptions = [0, 1, 2, 3] as const;
  readonly blockerMap = signal<Record<string, string>>({});
  xValue = 0;

  readonly kind = computed<PromptKind>(() => detectKind(this.prompt()?.expectedKinds));

  readonly self = computed<PlayerDto | null>(() => {
    const s = this.state();
    if (!s) return null;
    const owned = this.selfPlayerIds();
    return s.players.find(p => owned.includes(p.id)) ?? null;
  });

  readonly selfHand = computed<CardSnapshotDto[]>(() => this.self()?.hand.cards ?? []);

  readonly opponent = computed<PlayerDto | null>(() => {
    const s = this.state();
    if (!s) return null;
    const me = this.self();
    return s.players.find(p => p.id !== me?.id) ?? null;
  });

  readonly selfCreatures = computed<CardSnapshotDto[]>(() =>
    (this.self()?.battlefield.cards ?? []).filter(c =>
      (c.types ?? []).some(t => t.toLowerCase().includes('creature'))
    )
  );

  readonly attackerList = computed<CardSnapshotDto[]>(() =>
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

  setBlocker(attackerId: string, evt: Event): void {
    const value = (evt.target as HTMLSelectElement).value;
    const map = { ...this.blockerMap() };
    if (value) map[attackerId] = value;
    else delete map[attackerId];
    this.blockerMap.set(map);
  }

  confirmBlockers(): void {
    const blockers = Object.entries(this.blockerMap()).map(
      ([attackerInstanceId, blockerInstanceId]) => ({ attackerInstanceId, blockerInstanceId })
    );
    this.decision.emit({ kind: 'blockers', blockers });
    this.blockerMap.set({});
  }

  onCancel(): void {
    this.selected.set([]);
    this.cancel.emit();
  }
}
