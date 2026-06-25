import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ReportDialogComponent } from './report-dialog.component';

describe('ReportDialogComponent', () => {
  function mount() {
    TestBed.configureTestingModule({ imports: [ReportDialogComponent] });
    const fixture = TestBed.createComponent(ReportDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('Submit disabled until description entered, then emits', () => {
    const fixture = mount();
    let emitted: string | null = null;
    fixture.componentInstance.submitReport.subscribe((d: string) => (emitted = d));
    const ta = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    const btn = fixture.nativeElement.querySelector('button[data-test="report-submit"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    ta.value = 'Boltwave froze';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(emitted).toBe('Boltwave froze');
  });

  it('Cancel emits cancel', () => {
    const fixture = mount();
    let cancelled = false;
    fixture.componentInstance.cancel.subscribe(() => (cancelled = true));
    const btn = fixture.nativeElement.querySelector('button[data-test="report-cancel"]') as HTMLButtonElement;
    btn.click();
    expect(cancelled).toBe(true);
  });
});
