import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, lastValueFrom } from 'rxjs';
import { describe, expect, it, beforeEach } from 'vitest';
import { DeckApi } from './deck.api';
import { DeckError } from './deck.types';

const dto = (over: Partial<any> = {}) => ({
  id: 'd1', ownerSub: 'u1', name: 'Mono-G', mainboard: [], sideboard: [],
  createdAt: 't', updatedAt: 't', ...over
});

describe('DeckApi', () => {
  let api: DeckApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DeckApi, provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(DeckApi);
    http = TestBed.inject(HttpTestingController);
  });

  it('list GETs /decks', async () => {
    const p = firstValueFrom(api.list());
    http.expectOne(r => r.method === 'GET' && r.url.endsWith('/decks')).flush([dto()]);
    expect((await p)[0].name).toBe('Mono-G');
  });

  it('get GETs /decks/:id', async () => {
    const p = firstValueFrom(api.get('d1'));
    http.expectOne(r => r.method === 'GET' && r.url.endsWith('/decks/d1')).flush(dto());
    expect((await p).id).toBe('d1');
  });

  it('create POSTs /decks', async () => {
    const body = { name: 'X', mainboard: [], sideboard: [] };
    const p = firstValueFrom(api.create(body));
    const req = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/decks'));
    expect(req.request.body).toEqual(body);
    req.flush(dto({ name: 'X' }));
    expect((await p).name).toBe('X');
  });

  it('update PUTs /decks/:id', async () => {
    const body = { name: 'X', mainboard: [], sideboard: [] };
    const p = firstValueFrom(api.update('d1', body));
    http.expectOne(r => r.method === 'PUT' && r.url.endsWith('/decks/d1')).flush(dto());
    await p;
  });

  it('delete DELETEs /decks/:id', async () => {
    const p = lastValueFrom(api.delete('d1'), { defaultValue: undefined });
    http.expectOne(r => r.method === 'DELETE' && r.url.endsWith('/decks/d1')).flush(null);
    await p;
  });

  it('400 invalid-deck carries validation array', async () => {
    const p = firstValueFrom(api.list()).catch(e => e as DeckError);
    http.expectOne(r => r.url.endsWith('/decks'))
      .flush({ error: 'invalid-deck', validation: ['too small'] }, { status: 400, statusText: 'Bad Request' });
    const err = await p;
    expect(err).toEqual({ code: 'invalid-deck', validation: ['too small'], detail: undefined });
  });

  it('404 deck-not-found', async () => {
    const p = firstValueFrom(api.get('x')).catch(e => e as DeckError);
    http.expectOne(r => r.url.endsWith('/decks/x'))
      .flush({ error: 'deck-not-found' }, { status: 404, statusText: 'Not Found' });
    expect((await p as DeckError).code).toBe('deck-not-found');
  });

  it('409 name-taken', async () => {
    const p = firstValueFrom(api.create({ name: 'dup', mainboard: [], sideboard: [] })).catch(e => e as DeckError);
    http.expectOne(r => r.url.endsWith('/decks'))
      .flush({ error: 'name-taken' }, { status: 409, statusText: 'Conflict' });
    expect((await p as DeckError).code).toBe('name-taken');
  });

  it('409 deck-cap-reached', async () => {
    const p = firstValueFrom(api.create({ name: 'n', mainboard: [], sideboard: [] })).catch(e => e as DeckError);
    http.expectOne(r => r.url.endsWith('/decks'))
      .flush({ error: 'deck-cap-reached' }, { status: 409, statusText: 'Conflict' });
    expect((await p as DeckError).code).toBe('deck-cap-reached');
  });

  it('503 mongo-not-configured', async () => {
    const p = firstValueFrom(api.list()).catch(e => e as DeckError);
    http.expectOne(r => r.url.endsWith('/decks'))
      .flush({ error: 'mongo-not-configured' }, { status: 503, statusText: 'Service Unavailable' });
    expect((await p as DeckError).code).toBe('mongo-not-configured');
  });

  it('0 network maps to network', async () => {
    const p = firstValueFrom(api.list()).catch(e => e as DeckError);
    http.expectOne(r => r.url.endsWith('/decks'))
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    expect((await p as DeckError).code).toBe('network');
  });
});
