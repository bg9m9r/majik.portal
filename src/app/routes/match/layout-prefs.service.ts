import { Injectable, signal } from '@angular/core';

export const LAYOUT_PREFS_KEY = 'majik.layoutPrefs';
const SCHEMA_VERSION = 1;

export interface LayoutPrefs {
  cardScale: number;    // multiplier on base card size
  oppSelfRatio: number; // opponent's share of the battlefield band (clamped 0.2..0.8)
  handStripPx: number;  // self bottom strip height in px
}

export const DEFAULT_LAYOUT_PREFS: LayoutPrefs = {
  cardScale: 1.0,
  oppSelfRatio: 0.5,
  handStripPx: 116,
};

// Exported so UI controls (e.g. the card-scale slider) derive their
// min/max from the same source of truth instead of re-hardcoding bounds.
export const CLAMP = {
  cardScale: [0.7, 1.4] as const,
  oppSelfRatio: [0.2, 0.8] as const,
  handStripPx: [80, 280] as const,
};

function clamp(n: number, [lo, hi]: readonly [number, number]): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function read(): LayoutPrefs {
  try {
    const raw = globalThis.localStorage?.getItem(LAYOUT_PREFS_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT_PREFS };
    const parsed = JSON.parse(raw) as Partial<LayoutPrefs> & { version?: number };
    if (!parsed || parsed.version !== SCHEMA_VERSION) return { ...DEFAULT_LAYOUT_PREFS };
    return {
      cardScale: clamp(parsed.cardScale ?? DEFAULT_LAYOUT_PREFS.cardScale, CLAMP.cardScale),
      oppSelfRatio: clamp(parsed.oppSelfRatio ?? DEFAULT_LAYOUT_PREFS.oppSelfRatio, CLAMP.oppSelfRatio),
      handStripPx: clamp(parsed.handStripPx ?? DEFAULT_LAYOUT_PREFS.handStripPx, CLAMP.handStripPx),
    };
  } catch {
    return { ...DEFAULT_LAYOUT_PREFS };
  }
}

@Injectable({ providedIn: 'root' })
export class LayoutPrefsService {
  private readonly initial = read();
  readonly cardScale = signal(this.initial.cardScale);
  readonly oppSelfRatio = signal(this.initial.oppSelfRatio);
  readonly handStripPx = signal(this.initial.handStripPx);

  setCardScale(n: number): void { this.cardScale.set(clamp(n, CLAMP.cardScale)); this.persist(); }
  setOppSelfRatio(n: number): void { this.oppSelfRatio.set(clamp(n, CLAMP.oppSelfRatio)); this.persist(); }
  setHandStripPx(n: number): void { this.handStripPx.set(clamp(n, CLAMP.handStripPx)); this.persist(); }

  reset(): void {
    this.cardScale.set(DEFAULT_LAYOUT_PREFS.cardScale);
    this.oppSelfRatio.set(DEFAULT_LAYOUT_PREFS.oppSelfRatio);
    this.handStripPx.set(DEFAULT_LAYOUT_PREFS.handStripPx);
    try { globalThis.localStorage?.removeItem(LAYOUT_PREFS_KEY); } catch { /* storage unavailable */ }
  }

  private persist(): void {
    const payload = {
      version: SCHEMA_VERSION,
      cardScale: this.cardScale(),
      oppSelfRatio: this.oppSelfRatio(),
      handStripPx: this.handStripPx(),
    };
    try {
      globalThis.localStorage?.setItem(LAYOUT_PREFS_KEY, JSON.stringify(payload));
    } catch {
      // storage unavailable (SSR / privacy mode) — ignore
    }
  }
}
