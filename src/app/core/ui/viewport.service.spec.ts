import { TestBed } from '@angular/core/testing';
import { ViewportService } from './viewport.service';

interface FakeMql {
  matches: boolean;
  listeners: Array<(e: { matches: boolean }) => void>;
}

function installEnv(opts: { coarse: boolean; width: number; height: number }): {
  mql: FakeMql;
  fireResize: (w: number, h: number) => void;
  firePointer: (coarse: boolean) => void;
} {
  const mql: FakeMql = { matches: opts.coarse, listeners: [] };
  (globalThis as any).matchMedia = (q: string) => ({
    matches: q.includes('coarse') ? mql.matches : false,
    media: q,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => mql.listeners.push(cb),
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
      mql.listeners = mql.listeners.filter(l => l !== cb);
    },
  });
  (globalThis as any).innerWidth = opts.width;
  (globalThis as any).innerHeight = opts.height;
  const resizeCbs: Array<() => void> = [];
  const origAdd = globalThis.addEventListener;
  (globalThis as any).addEventListener = (type: string, cb: any) => {
    if (type === 'resize') resizeCbs.push(cb);
    else origAdd.call(globalThis, type, cb);
  };
  return {
    mql,
    fireResize: (w, h) => { (globalThis as any).innerWidth = w; (globalThis as any).innerHeight = h; resizeCbs.forEach(cb => cb()); },
    firePointer: (coarse) => { mql.matches = coarse; mql.listeners.forEach(l => l({ matches: coarse })); },
  };
}

describe('ViewportService', () => {
  it('isMobileBoard is true for coarse pointer on a phone-sized viewport', () => {
    installEnv({ coarse: true, width: 740, height: 360 });
    const vp = TestBed.inject(ViewportService);
    expect(vp.isMobileBoard()).toBe(true);
  });

  it('isMobileBoard is false for a fine pointer (desktop), regardless of size', () => {
    installEnv({ coarse: false, width: 800, height: 400 });
    const vp = TestBed.inject(ViewportService);
    expect(vp.isMobileBoard()).toBe(false);
  });

  it('isMobileBoard is false for coarse pointer on a large (tablet/desktop) viewport', () => {
    installEnv({ coarse: true, width: 1280, height: 800 });
    const vp = TestBed.inject(ViewportService);
    expect(vp.isMobileBoard()).toBe(false);
  });

  it('isPortrait tracks orientation and reacts to resize', () => {
    const env = installEnv({ coarse: true, width: 360, height: 740 });
    const vp = TestBed.inject(ViewportService);
    expect(vp.isPortrait()).toBe(true);
    env.fireResize(740, 360);
    expect(vp.isPortrait()).toBe(false);
  });

  it('reacts when the pointer media query changes', () => {
    const env = installEnv({ coarse: false, width: 740, height: 360 });
    const vp = TestBed.inject(ViewportService);
    expect(vp.isMobileBoard()).toBe(false);
    env.firePointer(true);
    expect(vp.isMobileBoard()).toBe(true);
  });
});
