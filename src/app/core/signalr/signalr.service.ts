import { Injectable, inject, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

@Injectable({ providedIn: 'root' })
export class SignalrService {
  private readonly auth = inject(AuthService);

  private connection: HubConnection | null = null;
  private currentGameId: string | null = null;

  private readonly _state = signal<ConnectionState>('idle');
  private readonly _error = signal<string | null>(null);

  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();

  readonly event$ = new Subject<unknown>();
  readonly prompt$ = new Subject<unknown>();

  async connect(gameId: string): Promise<void> {
    if (this.connection && this.currentGameId === gameId) {
      return;
    }
    await this.disconnect();
    this._state.set('connecting');
    this._error.set(null);
    this.currentGameId = gameId;

    this.connection = new HubConnectionBuilder()
      .withUrl(environment.signalRHubUrl, {
        accessTokenFactory: () => this.auth.token() ?? ''
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    this.connection.on('event', (evt: unknown) => this.event$.next(evt));
    this.connection.on('prompt', (p: unknown) => this.prompt$.next(p));
    this.connection.onclose(err => {
      this._state.set(err ? 'error' : 'closed');
      if (err) this._error.set(err.message);
    });
    this.connection.onreconnecting(() => this._state.set('connecting'));
    this.connection.onreconnected(() => this._state.set('open'));

    try {
      await this.connection.start();
      await this.connection.invoke('JoinGame', gameId);
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
      if (this.connection.state === HubConnectionState.Connected && this.currentGameId) {
        await this.connection.invoke('LeaveGame', this.currentGameId);
      }
      await this.connection.stop();
    } catch {
      // ignore — best effort cleanup
    }
    this.connection = null;
    this.currentGameId = null;
    this._state.set('idle');
  }
}
