import { Component, computed, inject } from '@angular/core';
import { DeckEditorStore } from '../../../../core/deck/deck-editor.store';

@Component({
  selector: 'app-validation-panel',
  standalone: true,
  template: `
    <section class="flex flex-col gap-2">
      <h3 class="majik-h3 opacity-60">Validation</h3>

      @if (serverErrors().length > 0) {
        <ul class="flex flex-col gap-1 rounded border border-red-400/50 bg-red-950/20 p-2">
          @for (msg of serverErrors(); track msg) {
            <li class="text-xs text-red-200">{{ msg }}</li>
          }
        </ul>
      } @else if (clientErrors().length === 0) {
        <p class="text-xs text-emerald-300">All rules pass.</p>
      } @else {
        <ul class="flex flex-col gap-1">
          @for (msg of clientErrors(); track msg) {
            <li class="text-xs text-amber-200/90">{{ msg }}</li>
          }
        </ul>
      }
    </section>
  `,
})
export class ValidationPanelComponent {
  readonly store = inject(DeckEditorStore);
  readonly clientErrors = computed(() => this.store.validation().errors);
  readonly serverErrors = computed(() => {
    const err = this.store.error();
    if (err && err.code === 'invalid-deck' && err.validation) return err.validation;
    return [];
  });
}
