import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, beforeEach } from 'vitest';
import { ProfileService } from './profile.service';
import { AuthService } from '../auth/auth.service';

function makeAuth(stub = false, sub = 'stub-alice'): Partial<AuthService> {
  return {
    isStub: stub,
    principal: signal({ sub } as any),
    token: signal(null),
  };
}

describe('ProfileService', () => {
  let svc: ProfileService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ProfileService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: makeAuth() },
      ],
    });
    svc = TestBed.inject(ProfileService);
    http = TestBed.inject(HttpTestingController);
  });

  it('sets profile on 200', async () => {
    const promise = svc.bootstrap();
    const req = http.expectOne(r => r.method === 'GET' && r.url.endsWith('/me'));
    req.flush({ sub: 'stub-alice', handle: 'Alice', createdAt: 't', updatedAt: 't' });
    await promise;
    expect(svc.profile()?.handle).toBe('Alice');
    expect(svc.isReady()).toBe(true);
  });

  it('leaves profile null on 404', async () => {
    const promise = svc.bootstrap();
    const req = http.expectOne(r => r.method === 'GET' && r.url.endsWith('/me'));
    req.flush({ error: 'no-profile' }, { status: 404, statusText: 'Not Found' });
    await promise;
    expect(svc.profile()).toBeNull();
    expect(svc.isReady()).toBe(true);
  });

  it('synthesizes on 503', async () => {
    const promise = svc.bootstrap();
    const req = http.expectOne(r => r.method === 'GET' && r.url.endsWith('/me'));
    req.flush({ error: 'mongo-not-configured' }, { status: 503, statusText: 'Service Unavailable' });
    await promise;
    expect(svc.profile()?.synthetic).toBe(true);
    expect(svc.profile()?.handle).toBe('stub-alice');
  });

  it('update returns handle-taken on 409', async () => {
    const promise = svc.update('Alice');
    const req = http.expectOne(r => r.method === 'PUT' && r.url.endsWith('/me'));
    req.flush({ error: 'handle-taken' }, { status: 409, statusText: 'Conflict' });
    const result = await promise;
    expect(result).toEqual({ ok: false, error: { code: 'handle-taken' } });
  });

  it('update sets profile on 200', async () => {
    const promise = svc.update('Alice');
    const req = http.expectOne(r => r.method === 'PUT' && r.url.endsWith('/me'));
    req.flush({ sub: 'stub-alice', handle: 'Alice', createdAt: 't', updatedAt: 't' });
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(svc.profile()?.handle).toBe('Alice');
  });
});
