import { describe, expect, it } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ResizeHandleDirective } from './resize-handle.directive';

@Component({
  standalone: true,
  imports: [ResizeHandleDirective],
  template: `<div appResizeHandle (resizeDelta)="last = $event" (resizeEnd)="ended = ended + 1"></div>`,
})
class HostCmp { last = 0; ended = 0; }

function ptr(type: string, y: number): MouseEvent {
  return new MouseEvent(type, { clientY: y, bubbles: true });
}

describe('ResizeHandleDirective', () => {
  it('emits the cumulative vertical delta from pointerdown through pointermove', () => {
    const fixture = TestBed.createComponent(HostCmp);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('div') as HTMLElement;
    el.dispatchEvent(ptr('pointerdown', 100));
    window.dispatchEvent(ptr('pointermove', 130));
    expect(fixture.componentInstance.last).toBe(30);
    window.dispatchEvent(ptr('pointermove', 90));
    expect(fixture.componentInstance.last).toBe(-10);
  });

  it('stops emitting after pointerup and fires resizeEnd', () => {
    const fixture = TestBed.createComponent(HostCmp);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('div') as HTMLElement;
    el.dispatchEvent(ptr('pointerdown', 100));
    window.dispatchEvent(ptr('pointerup', 100));
    expect(fixture.componentInstance.ended).toBe(1);
    fixture.componentInstance.last = 0;
    window.dispatchEvent(ptr('pointermove', 200));
    expect(fixture.componentInstance.last).toBe(0);
  });

  it('keyboard ArrowUp/ArrowDown nudge ±8 and fire resizeEnd', () => {
    const fixture = TestBed.createComponent(HostCmp);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('div') as HTMLElement;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(fixture.componentInstance.last).toBe(8);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(fixture.componentInstance.last).toBe(-8);
    expect(fixture.componentInstance.ended).toBe(2);
  });
});
