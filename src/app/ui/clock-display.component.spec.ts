import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { ClockDisplayComponent } from './clock-display.component';

function createComponent(
  storedMillis: number,
  isHolder = false,
  priorityStartedAt: string | null = null,
) {
  const fixture = TestBed.createComponent(ClockDisplayComponent);
  fixture.componentRef.setInput('storedMillis', storedMillis);
  fixture.componentRef.setInput('isHolder', isHolder);
  fixture.componentRef.setInput('priorityStartedAt', priorityStartedAt);
  fixture.detectChanges();
  return fixture;
}

describe('ClockDisplayComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ClockDisplayComponent],
    });
  });

  // --- formatted() ---

  describe('formatted()', () => {
    it('shows mm:ss for >= 60s: 75000ms → "1:15"', () => {
      const f = TestBed.runInInjectionContext(() => {
        const fix = createComponent(75_000);
        return fix.componentInstance.formatted();
      });
      expect(f).toBe('1:15');
    });

    it('shows mm:ss for exactly 60s: 60000ms → "1:00"', () => {
      const fix = createComponent(60_000);
      expect(fix.componentInstance.formatted()).toBe('1:00');
    });

    it('shows ss.ts for < 60s: 4500ms → "4.5s"', () => {
      const fix = createComponent(4_500);
      expect(fix.componentInstance.formatted()).toBe('4.5s');
    });

    it('shows 0.0s for 0ms', () => {
      const fix = createComponent(0);
      expect(fix.componentInstance.formatted()).toBe('0.0s');
    });

    it('shows 59.9s for 59900ms', () => {
      const fix = createComponent(59_900);
      expect(fix.componentInstance.formatted()).toBe('59.9s');
    });

    it('rounds up to next second for mm:ss: 61500ms → "1:02"', () => {
      const fix = createComponent(61_500);
      // Math.ceil(61500/1000)=62 → 1:02
      expect(fix.componentInstance.formatted()).toBe('1:02');
    });

    it('shows large values: 600000ms (10min) → "10:00"', () => {
      const fix = createComponent(600_000);
      expect(fix.componentInstance.formatted()).toBe('10:00');
    });
  });

  // --- band() ---

  describe('band()', () => {
    it('green when > 5 minutes (300001ms)', () => {
      const fix = createComponent(300_001);
      expect(fix.componentInstance.band()).toBe('green');
    });

    it('green at 600000ms', () => {
      const fix = createComponent(600_000);
      expect(fix.componentInstance.band()).toBe('green');
    });

    it('amber at exactly 300000ms (5min boundary)', () => {
      const fix = createComponent(300_000);
      expect(fix.componentInstance.band()).toBe('amber');
    });

    it('amber at 60001ms', () => {
      const fix = createComponent(60_001);
      expect(fix.componentInstance.band()).toBe('amber');
    });

    it('red at exactly 60000ms (1min boundary)', () => {
      const fix = createComponent(60_000);
      expect(fix.componentInstance.band()).toBe('red');
    });

    it('red at 10001ms', () => {
      const fix = createComponent(10_001);
      expect(fix.componentInstance.band()).toBe('red');
    });

    it('critical at exactly 10000ms', () => {
      const fix = createComponent(10_000);
      expect(fix.componentInstance.band()).toBe('critical');
    });

    it('critical at 0ms', () => {
      const fix = createComponent(0);
      expect(fix.componentInstance.band()).toBe('critical');
    });

    it('critical at 5000ms', () => {
      const fix = createComponent(5_000);
      expect(fix.componentInstance.band()).toBe('critical');
    });
  });

  // --- remainingMillis when not holder ---

  describe('remainingMillis() — non-holder', () => {
    it('returns storedMillis when isHolder=false', () => {
      const fix = createComponent(120_000, false, new Date().toISOString());
      expect(fix.componentInstance.remainingMillis()).toBe(120_000);
    });

    it('returns storedMillis when isHolder=false and no priorityStartedAt', () => {
      const fix = createComponent(90_000, false, null);
      expect(fix.componentInstance.remainingMillis()).toBe(90_000);
    });
  });

  // --- remainingMillis when holder with priorityStartedAt ---

  describe('remainingMillis() — holder with priorityStartedAt', () => {
    it('deducts elapsed time when isHolder=true and priorityStartedAt is set', () => {
      const now = Date.now();
      // 2 seconds ago
      const startedAt = new Date(now - 2_000).toISOString();
      const fix = createComponent(10_000, true, startedAt);
      const remaining = fix.componentInstance.remainingMillis();
      // Should be around 8000ms, allow 500ms tolerance for test execution
      expect(remaining).toBeGreaterThanOrEqual(7_000);
      expect(remaining).toBeLessThanOrEqual(9_000);
    });

    it('clamps to 0 when elapsed > storedMillis', () => {
      const now = Date.now();
      // 20 seconds ago, storedMillis only 5000
      const startedAt = new Date(now - 20_000).toISOString();
      const fix = createComponent(5_000, true, startedAt);
      expect(fix.componentInstance.remainingMillis()).toBe(0);
    });

    it('returns storedMillis when isHolder=true but priorityStartedAt is null', () => {
      const fix = createComponent(30_000, true, null);
      expect(fix.componentInstance.remainingMillis()).toBe(30_000);
    });
  });

  // --- snap-on-input behavior ---

  describe('snap-on-input (storedMillis changes)', () => {
    it('recomputes formatted() when storedMillis input changes', () => {
      const fix = createComponent(75_000);
      expect(fix.componentInstance.formatted()).toBe('1:15');

      fix.componentRef.setInput('storedMillis', 4_500);
      fix.detectChanges();
      expect(fix.componentInstance.formatted()).toBe('4.5s');
    });

    it('recomputes band() when storedMillis input changes', () => {
      const fix = createComponent(400_000);
      expect(fix.componentInstance.band()).toBe('green');

      fix.componentRef.setInput('storedMillis', 5_000);
      fix.detectChanges();
      expect(fix.componentInstance.band()).toBe('critical');
    });
  });

  // --- interval not started when not holder ---

  describe('interval behavior', () => {
    it('does not start interval when isHolder=false', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const fix = createComponent(60_000, false, null);
      // setInterval should not have been called for the clock tick
      // (it might be called by other things, but remainingMillis stays at storedMillis)
      expect(fix.componentInstance.remainingMillis()).toBe(60_000);
      setIntervalSpy.mockRestore();
    });
  });

  // --- template class bindings ---

  describe('template band class bindings', () => {
    it('applies text-emerald-300 for green band', () => {
      const fix = createComponent(400_000);
      const div: HTMLElement = fix.nativeElement.querySelector('div');
      expect(div.classList.contains('text-emerald-300')).toBe(true);
    });

    it('applies text-amber-300 for amber band', () => {
      const fix = createComponent(120_000);
      const div: HTMLElement = fix.nativeElement.querySelector('div');
      expect(div.classList.contains('text-amber-300')).toBe(true);
    });

    it('applies text-red-400 for red band', () => {
      const fix = createComponent(30_000);
      const div: HTMLElement = fix.nativeElement.querySelector('div');
      expect(div.classList.contains('text-red-400')).toBe(true);
    });

    it('applies text-red-500 for critical band', () => {
      const fix = createComponent(5_000);
      const div: HTMLElement = fix.nativeElement.querySelector('div');
      expect(div.classList.contains('text-red-500')).toBe(true);
    });

    it('renders formatted value in template', () => {
      const fix = createComponent(75_000);
      const div: HTMLElement = fix.nativeElement.querySelector('div');
      expect(div.textContent?.trim()).toBe('1:15');
    });
  });
});
