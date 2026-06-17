import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LongPressDirective } from './long-press.directive';

@Component({
  standalone: true,
  imports: [LongPressDirective],
  template: `<div appLongPress (longPress)="fired = fired + 1" (click)="clicked = clicked + 1" [longPressDelayMs]="50"></div>`,
})
class Host { fired = 0; clicked = 0; }

function ptr(type: string, x = 0, y = 0): Event {
  // jsdom may lack a PointerEvent constructor; fall back to a MouseEvent-like event with coords.
  try {
    return new PointerEvent(type, { clientX: x, clientY: y, bubbles: true } as PointerEventInit);
  } catch {
    const e = new Event(type, { bubbles: true });
    Object.defineProperty(e, 'clientX', { value: x });
    Object.defineProperty(e, 'clientY', { value: y });
    return e;
  }
}

describe('LongPressDirective', () => {
  function setup() {
    const f = TestBed.configureTestingModule({ imports: [Host] }).createComponent(Host);
    f.detectChanges();
    return { f, el: f.nativeElement.querySelector('div') as HTMLElement };
  }

  it('emits longPress after the delay with no movement', async () => {
    const { f, el } = setup();
    el.dispatchEvent(ptr('pointerdown', 10, 10));
    await new Promise(r => setTimeout(r, 80));
    expect(f.componentInstance.fired).toBe(1);
  });

  it('does not emit if released before the delay', async () => {
    const { f, el } = setup();
    el.dispatchEvent(ptr('pointerdown', 10, 10));
    el.dispatchEvent(ptr('pointerup', 10, 10));
    await new Promise(r => setTimeout(r, 80));
    expect(f.componentInstance.fired).toBe(0);
  });

  it('cancels if the pointer moves past the threshold (treated as scroll)', async () => {
    const { f, el } = setup();
    el.dispatchEvent(ptr('pointerdown', 10, 10));
    el.dispatchEvent(ptr('pointermove', 60, 10));
    await new Promise(r => setTimeout(r, 80));
    expect(f.componentInstance.fired).toBe(0);
  });

  it('swallows the trailing click after a long-press fires', async () => {
    const { f, el } = setup();
    el.dispatchEvent(ptr('pointerdown', 10, 10));
    await new Promise(r => setTimeout(r, 80)); // long-press fires
    el.dispatchEvent(ptr('pointerup', 10, 10));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(f.componentInstance.fired).toBe(1);
    expect(f.componentInstance.clicked).toBe(0); // trailing click suppressed
  });

  it('does NOT swallow the click of a normal short tap', async () => {
    const { f, el } = setup();
    el.dispatchEvent(ptr('pointerdown', 10, 10));
    el.dispatchEvent(ptr('pointerup', 10, 10));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 80));
    expect(f.componentInstance.fired).toBe(0);
    expect(f.componentInstance.clicked).toBe(1); // normal tap's click passes through
  });
});
