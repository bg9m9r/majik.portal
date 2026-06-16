import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { LayoutControlsComponent } from './layout-controls.component';
import { CLAMP, LayoutPrefsService } from '../layout-prefs.service';

function render() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [LayoutControlsComponent] });
  const fixture = TestBed.createComponent(LayoutControlsComponent);
  fixture.detectChanges();
  return fixture;
}

describe('LayoutControlsComponent', () => {
  // NOTE: inject the service AFTER render() — render() resets the TestBed
  // module, so the component and the test must read the SAME root instance
  // created by that fresh module. (Injecting before render() would hand the
  // test a stale instance from the prior module.)
  it('the slider reflects and updates cardScale', () => {
    const fixture = render();
    const prefs = TestBed.inject(LayoutPrefsService);
    prefs.reset();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input[type="range"]') as HTMLInputElement;
    expect(parseFloat(input.value)).toBeCloseTo(prefs.cardScale());
    input.value = '1.3';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(prefs.cardScale()).toBeCloseTo(1.3);
    prefs.reset();
  });

  it('reset button restores defaults', () => {
    const fixture = render();
    const prefs = TestBed.inject(LayoutPrefsService);
    prefs.setCardScale(1.4);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button[data-act="reset"]') as HTMLButtonElement).click();
    expect(prefs.cardScale()).toBeCloseTo(1.0);
    prefs.reset();
  });

  it('slider min/max derive from CLAMP.cardScale', () => {
    const fixture = render();
    const input = fixture.nativeElement.querySelector('input[type="range"]') as HTMLInputElement;
    expect(parseFloat(input.min)).toBeCloseTo(CLAMP.cardScale[0]);
    expect(parseFloat(input.max)).toBeCloseTo(CLAMP.cardScale[1]);
  });
});
