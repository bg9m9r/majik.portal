import { Component, inject, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeckEditorStore } from '../../../../core/deck/deck-editor.store';
import { ManaCurveComponent } from './mana-curve.component';
import { ValidationPanelComponent } from './validation-panel.component';

@Component({
  selector: 'app-deck-info-panel',
  standalone: true,
  imports: [FormsModule, ManaCurveComponent, ValidationPanelComponent],
  template: `
    <aside class="flex flex-col gap-4">
      <label class="flex flex-col gap-1">
        <span class="majik-micro">Name</span>
        <input type="text"
               class="rounded border border-[color:var(--majik-line)] bg-black/30 px-3 py-2"
               [ngModel]="store.name()"
               (ngModelChange)="store.rename($event)"
               placeholder="My deck"
               [attr.aria-invalid]="nameTaken() ? 'true' : null" />
        @if (nameTaken()) {
          <span class="text-xs text-red-300">Name already in use.</span>
        }
      </label>

      <div class="flex flex-col gap-1 text-sm">
        <span class="majik-micro">Format</span>
        <span class="opacity-70">Constructed</span>
      </div>

      <div class="flex flex-col gap-1 text-sm">
        <span class="majik-micro">Counts</span>
        <span>Mainboard: {{ store.mainCount() }}</span>
        <span>Sideboard: {{ store.sideCount() }}</span>
      </div>

      <app-mana-curve />

      <app-validation-panel />

      <div class="flex gap-2">
        <button type="button"
                class="rounded border border-[color:var(--majik-accent)] px-4 py-2 text-[color:var(--majik-accent)] hover:bg-[color:var(--majik-accent)]/10 disabled:opacity-40"
                [disabled]="!canSave()"
                (click)="save.emit()">
          {{ store.saving() ? 'Saving…' : 'Save' }}
        </button>
        <button type="button"
                class="rounded border border-[color:var(--majik-line)] px-4 py-2 hover:border-white/40"
                (click)="cancel.emit()">Cancel</button>
      </div>
    </aside>
  `,
})
export class DeckInfoPanelComponent {
  readonly store = inject(DeckEditorStore);
  readonly save = output<void>();
  readonly cancel = output<void>();

  canSave(): boolean {
    return !this.store.saving() && this.store.name().trim().length > 0 && this.store.mainCount() > 0;
  }

  nameTaken(): boolean {
    return this.store.error()?.code === 'name-taken';
  }
}
