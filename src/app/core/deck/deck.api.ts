import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { CreateDeckRequest, Deck, DeckError, DeckErrorCode, UpdateDeckRequest } from './deck.types';

interface DeckErrorWire { error?: string; detail?: string; validation?: string[] }

const KNOWN_CODES: ReadonlySet<DeckErrorCode> = new Set<DeckErrorCode>([
  'invalid-deck', 'name-taken', 'deck-cap-reached', 'deck-not-found',
  'concurrent-edit', 'mongo-not-configured', 'no-profile', 'network', 'unknown',
]);

function mapDeckError(err: unknown): Observable<never> {
  const e = err as HttpErrorResponse;
  const body = (e?.error ?? {}) as DeckErrorWire;
  let code: DeckErrorCode = 'unknown';
  if (e?.status === 0) code = 'network';
  else if (body.error && KNOWN_CODES.has(body.error as DeckErrorCode)) code = body.error as DeckErrorCode;
  else if (e?.status === 404) code = 'deck-not-found';
  else if (e?.status === 503) code = 'mongo-not-configured';
  const out: DeckError = { code };
  if (body.detail) out.detail = body.detail;
  if (body.validation) out.validation = body.validation;
  return throwError(() => out);
}

@Injectable({ providedIn: 'root' })
export class DeckApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  list(): Observable<Deck[]> {
    return this.http.get<Deck[]>(`${this.base}/decks`).pipe(catchError(mapDeckError));
  }

  get(id: string): Observable<Deck> {
    return this.http.get<Deck>(`${this.base}/decks/${encodeURIComponent(id)}`).pipe(catchError(mapDeckError));
  }

  create(body: CreateDeckRequest): Observable<Deck> {
    return this.http.post<Deck>(`${this.base}/decks`, body).pipe(catchError(mapDeckError));
  }

  update(id: string, body: UpdateDeckRequest): Observable<Deck> {
    return this.http.put<Deck>(`${this.base}/decks/${encodeURIComponent(id)}`, body).pipe(catchError(mapDeckError));
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/decks/${encodeURIComponent(id)}`).pipe(catchError(mapDeckError));
  }
}
