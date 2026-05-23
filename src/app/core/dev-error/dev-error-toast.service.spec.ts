import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { describe, expect, it, beforeEach, beforeAll } from 'vitest';
import { DevErrorToastService } from './dev-error-toast.service';

// Node's vitest env doesn't always expose localStorage (`jsdom` does in
// theory, but the harness here is configured without storage). Provide an
// in-memory shim so the service's localStorage path is exercised.
beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const mem = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
      clear: () => mem.clear(),
      key: (i: number) => Array.from(mem.keys())[i] ?? null,
      get length() { return mem.size; },
    };
  }
});

describe('DevErrorToastService', () => {
  let svc: DevErrorToastService;

  beforeEach(() => {
    // Default to enabled. Reset between tests.
    localStorage.setItem('majik.devErrorToast', 'on');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [DevErrorToastService] });
    svc = TestBed.inject(DevErrorToastService);
  });

  it('starts empty and enabled by default', () => {
    expect(svc.errors()).toEqual([]);
    expect(svc.enabled()).toBe(true);
    expect(svc.count()).toBe(0);
  });

  it('pushHttpError captures status, URL, method, parsed body, and traceId', () => {
    const err = new HttpErrorResponse({
      status: 500,
      statusText: 'Internal Server Error',
      url: 'https://api.example.com/v1/widgets',
      error: { traceId: 'abc-123', code: 'BOOM', detail: 'something blew up' },
      headers: new HttpHeaders({ 'x-trace': 'abc-123' }),
    });
    // Mimic interceptor stashing the method
    (err as unknown as { method: string }).method = 'POST';

    svc.pushHttpError(err, { foo: 'bar' });

    const list = svc.errors();
    expect(list).toHaveLength(1);
    const rec = list[0];
    expect(rec.kind).toBe('http');
    expect(rec.title).toContain('500');
    expect(rec.title).toContain('POST');
    expect(rec.title).toContain('/v1/widgets');
    expect(rec.detail).toContain('"status": 500');
    expect(rec.detail).toContain('"url": "https://api.example.com/v1/widgets"');
    expect(rec.detail).toContain('"method": "POST"');
    expect(rec.detail).toContain('"traceId": "abc-123"');
    expect(rec.detail).toContain('"errorCode": "BOOM"');
    expect(rec.detail).toContain('"requestBody"');
    expect(rec.detail).toContain('"foo": "bar"');
    expect(rec.detail).toContain('"responseBody"');
    expect(rec.detail).toContain('"detail": "something blew up"');
  });

  it('parses a JSON string body (text responseType case)', () => {
    const err = new HttpErrorResponse({
      status: 400,
      url: '/api/foo',
      error: '{"reason":"missing-field"}',
    });
    svc.pushHttpError(err);
    expect(svc.errors()[0].detail).toContain('"reason": "missing-field"');
  });

  it('falls back to raw string body when not JSON', () => {
    const err = new HttpErrorResponse({
      status: 502,
      url: '/api/foo',
      error: 'plain text gateway error',
    });
    svc.pushHttpError(err);
    expect(svc.errors()[0].detail).toContain('plain text gateway error');
  });

  it('pushJsError captures name/message/stack and userAgent', () => {
    const e = new Error('explode');
    svc.pushJsError(e);
    const rec = svc.errors()[0];
    expect(rec.kind).toBe('js');
    expect(rec.title).toContain('Error');
    expect(rec.title).toContain('explode');
    expect(rec.detail).toContain('"name": "Error"');
    expect(rec.detail).toContain('"message": "explode"');
    expect(rec.detail).toContain('"stack"');
  });

  it('dismiss removes the targeted record by id, others remain', () => {
    svc.pushJsError(new Error('one'));
    svc.pushJsError(new Error('two'));
    svc.pushJsError(new Error('three'));
    const ids = svc.errors().map(e => e.id);
    expect(ids).toHaveLength(3);

    svc.dismiss(ids[1]);
    const remaining = svc.errors();
    expect(remaining).toHaveLength(2);
    expect(remaining.map(e => e.id)).toEqual([ids[0], ids[2]]);
  });

  it('clearAll empties the list', () => {
    svc.pushJsError(new Error('a'));
    svc.pushJsError(new Error('b'));
    expect(svc.errors()).toHaveLength(2);
    svc.clearAll();
    expect(svc.errors()).toEqual([]);
  });

  it('caps stored errors at 50', () => {
    for (let i = 0; i < 80; i++) {
      svc.pushJsError(new Error(`err ${i}`));
    }
    expect(svc.errors()).toHaveLength(50);
    // Oldest dropped — first kept should be err 30.
    expect(svc.errors()[0].title).toContain('err 30');
    expect(svc.errors()[49].title).toContain('err 79');
  });

  it('does not push when disabled', () => {
    svc.setEnabled(false);
    svc.pushJsError(new Error('quiet'));
    svc.pushHttpError(new HttpErrorResponse({ status: 500, url: '/x' }));
    expect(svc.errors()).toEqual([]);
    expect(localStorage.getItem('majik.devErrorToast')).toBe('off');
  });

  it('setEnabled(true) re-enables and persists', () => {
    svc.setEnabled(false);
    svc.setEnabled(true);
    expect(svc.enabled()).toBe(true);
    expect(localStorage.getItem('majik.devErrorToast')).toBe('on');
    svc.pushJsError(new Error('loud'));
    expect(svc.errors()).toHaveLength(1);
  });

  it('assigns monotonically-increasing ids', () => {
    svc.pushJsError(new Error('a'));
    svc.pushJsError(new Error('b'));
    const [a, b] = svc.errors();
    expect(b.id).toBeGreaterThan(a.id);
  });
});
