import { Directive, OnDestroy, output } from '@angular/core';

/**
 * Turns the host element into a vertical drag handle. Emits the signed pixel
 * delta (current clientY - pointerdown clientY) on every pointermove while
 * dragging, and resizeEnd on pointerup. Consumers snapshot their base value
 * on the first delta and clamp. Keyboard: ArrowUp/ArrowDown nudge -/+8px
 * (each followed by resizeEnd so consumers reset their snapshot).
 */
@Directive({
  selector: '[appResizeHandle]',
  standalone: true,
  host: {
    role: 'separator',
    tabindex: '0',
    'aria-orientation': 'horizontal',
    style: 'cursor: row-resize; touch-action: none;',
    '(pointerdown)': 'onDown($event)',
    '(keydown)': 'onKey($event)',
  },
})
export class ResizeHandleDirective implements OnDestroy {
  readonly resizeDelta = output<number>();
  readonly resizeEnd = output<void>();
  private startY = 0;
  private dragging = false;

  // Typed MouseEvent (not PointerEvent) on purpose: PointerEvent extends
  // MouseEvent and we only read clientY, and jsdom (unit-test env) has no
  // PointerEvent constructor — the spec dispatches MouseEvents of pointer*
  // type. Don't "upgrade" these to PointerEvent or the tests break.
  private readonly move = (e: MouseEvent): void => {
    if (!this.dragging) return;
    this.resizeDelta.emit(e.clientY - this.startY);
  };
  private readonly up = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('pointercancel', this.up);
    this.resizeEnd.emit();
  };

  onDown(e: MouseEvent): void {
    e.preventDefault();
    this.startY = e.clientY;
    this.dragging = true;
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    // pointercancel (touch interruption / OS gesture) ends the drag too,
    // so a dropped pointerup can't leave us stuck emitting deltas forever.
    window.addEventListener('pointercancel', this.up);
  }

  onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowUp') { this.resizeDelta.emit(-8); this.resizeEnd.emit(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { this.resizeDelta.emit(8); this.resizeEnd.emit(); e.preventDefault(); }
  }

  ngOnDestroy(): void { this.up(); }
}
