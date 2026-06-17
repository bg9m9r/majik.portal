import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { RotateOverlayComponent } from './rotate-overlay.component';
import { ViewportService } from '../../../core/ui/viewport.service';

function vpStub(isMobile: boolean, isPortrait: boolean) {
  return { isMobileBoard: signal(isMobile), isPortrait: signal(isPortrait) } as unknown as ViewportService;
}

describe('RotateOverlayComponent', () => {
  function render(isMobile: boolean, isPortrait: boolean) {
    TestBed.configureTestingModule({
      providers: [{ provide: ViewportService, useValue: vpStub(isMobile, isPortrait) }],
    });
    const f = TestBed.createComponent(RotateOverlayComponent);
    f.detectChanges();
    return f;
  }

  it('shows when mobile + portrait', () => {
    const f = render(true, true);
    expect(f.nativeElement.textContent).toContain('Rotate');
  });

  it('hidden when mobile + landscape', () => {
    const f = render(true, false);
    expect(f.nativeElement.querySelector('[data-testid="rotate-overlay"]')).toBeNull();
  });

  it('hidden on desktop', () => {
    const f = render(false, true);
    expect(f.nativeElement.querySelector('[data-testid="rotate-overlay"]')).toBeNull();
  });
});
