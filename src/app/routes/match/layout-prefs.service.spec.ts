import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { LayoutPrefsService, LAYOUT_PREFS_KEY, DEFAULT_LAYOUT_PREFS } from './layout-prefs.service';

beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const mem = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
      clear: () => mem.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  }
});

function make(): LayoutPrefsService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [LayoutPrefsService] });
  return TestBed.inject(LayoutPrefsService);
}

describe('LayoutPrefsService', () => {
  beforeEach(() => localStorage.removeItem(LAYOUT_PREFS_KEY));

  it('starts at defaults when nothing is stored', () => {
    const svc = make();
    expect(svc.cardScale()).toBe(DEFAULT_LAYOUT_PREFS.cardScale);
    expect(svc.oppSelfRatio()).toBe(DEFAULT_LAYOUT_PREFS.oppSelfRatio);
    expect(svc.handStripPx()).toBe(DEFAULT_LAYOUT_PREFS.handStripPx);
  });

  it('persists a change and reloads it', () => {
    make().setCardScale(1.3);
    expect(make().cardScale()).toBe(1.3);
  });

  it('clamps out-of-range values on set', () => {
    const svc = make();
    svc.setCardScale(99);
    svc.setOppSelfRatio(-1);
    svc.setHandStripPx(99999);
    expect(svc.cardScale()).toBe(1.4);     // max
    expect(svc.oppSelfRatio()).toBe(0.2);  // min
    expect(svc.handStripPx()).toBe(280);   // max
  });

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem(LAYOUT_PREFS_KEY, '{not json');
    expect(make().cardScale()).toBe(DEFAULT_LAYOUT_PREFS.cardScale);
  });

  it('discards stored prefs from a different schema version', () => {
    localStorage.setItem(LAYOUT_PREFS_KEY, JSON.stringify({ version: 0, cardScale: 1.3 }));
    expect(make().cardScale()).toBe(DEFAULT_LAYOUT_PREFS.cardScale);
  });

  it('reset() returns everything to defaults and clears storage', () => {
    const svc = make();
    svc.setCardScale(1.3);
    svc.reset();
    expect(svc.cardScale()).toBe(DEFAULT_LAYOUT_PREFS.cardScale);
    expect(localStorage.getItem(LAYOUT_PREFS_KEY)).toBeNull();
  });
});
