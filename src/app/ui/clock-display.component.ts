import { Component, computed, effect, input, signal } from '@angular/core';

@Component({
  selector: 'app-clock-display',
  standalone: true,
  template: `
    <div class="majik-mono px-2 py-1 rounded text-base"
         [class.text-emerald-300]="band() === 'green'"
         [class.text-amber-300]="band() === 'amber'"
         [class.text-red-400]="band() === 'red'"
         [class.text-red-500]="band() === 'critical'">
      {{ formatted() }}
    </div>
  `,
})
export class ClockDisplayComponent {
  readonly storedMillis = input.required<number>();
  readonly isHolder = input<boolean>(false);
  readonly priorityStartedAt = input<string | null>(null);

  private readonly tick = signal<number>(Date.now());

  constructor() {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    effect(() => {
      const holder = this.isHolder();
      if (holder && !intervalId) {
        intervalId = setInterval(() => this.tick.set(Date.now()), 1000);
      } else if (!holder && intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    });
  }

  private readonly elapsedMillis = computed(() => {
    if (!this.isHolder() || !this.priorityStartedAt()) return 0;
    this.tick(); // re-eval on every tick
    return Math.max(0, Date.now() - new Date(this.priorityStartedAt()!).getTime());
  });

  readonly remainingMillis = computed(() =>
    Math.max(0, this.storedMillis() - this.elapsedMillis()));

  readonly band = computed<'green' | 'amber' | 'red' | 'critical'>(() => {
    const ms = this.remainingMillis();
    if (ms <= 10_000) return 'critical';
    if (ms <= 60_000) return 'red';
    if (ms <= 300_000) return 'amber';
    return 'green';
  });

  readonly formatted = computed(() => {
    const ms = this.remainingMillis();
    if (ms < 60_000) {
      const tenths = Math.floor(ms / 100) / 10;
      return tenths.toFixed(1) + 's';
    }
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  });
}
