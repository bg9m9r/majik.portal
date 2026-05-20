import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it, beforeEach } from 'vitest';
import { CardApi } from './card.api';

describe('CardApi', () => {
  let api: CardApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CardApi, provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(CardApi);
    http = TestBed.inject(HttpTestingController);
  });

  it('search hits /cards with q, limit, offset, implementedOnly=true', async () => {
    const p = firstValueFrom(api.search('Forest', 50, 0));
    const req = http.expectOne(r =>
      r.method === 'GET' &&
      r.url.endsWith('/cards') &&
      r.params.get('q') === 'Forest' &&
      r.params.get('limit') === '50' &&
      r.params.get('offset') === '0' &&
      r.params.get('implementedOnly') === 'true');
    req.flush([{ name: 'Forest', manaCost: '', types: ['Basic', 'Land'], power: null, toughness: null, isImplemented: true }]);
    const cards = await p;
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe('Forest');
  });

  it('search empty query returns empty without HTTP call', async () => {
    const cards = await firstValueFrom(api.search('', 50, 0));
    expect(cards).toEqual([]);
    http.verify();
  });
});
