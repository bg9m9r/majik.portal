import { Component, inject } from '@angular/core';
import { CLAMP, LayoutPrefsService } from '../layout-prefs.service';

@Component({
  selector: 'app-layout-controls',
  standalone: true,
  template: `
    <div class="layout-controls flex items-center gap-2 text-xs">
      <label class="flex items-center gap-1">
        <span class="opacity-70">Card size</span>
        <input
          type="range"
          [min]="min"
          [max]="max"
          step="0.05"
          [value]="prefs.cardScale()"
          (input)="onScale($event)"
          aria-label="Card size" />
      </label>
      <button type="button" data-act="reset" class="opacity-70 hover:opacity-100"
              (click)="prefs.reset()">Reset</button>
    </div>
  `,
})
export class LayoutControlsComponent {
  readonly prefs = inject(LayoutPrefsService);
  readonly min = CLAMP.cardScale[0];
  readonly max = CLAMP.cardScale[1];
  onScale(e: Event): void {
    this.prefs.setCardScale(parseFloat((e.target as HTMLInputElement).value));
  }
}
