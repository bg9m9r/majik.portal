import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let svc: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ToastService] });
    svc = TestBed.inject(ToastService);
    vi.useFakeTimers();
  });

  it('starts empty', () => {
    expect(svc.current()).toBeNull();
  });

  it('error sets toast with error severity', () => {
    svc.error('boom');
    expect(svc.current()).toEqual({ message: 'boom', severity: 'error' });
  });

  it('info sets toast with info severity', () => {
    svc.info('hello');
    expect(svc.current()?.severity).toBe('info');
  });

  it('warn sets toast with warn severity', () => {
    svc.warn('careful');
    expect(svc.current()).toEqual({ message: 'careful', severity: 'warn' });
  });

  it('clears after 3000ms', () => {
    svc.error('boom');
    vi.advanceTimersByTime(2999);
    expect(svc.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(svc.current()).toBeNull();
  });

  it('new toast overwrites prior', () => {
    svc.error('first');
    svc.info('second');
    expect(svc.current()?.message).toBe('second');
    expect(svc.current()?.severity).toBe('info');
  });

  it('show() defaults to info severity and 3000ms duration', () => {
    svc.show('plain');
    expect(svc.current()).toEqual({ message: 'plain', severity: 'info' });
    vi.advanceTimersByTime(2999);
    expect(svc.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(svc.current()).toBeNull();
  });

  it('show() respects an explicit durationMs', () => {
    svc.show('long', { severity: 'info', durationMs: 3500 });
    vi.advanceTimersByTime(3499);
    expect(svc.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(svc.current()).toBeNull();
  });

  it('show() respects an explicit severity', () => {
    svc.show('whoops', { severity: 'warn' });
    expect(svc.current()?.severity).toBe('warn');
  });
});
