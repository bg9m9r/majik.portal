import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { BotArchetypeDto, listBotArchetypes } from '../api';
import {
  CreateMatchRequest, GameCommand, GameState, JoinMatchRequest, Match,
  MatchError, MatchErrorCode, MatchReplay, PlayDrawRequest
} from './match.types';

@Injectable({ providedIn: 'root' })
export class MatchService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/matches`;
  // Root URL the generated OpenAPI fns prepend to their {PATH} constants.
  // The generated fns already include the `/matches` segment, so this is
  // the API origin only (environment.apiBaseUrl == origin + maybe prefix).
  private readonly rootUrl = environment.apiBaseUrl;

  private readonly _current = signal<Match | null>(null);
  readonly current = this._current.asReadonly();

  setCurrent(m: Match | null): void { this._current.set(m); }

  // NOTE on the generated OpenAPI client: most /matches/* methods below
  // keep hand-built HttpClient calls on purpose. The server's OpenAPI
  // document declares no response schema for them, so ng-openapi-gen
  // emits functions that (a) for JSON endpoints typed
  // `StrictHttpResponse<void>` actively DISCARD the body
  // (`clone({ body: undefined })`) — folding list/create/get/join/
  // play-draw/roll/concede would return `undefined` where callers consume
  // a populated Match (e.g. `r.value.id`, `setCurrent(r.value)`); and
  // (b) request `responseType: 'text'`, so on an error response Angular
  // hands `mapError` the raw STRING body instead of the parsed
  // `{ error, detail }` object — collapsing every Result error code to
  // 'unknown' (breaks `commandRejectionMessage`). `getState`/`getReplay`
  // additionally return the generated *Dto shapes, which diverge from the
  // hand-curated GameState / MatchReplay types. Only `listBotArchetypes`
  // (json responseType, body preserved, errors ignored at the call site)
  // is folded onto `../api`.
  async list(): Promise<Result<Match[]>> {
    return this.req(() => firstValueFrom(
      this.http.get<Match[]>(`${this.base}?visibility=public`)));
  }

  // Selectable bot archetypes for the create-match wizard's dropdown.
  // GET /matches/archetypes → [{ key, label }], where key is posted back
  // in botOpponent.archetype and label is the spaced display name. Sourced
  // from the server's BotDeckCatalog so the list stays in sync.
  async listBotArchetypes(): Promise<Result<BotArchetypeDto[]>> {
    return this.req(() => firstValueFrom(
      listBotArchetypes(this.http, this.rootUrl).pipe(map(r => r.body))));
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

  // Push the viewer's auto-pass prefs to the server. The server takes
  // over the auto-pass loop (Slice 5a core); calling this keeps server
  // and client in sync whenever fullControl or phaseStops changes, and
  // once on match-page init so the server has the current prefs from the
  // start.
  //
  // Wire: PUT /matches/{id}/me/prefs → 204 NoContent.
  //
  // TODO(slice5a-deploy): until the companion core PR deploys, this
  //   endpoint will 404 on prod. Failures are caught + logged to the dev
  //   console so the page never breaks. Once the core PR ships, prefs
  //   sync resumes automatically.
  async updateAutoPassPrefs(
    matchId: string,
    prefs: { fullControl: boolean; phaseStops: Record<string, 'mine' | 'theirs'> },
  ): Promise<Result<void>> {
    return this.req(() => firstValueFrom(
      this.http.put<void>(`${this.base}/${matchId}/me/prefs`, prefs)));
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
