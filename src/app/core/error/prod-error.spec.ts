import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../ui/toast.service';
import { DevToastErrorHandler } from '../dev-error/dev-toast-error-handler';
import { DevErrorToastService } from '../dev-error/dev-error-toast.service';
import {
  PROD_ERROR_MESSAGE,
  ProdErrorHandler,
  safeProdMessage,
} from './prod-error';

describe('safeProdMessage', () => {
  it('returns the generic retry message for an HTTP error', () => {
    const err = new HttpErrorResponse({ status: 500, url: '/api/matches' });
    expect(safeProdMessage(err)).toBe(PROD_ERROR_MESSAGE);
  });

  it('returns the generic retry message for a JS error', () => {
    expect(safeProdMessage(new Error('internal stack frame leak: secret'))).toBe(PROD_ERROR_MESSAGE);
  });

  it('never leaks the underlying error text', () => {
    const msg = safeProdMessage(new Error('DB password is hunter2'));
    expect(msg).not.toContain('hunter2');
    expect(msg).toBe(PROD_ERROR_MESSAGE);
  });

  it('stays short (truncated) so the toast renders on one line', () => {
    expect(safeProdMessage(new Error('x'.repeat(5000))).length).toBeLessThanOrEqual(80);
  });
});

describe('ProdErrorHandler', () => {
  let toast: ToastService;
  let dev: { handleError: ReturnType<typeof vi.fn> };
  let handler: ProdErrorHandler;

  beforeEach(() => {
    dev = { handleError: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        ToastService,
        ProdErrorHandler,
        { provide: DevToastErrorHandler, useValue: dev },
        // DevToastErrorHandler injects DevErrorToastService; provide a stub
        // in case the real class is ever resolved.
        { provide: DevErrorToastService, useValue: { pushJsError: vi.fn(), enabled: () => false } },
      ],
    });
    toast = TestBed.inject(ToastService);
    handler = TestBed.inject(ProdErrorHandler);
    vi.useFakeTimers();
  });

  it('surfaces a generic toast for a JS error', () => {
    handler.handleError(new Error('boom'));
    expect(toast.current()?.message).toBe(PROD_ERROR_MESSAGE);
    expect(toast.current()?.severity).toBe('error');
    vi.useRealTimers();
  });

  it('delegates to the dev handler so dev detail + console.error still happen', () => {
    const e = new Error('boom');
    handler.handleError(e);
    expect(dev.handleError).toHaveBeenCalledWith(e);
    vi.useRealTimers();
  });

  it('does NOT toast for HttpErrorResponse (the interceptor owns those)', () => {
    handler.handleError(new HttpErrorResponse({ status: 500 }));
    expect(toast.current()).toBeNull();
    // still delegated for console + dev detail
    expect(dev.handleError).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('unwraps an rxjs-wrapped HttpErrorResponse and still does not toast', () => {
    const wrapped = { rejection: new HttpErrorResponse({ status: 503 }) };
    handler.handleError(wrapped);
    expect(toast.current()).toBeNull();
    vi.useRealTimers();
  });
});
