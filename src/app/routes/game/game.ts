import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api/api';
import { getGame } from '../../core/api/fn/games/get-game';
import { claimSeat } from '../../core/api/fn/seating/claim-seat';
import { startGame } from '../../core/api/fn/game-play/start-game';
import { getGameState } from '../../core/api/fn/game-play/get-game-state';
import { submitCommand } from '../../core/api/fn/game-play/submit-command';
import { PlayerSlotResponse } from '../../core/api/models/player-slot-response';
import { GameStateDto } from '../../core/api/models/game-state-dto';
import { CardSnapshotDto } from '../../core/api/models/card-snapshot-dto';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';
import { SignalrService } from '../../core/signalr/signalr.service';
import { BoardComponent } from './components/board.component';
import { PromptOverlayComponent, PromptDecision } from './components/prompt-overlay.component';

interface MySeatsResponse {
  gameId: string;
  playerIds: string[];
}

interface LogLine {
  kind: 'event' | 'prompt';
  payload: unknown;
  at: number;
}

interface PromptPayload {
  gameId?: string;
  playerId?: string;
  expectedKinds?: string[];
  description?: string;
}

@Component({
  selector: 'app-game',
  standalone: true,
  imports: [RouterLink, BoardComponent, PromptOverlayComponent],
  template: `
    <main class="flex min-h-screen flex-col">
      <header class="flex items-center justify-between border-b border-white/10 p-3">
        <h1 class="text-lg">Game <code class="text-[color:var(--majik-accent)]">{{ id }}</code></h1>
        <div class="flex items-center gap-3 text-xs">
          <span
            class="rounded px-2 py-0.5"
            [class.bg-emerald-700]="signalr.state() === 'open'"
            [class.bg-amber-700]="signalr.state() === 'connecting' || signalr.state() === 'idle'"
            [class.bg-red-800]="signalr.state() === 'error' || signalr.state() === 'closed'">
            hub: {{ signalr.state() }}
          </span>
          <a routerLink="/lobby" class="text-[color:var(--majik-accent)] underline">Back</a>
        </div>
      </header>

      <section class="flex flex-1 flex-col">
        @if (loading()) {
          <p class="p-6 opacity-60">Loading game…</p>
        } @else if (loadError()) {
          <p class="p-6 text-red-300/80">{{ loadError() }}</p>
        } @else if (gameState()) {
          <app-board
            [state]="gameState()"
            [selfPlayerIds]="mine()"
            [currentPrompt]="currentPrompt()"
            (passClicked)="onPass()"
            (handCardClicked)="onHandClick($event)" />
          <app-prompt-overlay
            [state]="gameState()"
            [prompt]="currentPrompt()"
            [selfPlayerIds]="mine()"
            (decision)="onPromptDecision($event)"
            (cancel)="currentPrompt.set(null)" />
        } @else {
          <div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
            <div></div>
            <div class="flex flex-col gap-3">
              <h2 class="text-sm uppercase tracking-wider opacity-60">Seats</h2>
              @for (p of players(); track p.id) {
                <div class="flex items-center justify-between rounded border border-white/10 p-3">
                  <div>
                    <div class="font-medium">{{ p.name }}</div>
                    <div class="text-xs opacity-50">{{ p.id }}</div>
                  </div>
                  <button
                    type="button"
                    class="rounded border px-3 py-1 text-sm disabled:opacity-40"
                    [class.border-emerald-500]="mine().includes(p.id)"
                    [class.text-emerald-400]="mine().includes(p.id)"
                    [class.border-white]="!mine().includes(p.id)"
                    [disabled]="claimingId() === p.id"
                    (click)="onClaim(p.id)">
                    @if (mine().includes(p.id)) {
                      Yours
                    } @else if (claimingId() === p.id) {
                      Claiming…
                    } @else {
                      Claim
                    }
                  </button>
                </div>
              }
            </div>

            @if (claimError()) {
              <p class="text-xs text-red-300/80">{{ claimError() }}</p>
            }

            <div class="flex items-center gap-3">
              <button
                type="button"
                class="rounded border border-[color:var(--majik-accent)] px-4 py-2 text-[color:var(--majik-accent)] hover:bg-[color:var(--majik-accent)]/10 disabled:opacity-40"
                [disabled]="starting() || mine().length === 0"
                (click)="onStart()">
                {{ starting() ? 'Starting…' : 'Start game' }}
              </button>
              <span class="text-xs opacity-60">Both seats must be claimed (possibly by another browser).</span>
            </div>
            @if (startError()) {
              <p class="text-xs text-red-300/80">{{ startError() }}</p>
            }
          </div>
        }

        <section class="mx-auto mt-4 w-full max-w-3xl rounded border border-white/10 p-3">
            <h2 class="mb-2 text-sm uppercase tracking-wider opacity-60">Event log ({{ log().length }})</h2>
            <div class="max-h-64 overflow-auto font-mono text-xs">
              @for (line of log(); track line.at) {
                <div class="border-b border-white/5 py-1">
                  <span
                    class="inline-block w-14 text-center text-[10px] uppercase tracking-wider"
                    [class.text-emerald-400]="line.kind === 'event'"
                    [class.text-amber-300]="line.kind === 'prompt'">
                    {{ line.kind }}
                  </span>
                  <span class="opacity-80">{{ stringify(line.payload) }}</span>
                </div>
              } @empty {
                <p class="opacity-40">No events yet.</p>
              }
            </div>
          </section>
      </section>
    </main>
  `
})
export class GamePage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(Api);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  readonly auth = inject(AuthService);
  readonly signalr = inject(SignalrService);

  readonly id = this.route.snapshot.paramMap.get('id') ?? '';

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly players = signal<PlayerSlotResponse[]>([]);
  readonly mine = signal<string[]>([]);
  readonly claimingId = signal<string | null>(null);
  readonly claimError = signal<string | null>(null);
  readonly starting = signal(false);
  readonly startError = signal<string | null>(null);
  readonly gameState = signal<GameStateDto | null>(null);
  readonly log = signal<LogLine[]>([]);
  readonly currentPrompt = signal<PromptPayload | null>(null);
  readonly passError = signal<string | null>(null);

  ngOnInit(): void {
    if (!this.id) {
      this.router.navigate(['/lobby']);
      return;
    }
    this.signalr.event$.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(payload => {
        this.pushLog('event', payload);
        void this.refreshState();
      });
    this.signalr.prompt$.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(payload => {
        this.pushLog('prompt', payload);
        const p = payload as PromptPayload | null;
        if (p && (!p.playerId || this.mine().includes(p.playerId))) {
          this.currentPrompt.set({
            ...p,
            description: p.expectedKinds?.join(' / ')
          });
        }
      });
    this.loadGame();
  }

  ngOnDestroy(): void {
    void this.signalr.disconnect();
  }

  private pushLog(kind: 'event' | 'prompt', payload: unknown): void {
    const next = [...this.log(), { kind, payload, at: Date.now() }];
    if (next.length > 200) next.splice(0, next.length - 200);
    this.log.set(next);
  }

  stringify(payload: unknown): string {
    try {
      return JSON.stringify(payload);
    } catch {
      return String(payload);
    }
  }

  async loadGame(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [game, seats] = await Promise.all([
        this.api.invoke(getGame, { id: this.id }),
        this.fetchMySeats()
      ]);
      this.players.set(game.players);
      this.mine.set(seats.playerIds);
      if (seats.playerIds.length > 0) {
        await this.ensureSignalr();
      }
    } catch (err: unknown) {
      this.loadError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }

  private async ensureSignalr(): Promise<void> {
    try {
      await this.signalr.connect(this.id);
    } catch {
      // signalr.service surfaces error via state signal
    }
  }

  private async fetchMySeats(): Promise<MySeatsResponse> {
    const url = `${environment.apiBaseUrl}/games/${this.id}/seat`;
    return await this.http.get<MySeatsResponse>(url).toPromise() as MySeatsResponse;
  }

  async onClaim(playerId: string): Promise<void> {
    this.claimingId.set(playerId);
    this.claimError.set(null);
    try {
      await this.api.invoke(claimSeat, { id: this.id, body: { playerId } });
      const seats = await this.fetchMySeats();
      this.mine.set(seats.playerIds);
      await this.ensureSignalr();
    } catch (err: unknown) {
      this.claimError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.claimingId.set(null);
    }
  }

  async onStart(): Promise<void> {
    this.starting.set(true);
    this.startError.set(null);
    try {
      const state = await this.api.invoke(startGame, { id: this.id, mode: 'full' });
      this.gameState.set(state);
    } catch (err: unknown) {
      this.startError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.starting.set(false);
    }
  }

  private async refreshState(): Promise<void> {
    if (!this.gameState()) return;
    try {
      const state = await this.api.invoke(getGameState, { id: this.id });
      this.gameState.set(state);
    } catch {
      // ignore transient refresh failures; SignalR will trigger another
    }
  }

  async onPass(): Promise<void> {
    const playerId = this.mine()[0];
    if (!playerId) return;
    this.passError.set(null);
    try {
      await this.api.invoke(submitCommand, {
        id: this.id,
        body: { $type: 'pass', playerId } as never
      });
      this.currentPrompt.set(null);
    } catch (err: unknown) {
      this.passError.set(err instanceof Error ? err.message : String(err));
    }
  }

  async onPromptDecision(d: PromptDecision): Promise<void> {
    const playerId = this.mine()[0];
    if (!playerId) return;
    let body: Record<string, unknown> | null = null;
    switch (d.kind) {
      case 'targets':
        body = { $type: 'targets', playerId, targetInstanceIds: d.targetInstanceIds ?? [] };
        break;
      case 'mulligan':
        body = { $type: 'mulligan', playerId, keep: d.keep ?? false };
        break;
      case 'x':
        body = { $type: 'x', playerId, x: d.x ?? 0 };
        break;
      case 'mode':
        body = { $type: 'mode', playerId, modeIndex: d.modeIndex ?? 0 };
        break;
      case 'bottom':
        body = { $type: 'bottom', playerId, cardInstanceIds: d.cardInstanceIds ?? [] };
        break;
      case 'attackers':
        body = { $type: 'attackers', playerId, attackers: d.attackers ?? [] };
        break;
      case 'blockers':
        body = { $type: 'blockers', playerId, blockers: d.blockers ?? [] };
        break;
    }
    if (!body) return;
    try {
      await this.api.invoke(submitCommand, { id: this.id, body: body as never });
      this.currentPrompt.set(null);
    } catch (err: unknown) {
      this.passError.set(err instanceof Error ? err.message : String(err));
    }
  }

  async onHandClick(card: CardSnapshotDto): Promise<void> {
    const playerId = this.mine()[0];
    if (!playerId) return;
    const isLand = card.types?.some(t => t.toLowerCase().includes('land'));
    const body = isLand
      ? { $type: 'play-land', playerId, landInstanceId: card.instanceId }
      : {
          $type: 'cast',
          playerId,
          cardInstanceId: card.instanceId,
          targetInstanceIds: [],
          modeIndex: null,
          xValue: null
        };
    try {
      await this.api.invoke(submitCommand, { id: this.id, body: body as never });
    } catch (err: unknown) {
      this.passError.set(err instanceof Error ? err.message : String(err));
    }
  }
}
