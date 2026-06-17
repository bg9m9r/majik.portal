import { Directive, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, inject } from '@angular/core';

const MOVE_CANCEL_PX = 10;

@Directive({
  selector: '[appLongPress]',
  standalone: true,
  host: {
    '(pointerdown)': 'onDown($event)',
    '(pointermove)': 'onMove($event)',
    '(pointerup)': 'cancel()',
    '(pointercancel)': 'cancel()',
    '(pointerleave)': 'cancel()',
  },
})
export class LongPressDirective implements OnInit, OnDestroy {
  @Input() longPressDelayMs = 400;
  @Output() longPress = new EventEmitter<Event>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startX = 0;
  private startY = 0;
  private down: Event | null = null;
  private suppressNextClick = false;

  ngOnInit(): void {
    this.host.nativeElement.addEventListener('click', this.clickGuard, true); // capture phase
  }

  onDown(e: Event): void {
    this.down = e;
    this.startX = (e as { clientX?: number }).clientX ?? 0;
    this.startY = (e as { clientY?: number }).clientY ?? 0;
    this.timer = setTimeout(() => {
      if (this.down) {
        this.suppressNextClick = true;
        this.longPress.emit(this.down);
      }
      this.cancel();
    }, this.longPressDelayMs);
  }

  onMove(e: Event): void {
    if (!this.timer) return;
    const x = (e as { clientX?: number }).clientX ?? 0;
    const y = (e as { clientY?: number }).clientY ?? 0;
    if (Math.abs(x - this.startX) > MOVE_CANCEL_PX || Math.abs(y - this.startY) > MOVE_CANCEL_PX) {
      this.cancel();
    }
  }

  cancel(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.down = null;
  }

  private readonly clickGuard = (e: Event): void => {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  };

  ngOnDestroy(): void {
    this.cancel();
    this.host.nativeElement.removeEventListener('click', this.clickGuard, true);
  }
}
