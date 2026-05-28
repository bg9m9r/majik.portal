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

  it('submitRoll POSTs /:id/roll and returns ok on 200', async () => {
    const p = svc.submitRoll('m1');
    const req = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/matches/m1/roll'));
    req.flush({ id: 'm1', state: 'Rolling', roll: { creatorRoll: 4, opponentRoll: null, winnerSub: null } });
    const r = await p;
    expect(r.ok).toBe(true);
  });

  it('submitRoll maps 409 not-rolling to error result', async () => {
    const p = svc.submitRoll('m1');
    http.expectOne(r => r.url.endsWith('/matches/m1/roll'))
      .flush({ error: 'not-rolling' }, { status: 409, statusText: 'Conflict' });
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-rolling');
  });

  it('submitRoll maps 403 not-a-player', async () => {
    const p = svc.submitRoll('m1');
    http.expectOne(r => r.url.endsWith('/matches/m1/roll'))
      .flush({ error: 'not-a-player' }, { status: 403, statusText: 'Forbidden' });
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-a-player');
  });

  it('submitRoll maps 0 network to network', async () => {
    const p = svc.submitRoll('m1');
    http.expectOne(r => r.url.endsWith('/matches/m1/roll'))
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('network');
  });

  it('getReplay returns the dto on 200', async () => {
    const p = svc.getReplay('m1');
    const req = http.expectOne(r => r.method === 'GET' && r.url.endsWith('/matches/m1/replay'));
    req.flush({
      matchId: 'm1',
      sealedAt: '2025-01-01T00:00:00Z',
      truncated: false,
      entryCount: 2,
      entries: [
        { seq: 1, at: '2025-01-01T00:00:00Z', kind: 'event', event: { type: 'TurnStartedEvent' }, decision: null },
        { seq: 2, at: '2025-01-01T00:00:01Z', kind: 'bot-decision', event: null, decision: { chosen: 'Pass' } },
      ],
    });
    const r = await p;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.matchId).toBe('m1');
      expect(r.value.entryCount).toBe(2);
      expect(r.value.entries).toHaveLength(2);
    }
  });

  it('getReplay maps 404 match-not-found to error result', async () => {
    const p = svc.getReplay('missing');
    http.expectOne(r => r.method === 'GET' && r.url.endsWith('/matches/missing/replay'))
      .flush({ error: 'match-not-found' }, { status: 404, statusText: 'Not Found' });
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('match-not-found');
  });

  it('getReplay maps 403 forbidden', async () => {
    const p = svc.getReplay('m1');
    http.expectOne(r => r.url.endsWith('/matches/m1/replay'))
      .flush({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('forbidden');
  });

  // --- updateAutoPassPrefs (Slice 5a) ---
  it('updateAutoPassPrefs PUTs /me/prefs and returns ok on 204', async () => {
    const prefs = { fullControl: false, phaseStops: { Untap: 'mine' as const } };
    const p = svc.updateAutoPassPrefs('m1', prefs);
    const req = http.expectOne(r => r.method === 'PUT' && r.url.endsWith('/matches/m1/me/prefs'));
    // Verify the body is the prefs object.
    expect(req.request.body).toEqual(prefs);
    req.flush(null, { status: 204, statusText: 'No Content' });
    const r = await p;
    expect(r.ok).toBe(true);
  });

  it('updateAutoPassPrefs returns ok: false on 404 (pre-deploy window)', async () => {
    // Until the companion core PR deploys the endpoint returns 404.
    // The caller (MatchPage.pushPrefs) catches this and logs to console
    // only — the page must not break.
    const p = svc.updateAutoPassPrefs('m1', { fullControl: false, phaseStops: {} });
    http.expectOne(r => r.url.endsWith('/matches/m1/me/prefs'))
      .flush({ error: 'not-found' }, { status: 404, statusText: 'Not Found' });
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
  });

  it('updateAutoPassPrefs maps network failure to network error', async () => {
    const p = svc.updateAutoPassPrefs('m1', { fullControl: true, phaseStops: {} });
    http.expectOne(r => r.url.endsWith('/matches/m1/me/prefs'))
      .error(new ProgressEvent('error'), { status: 0 });
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('network');
  });
});
