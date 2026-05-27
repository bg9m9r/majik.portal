import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../ui/toast.service';
import { PROD_ERROR_MESSAGE } from './prod-error';
import { prodErrorInterceptor } from './prod-error.interceptor';

describe('prodErrorInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let toast: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ToastService,
        provideHttpClient(withInterceptors([prodErrorInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(ToastService);
    vi.useFakeTimers();
  });

  afterEach(() => {
    ctrl.verify();
    vi.useRealTimers();
  });

  it('surfaces a generic toast on a failed response and rethrows', async () => {
    let rejected: unknown = null;
    // A non-match endpoint: the interceptor owns the surface here.
    http.get('/api/decks/abc').subscribe({
      next: () => {},
      error: e => { rejected = e; },
    });
    ctrl.expectOne('/api/decks/abc').flush(
      { error: 'boom', detail: 'db password hunter2' },
      { status: 500, statusText: 'Server Error' },
    );
    await Promise.resolve();
    expect(toast.current()?.message).toBe(PROD_ERROR_MESSAGE);
    expect(toast.current()?.severity).toBe('error');
    expect(rejected).not.toBeNull();
  });

  it('does not toast on a successful response', async () => {
    http.get('/api/matches').subscribe();
    ctrl.expectOne('/api/matches').flush([]);
    await Promise.resolve();
    expect(toast.current()).toBeNull();
  });

  it('never leaks the response body detail into the toast', async () => {
    http.get('/api/x').subscribe({ next: () => {}, error: () => {} });
    ctrl.expectOne('/api/x').flush(
      { detail: 'SELECT * FROM users; secret-token-xyz' },
      { status: 503, statusText: 'Unavailable' },
    );
    await Promise.resolve();
    expect(toast.current()?.message).not.toContain('secret-token-xyz');
    expect(toast.current()?.message).toBe(PROD_ERROR_MESSAGE);
  });

  // --- Important 1: do not double-toast for match command/state paths ---
  // MatchPage surfaces a more-useful, engine-specific message at the call
  // site for these endpoints (refresh / fetchState / send / onConcede). The
  // interceptor must stay silent there so the call-site message wins instead
  // of being overwritten by the generic toast.

  it.each([
    'http://api.test/matches/abc',          // refresh()       — GET  /matches/{id}
    'http://api.test/matches/abc/state',    // fetchState()    — GET  /matches/{id}/state
    'http://api.test/matches/abc/commands', // send()          — POST /matches/{id}/commands
    'http://api.test/matches/abc/concede',  // onConcede()     — POST /matches/{id}/concede
  ])('does NOT toast for the call-site-handled match endpoint %s', async (url) => {
    let rejected: unknown = null;
    http.get(url).subscribe({ next: () => {}, error: e => { rejected = e; } });
    ctrl.expectOne(url).flush(
      { error: 'engine-rejected', detail: 'not your turn' },
      { status: 409, statusText: 'Conflict' },
    );
    await Promise.resolve();
    // No generic toast — the page's own toast carries the engine reason.
    expect(toast.current()).toBeNull();
    // But the error still propagates so the call site can surface it.
    expect(rejected).not.toBeNull();
  });

  it.each([
    'http://api.test/matches?visibility=public', // lobby list — no call-site toast
    'http://api.test/matches',                   // create     — no call-site toast
    'http://api.test/me',                         // profile
    'http://api.test/decks',                      // decks
    'http://api.test/cards?q=bolt',               // card search
  ])('STILL toasts the generic message for non-surfaced endpoint %s', async (url) => {
    http.get(url).subscribe({ next: () => {}, error: () => {} });
    ctrl.expectOne(url).flush(
      { error: 'boom' },
      { status: 500, statusText: 'Server Error' },
    );
    await Promise.resolve();
    expect(toast.current()?.message).toBe(PROD_ERROR_MESSAGE);
  });

  it('still toasts for non-surfaced match lifecycle endpoints (play-draw / roll / join)', async () => {
    http.post('http://api.test/matches/abc/play-draw', {}).subscribe({ next: () => {}, error: () => {} });
    ctrl.expectOne('http://api.test/matches/abc/play-draw').flush(
      { error: 'boom' },
      { status: 500, statusText: 'Server Error' },
    );
    await Promise.resolve();
    expect(toast.current()?.message).toBe(PROD_ERROR_MESSAGE);
  });
});
