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

  // ---- Info-drawer prefs (open / bottom-tab / split) ----

  it('info-drawer fields start at defaults', () => {
    const svc = make();
    expect(svc.infoDrawerOpen()).toBe(DEFAULT_LAYOUT_PREFS.infoDrawerOpen);
    expect(svc.infoDrawerTab()).toBe(DEFAULT_LAYOUT_PREFS.infoDrawerTab);
    expect(svc.infoDrawerSplit()).toBe(DEFAULT_LAYOUT_PREFS.infoDrawerSplit);
  });

  it('persists + reloads the info-drawer open flag and active tab', () => {
    const a = make();
    a.setInfoDrawerOpen(true);
    a.setInfoDrawerTab('bot');
    const b = make();
    expect(b.infoDrawerOpen()).toBe(true);
    expect(b.infoDrawerTab()).toBe('bot');
  });

  it('clamps the info-drawer split into [0.2, 0.8]', () => {
    const svc = make();
    svc.setInfoDrawerSplit(0.99);
    expect(svc.infoDrawerSplit()).toBe(0.8);
    svc.setInfoDrawerSplit(0.01);
    expect(svc.infoDrawerSplit()).toBe(0.2);
  });

  it('persists + reloads a clamped split', () => {
    make().setInfoDrawerSplit(0.7);
    expect(make().infoDrawerSplit()).toBe(0.7);
  });

  it('reset() restores the info-drawer fields to defaults', () => {
    const svc = make();
    svc.setInfoDrawerOpen(true);
    svc.setInfoDrawerTab('bot');
    svc.setInfoDrawerSplit(0.7);
    svc.reset();
    expect(svc.infoDrawerOpen()).toBe(DEFAULT_LAYOUT_PREFS.infoDrawerOpen);
    expect(svc.infoDrawerTab()).toBe(DEFAULT_LAYOUT_PREFS.infoDrawerTab);
    expect(svc.infoDrawerSplit()).toBe(DEFAULT_LAYOUT_PREFS.infoDrawerSplit);
  });

  it('backward-compat: a stored blob missing the new keys loads defaults and keeps card-scale', () => {
    // A pre-info-drawer payload (same schema version, no drawer keys).
    localStorage.setItem(
      LAYOUT_PREFS_KEY,
      JSON.stringify({ version: 1, cardScale: 1.3, oppSelfRatio: 0.5, handStripPx: 116 }),
    );
    const svc = make();
    expect(svc.cardScale()).toBe(1.3); // preserved
    expect(svc.infoDrawerOpen()).toBe(DEFAULT_LAYOUT_PREFS.infoDrawerOpen);
    expect(svc.infoDrawerTab()).toBe(DEFAULT_LAYOUT_PREFS.infoDrawerTab);
    expect(svc.infoDrawerSplit()).toBe(DEFAULT_LAYOUT_PREFS.infoDrawerSplit);
  });

  // The card-size slider show/hide state is no longer a persisted pref — it
  // moved to the header cog's ephemeral dropdown (settingsOpen signal in
  // MatchPage). A stored blob that still carries the old `controlsVisible`
  // key is simply ignored by read() (backward-compat, no migration needed).
  it('ignores a legacy controlsVisible key in a stored blob (no longer a pref)', () => {
    localStorage.setItem(
      LAYOUT_PREFS_KEY,
      JSON.stringify({ version: 1, cardScale: 1.25, oppSelfRatio: 0.5, handStripPx: 116, controlsVisible: true }),
    );
    const svc = make();
    expect(svc.cardScale()).toBe(1.25); // preserved
    expect((svc as unknown as Record<string, unknown>)['controlsVisible']).toBeUndefined();
  });
});
