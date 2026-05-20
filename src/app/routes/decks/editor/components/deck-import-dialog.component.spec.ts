import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { describe, expect, it } from 'vitest';
import { DeckImportDialogComponent } from './deck-import-dialog.component';

function render() {
  TestBed.configureTestingModule({
    imports: [DeckImportDialogComponent],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const fx = TestBed.createComponent(DeckImportDialogComponent);
  fx.detectChanges();
  return { fx, http: TestBed.inject(HttpTestingController) };
}

describe('DeckImportDialogComponent', () => {
  it('disables Parse when textarea is empty', () => {
    const { fx } = render();
    const parseBtn = fx.nativeElement.querySelector('button[data-action="parse"]') as HTMLButtonElement;
    expect(parseBtn.disabled).toBe(true);
  });

  it('parse populates summary on 200', async () => {
    const { fx, http } = render();
    fx.componentInstance.text.set('60 Forest');
    fx.detectChanges();

    const parseBtn = fx.nativeElement.querySelector('button[data-action="parse"]') as HTMLButtonElement;
    parseBtn.click();
    fx.detectChanges();

    const req = http.expectOne(r => r.url.endsWith('/decks/parse'));
    req.flush({ mainboard: [{ name: 'Forest', count: 60 }], sideboard: [], unknown: [], warnings: [] });
    await Promise.resolve();
    fx.detectChanges();
    await Promise.resolve();
    fx.detectChanges();

    expect(fx.nativeElement.textContent).toContain('Mainboard: 60 cards');
  });

  it('apply emits parsed mainboard/sideboard', async () => {
    const { fx, http } = render();
    let emitted: any = null;
    fx.componentInstance.apply.subscribe((e: any) => (emitted = e));

    fx.componentInstance.text.set('60 Forest');
    fx.detectChanges();
    (fx.nativeElement.querySelector('button[data-action="parse"]') as HTMLButtonElement).click();
    fx.detectChanges();

    http.expectOne(r => r.url.endsWith('/decks/parse'))
      .flush({ mainboard: [{ name: 'Forest', count: 60 }], sideboard: [], unknown: [], warnings: [] });
    await Promise.resolve();
    fx.detectChanges();
    await Promise.resolve();
    fx.detectChanges();

    (fx.nativeElement.querySelector('button[data-action="apply"]') as HTMLButtonElement).click();

    expect(emitted).toBeTruthy();
    expect(emitted.mainboard[0].name).toBe('Forest');
  });

  it('cancel emits cancel event', () => {
    const { fx } = render();
    let cancelled = false;
    fx.componentInstance.cancel.subscribe(() => (cancelled = true));
    (fx.nativeElement.querySelector('button[data-action="cancel"]') as HTMLButtonElement).click();
    expect(cancelled).toBe(true);
  });
});
