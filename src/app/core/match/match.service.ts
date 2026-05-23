import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  CreateMatchRequest, GameCommand, GameState, JoinMatchRequest, Match,
  MatchError, MatchErrorCode, MatchReplay, PlayDrawRequest
} from './match.types';

@Injectable({ providedIn: 'root' })
export class MatchService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/matches`;

  private readonly _current = signal<Match | null>(null);
  readonly current = this._current.asReadonly();

  setCurrent(m: Match | null): void { this._current.set(m); }

  async list(): Promise<Result<Match[]>> {
    return this.req(() => firstValueFrom(
      this.http.get<Match[]>(`${this.base}?visibility=public`)));
  }

  async create(body: CreateMatchRequest): Promise<Result<Match>> {
    return this.req(() => firstValueFrom(
      this.http.post<Match>(this.base, body)));
  }

  async get(id: string): Promise<Result<Match>> {
    return this.req(() => firstValueFrom(
      this.http.get<Match>(`${this.base}/${id}`)));
  }

  async join(id: string, body: JoinMatchRequest): Promise<Result<Match>> {
    return this.req(() => firstValueFrom(
      this.http.post<Match>(`${this.base}/${id}/join`, body)));
  }

  async playDraw(id: string, body: PlayDrawRequest): Promise<Result<Match>> {
    return this.req(() => firstValueFrom(
      this.http.post<Match>(`${this.base}/${id}/play-draw`, body)));
  }

  async submitRoll(id: string): Promise<Result<Match>> {
    return this.req(() => firstValueFrom(
      this.http.post<Match>(`${this.base}/${id}/roll`, {})));
  }

  async concede(id: string): Promise<Result<Match>> {
    return this.req(() => firstValueFrom(
      this.http.post<Match>(`${this.base}/${id}/concede`, {})));
  }

  async abandon(id: string): Promise<Result<void>> {
    return this.req(() => firstValueFrom(
      this.http.delete<void>(`${this.base}/${id}`)));
  }

  // Game-state + command channel — used once a match transitions to
  // Playing. Mirrors POST /matches/{id}/commands (any GameCommand) and
  // GET /matches/{id}/state (returns GameStateDto).
  async getState(id: string): Promise<Result<GameState>> {
    return this.req(() => firstValueFrom(
      this.http.get<GameState>(`${this.base}/${id}/state`)));
  }

  async submitCommand(id: string, command: GameCommand): Promise<Result<void>> {
    return this.req(() => firstValueFrom(
      this.http.post<void>(`${this.base}/${id}/commands`, command)));
  }

  // Replay log — captured server-side via the engine→hub bridge. Returns
  // the full ordered EventDto + BotDecision stream as JSON. Available
  // only to seated players (see Majik.Server MatchService.GetReplayAsync).
  // The portal currently uses this purely to drive the "Download replay"
  // button on the match-over screen; no in-app viewer.
  async getReplay(id: string): Promise<Result<MatchReplay>> {
    return this.req(() => firstValueFrom(
      this.http.get<MatchReplay>(`${this.base}/${id}/replay`)));
  }

  private async req<T>(fn: () => Promise<T>): Promise<Result<T>> {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      return { ok: false, error: mapError(err) };
    }
  }
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: MatchError };

function mapError(err: unknown): MatchError {
  const e = err as HttpErrorResponse;
  const body = (e?.error ?? {}) as { error?: string; detail?: string };
  const code = (body.error ?? 'unknown') as MatchErrorCode;
  if (e?.status === 0) return { code: 'network' };
  return { code, detail: body.detail };
}
