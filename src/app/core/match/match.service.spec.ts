import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { MatchService } from './match.service';

describe('MatchService', () => {
  let svc: MatchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MatchService, provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(MatchService);
    http = TestBed.inject(HttpTestingController);
  });

  it('list returns the array on 200', async () => {
    const promise = svc.list();
    const req = http.expectOne(r => r.method === 'GET' && r.url.endsWith('/matches?visibility=public'));
    req.flush([{ id: 'abc', status: 'open' } as any]);
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.length).toBe(1);
  });

  it('create returns the match on 201', async () => {
    const promise = svc.create({ clockMinutes: 10 } as any);
    const req = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/matches'));
    req.flush({ id: 'xyz', status: 'open' } as any, { status: 201, statusText: 'Created' });
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe('xyz');
  });

  it('create returns invalid-clock-minutes on 400', async () => {
    const promise = svc.create({ clockMinutes: -1 } as any);
    const req = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/matches'));
    req.flush({ error: 'invalid-clock-minutes' }, { status: 400, statusText: 'Bad Request' });
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-clock-minutes');
  });

  it('join returns match-not-open on 409', async () => {
    const promise = svc.join('abc', {} as any);
    const req = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/matches/abc/join'));
    req.flush({ error: 'match-not-open' }, { status: 409, statusText: 'Conflict' });
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('match-not-open');
  });

  it('503 maps to mongo-not-configured', async () => {
    const promise = svc.create({ clockMinutes: 10 } as any);
    const req = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/matches'));
    req.flush({ error: 'mongo-not-configured' }, { status: 503, statusText: 'Service Unavailable' });
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('mongo-not-configured');
  });

  it('network failure (status 0) maps to network', async () => {
    const promise = svc.create({ clockMinutes: 10 } as any);
    const req = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/matches'));
    req.error(new ProgressEvent('error'), { status: 0 });
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('network');
  });
});
