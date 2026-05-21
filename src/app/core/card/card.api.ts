import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CardFilters, Card } from './card.types';

@Injectable({ providedIn: 'root' })
export class CardApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  search(q: string, limit: number, offset: number, filters?: CardFilters, implementedOnly = true): Observable<Card[]> {
    const trimmed = q.trim();
    if (!trimmed && !this.hasAnyFilter(filters)) return of([]);

    let params = new HttpParams()
      .set('q', trimmed)
      .set('limit', String(limit))
      .set('offset', String(offset))
      .set('implementedOnly', String(implementedOnly));

    for (const c of filters?.colors ?? []) params = params.append('colors', c);
    for (const t of filters?.types ?? []) params = params.append('types', t);
    for (const n of filters?.cmc ?? []) params = params.append('cmc', String(n));

    return this.http.get<Card[]>(`${this.base}/cards`, { params });
  }

  getByName(names: string[]): Observable<Card[]> {
    if (!names.length) return of([]);
    return this.http.post<Card[]>(`${this.base}/cards/by-name`, { names });
  }

  private hasAnyFilter(f?: CardFilters): boolean {
    return !!(f?.colors?.length || f?.types?.length || f?.cmc?.length);
  }
}
