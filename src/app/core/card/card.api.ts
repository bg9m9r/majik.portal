import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Card } from './card.types';

@Injectable({ providedIn: 'root' })
export class CardApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  search(q: string, limit: number, offset: number): Observable<Card[]> {
    const trimmed = q.trim();
    if (!trimmed) return of([]);
    const params = new HttpParams()
      .set('q', trimmed)
      .set('limit', String(limit))
      .set('offset', String(offset))
      .set('implementedOnly', 'true');
    return this.http.get<Card[]>(`${this.base}/cards`, { params });
  }
}
