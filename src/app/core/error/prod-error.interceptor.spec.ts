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
    http.get('/api/matches/abc').subscribe({
      next: () => {},
      error: e => { rejected = e; },
    });
    ctrl.expectOne('/api/matches/abc').flush(
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
});
