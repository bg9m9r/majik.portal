import { Injectable, inject, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import {
  ClockUpdatePayload,
  OpponentJoinedPayload,
  PlayDrawChosenPayload,
  PlayerRolledPayload,
  RolledPayload,
  StateChangedPayload,
  TimedOutPayload
} from '../match/match.types';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

@Injectable({ providedIn: 'root' })
export class SignalrService {
  private readonly auth = inject(AuthService);

  private connection: HubConnection | null = null;
  private currentMatchId: string | null = null;

  private readonly _state = signal<ConnectionState>('idle');
  private readonly _error = signal<string | null>(null);

  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();

  // Engine events (scoped to a match's underlying game)
  readonly event$ = new Subject<unknown>();
  readonly prompt$ = new Subject<unknown>();

  // Match lifecycle event streams
  readonly opponentJoined$ = new Subject<OpponentJoinedPayload>();
  readonly stateChanged$ = new Subject<StateChangedPayload>();
  readonly rolled$ = new Subject<RolledPayload>();
  readonly playDrawChosen$ = new Subject<PlayDrawChosenPayload>();
  readonly clockUpdate$ = new Subject<ClockUpdatePayload>();
  readonly timedOut$ = new Subject<TimedOutPayload>();
  readonly playerRolled$ = new Subject<PlayerRolledPayload>();

  async connect(matchId: string): Promise<void> {
    if (this.connection && this.currentMatchId === matchId) {
      return;
    }
    await this.disconnect();
    this._state.set('connecting');
    this._error.set(null);
    this.currentMatchId = matchId;

    this.connection = new HubConnectionBuilder()
      .withUrl(environment.signalRHubUrl, {
        accessTokenFactory: () => this.auth.token() ?? ''
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    this.connection.on('event', (evt: unknown) => this.event$.next(evt));
    this.connection.on('prompt', (p: unknown) => this.prompt$.next(p));
    this.connection.on('match.opponent-joined', (p: OpponentJoinedPayload) => this.opponentJoined$.next(p));
    this.connection.on('match.state-changed', (p: StateChangedPayload) => this.stateChanged$.next(p));
    this.connection.on('match.rolled', (p: RolledPayload) => this.rolled$.next(p));
    this.connection.on('match.play-draw-chosen', (p: PlayDrawChosenPayload) => this.playDrawChosen$.next(p));
    this.connection.on('match.clock-update', (p: ClockUpdatePayload) => this.clockUpdate$.next(p));
    this.connection.on('match.timed-out', (p: TimedOutPayload) => this.timedOut$.next(p));
    this.connection.on('match.player-rolled', (p: PlayerRolledPayload) => this.playerRolled$.next(p));

    this.connection.onclose(err => {
      this._state.set(err ? 'error' : 'closed');
      if (err) this._error.set(err.message);
    });
    this.connection.onreconnecting(() => this._state.set('connecting'));
    this.connection.onreconnected(() => this._state.set('open'));

    try {
      await this.connection.start();
      await this.connection.invoke('JoinMatch', matchId);
      this._state.set('open');
    } catch (err: unknown) {
      this._state.set('error');
      this._error.set(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connection) return;
    try {
      if (this.connection.state === HubConnectionState.Connected && this.currentMatchId) {
        await this.connection.invoke('LeaveMatch', this.currentMatchId);
      }
      await this.connection.stop();
    } catch {
      // ignore — best effort cleanup
    }
    this.connection = null;
    this.currentMatchId = null;
    this._state.set('idle');
  }
}
