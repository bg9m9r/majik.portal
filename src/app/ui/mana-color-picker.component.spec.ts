import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ManaColorPickerComponent } from './mana-color-picker.component';

function render(colors: string, anchorRect: DOMRect | null = new DOMRect(100, 200, 80, 112)) {
  TestBed.configureTestingModule({ imports: [ManaColorPickerComponent] });
  const fixture = TestBed.createComponent(ManaColorPickerComponent);
  fixture.componentRef.setInput('colors', colors);
  fixture.componentRef.setInput('anchorRect', anchorRect);
  fixture.detectChanges();
  return fixture;
}

describe('ManaColorPickerComponent', () => {
  it('renders one chip per color symbol', () => {
    const fixture = render('BG');
    const chips = fixture.nativeElement.querySelectorAll('button');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent?.trim()).toBe('B');
    expect(chips[1].textContent?.trim()).toBe('G');
  });

  it('skips unknown color tokens', () => {
    const fixture = render('WZQ');
    const chips = fixture.nativeElement.querySelectorAll('button');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent?.trim()).toBe('W');
  });

  it('emits colorSelected with the chip symbol on click', () => {
    const fixture = render('BG');
    const picked: string[] = [];
    fixture.componentInstance.colorSelected.subscribe(c => picked.push(c));
    const chips = fixture.nativeElement.querySelectorAll('button');
    chips[1].click();
    expect(picked).toEqual(['G']);
  });

  it('emits dismiss on Escape keydown', () => {
    const fixture = render('R');
    let dismissed = 0;
    fixture.componentInstance.dismiss.subscribe(() => dismissed++);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dismissed).toBe(1);
  });

  it('emits dismiss on outside mousedown but not inside', () => {
    const fixture = render('R');
    let dismissed = 0;
    fixture.componentInstance.dismiss.subscribe(() => dismissed++);
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(dismissed).toBe(1);
    const chip = fixture.nativeElement.querySelector('button') as HTMLElement;
    chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(dismissed).toBe(1);
    outside.remove();
  });

  it('positions above the anchor by default and flips below near the top', () => {
    const fixture = render('R', new DOMRect(100, 200, 80, 112));
    const pos1 = fixture.componentInstance.position();
    expect(pos1.top).toBeLessThan(200);

    fixture.componentRef.setInput('anchorRect', new DOMRect(100, 0, 80, 112));
    fixture.detectChanges();
    const pos2 = fixture.componentInstance.position();
    expect(pos2.top).toBeGreaterThanOrEqual(112);
  });
});
