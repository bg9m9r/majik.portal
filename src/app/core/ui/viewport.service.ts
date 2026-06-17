import { Injectable, OnDestroy, computed, signal } from '@angular/core';

// Short-side threshold below which a coarse-pointer device is treated as a
// phone (vs a tablet/touch-laptop). Landscape phones are ~360-430 tall.
const PHONE_SHORT_SIDE_MAX = 540;

@Injectable({ providedIn: 'root' })
export class ViewportService implements OnDestroy {
  private readonly coarse = signal(false);
  private readonly width = signal(0);
  private readonly height = signal(0);
  private readonly teardown: Array<() => void> = [];

  constructor() {
    const mql = globalThis.matchMedia?.('(pointer: coarse)');
    if (mql) {
      this.coarse.set(mql.matches);
      const onChange = (e: MediaQueryListEvent) => this.coarse.set(e.matches);
      mql.addEventListener('change', onChange);
      this.teardown.push(() => mql.removeEventListener('change', onChange));
    }
    const onResize = () => {
      this.width.set(globalThis.innerWidth ?? 0);
      this.height.set(globalThis.innerHeight ?? 0);
    };
    onResize();
    globalThis.addEventListener?.('resize', onResize);
    this.teardown.push(() => globalThis.removeEventListener?.('resize', onResize));
  }

  /** Taller than wide. */
  readonly isPortrait = computed(() => this.height() > this.width());

  /** Coarse pointer on a phone-sized viewport — the only gate for mobile-board behaviour. */
  readonly isMobileBoard = computed(
    () => this.coarse() && Math.min(this.width(), this.height()) <= PHONE_SHORT_SIDE_MAX,
  );

  ngOnDestroy(): void {
    this.teardown.forEach(fn => fn());
    this.teardown.length = 0;
  }
}
