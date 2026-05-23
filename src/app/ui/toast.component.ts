import { Component, inject } from '@angular/core';
import { NgClass } from '@angular/common';
import { ToastService, ToastSeverity } from './toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [NgClass],
  template: `
    @if (toast.current(); as t) {
      <div role="status" aria-live="polite"
           class="fixed right-4 top-4 z-50 rounded border px-4 py-2 text-sm shadow"
           [ngClass]="classesFor(t.severity)">
        {{ t.message }}
      </div>
    }
  `,
})
export class ToastComponent {
  readonly toast = inject(ToastService);

  classesFor(severity: ToastSeverity): Record<string, boolean> {
    return {
      'border-red-400': severity === 'error',
      'bg-red-950/80': severity === 'error',
      'text-red-100': severity === 'error',
      'border-amber-400': severity === 'warn',
      'bg-amber-950/80': severity === 'warn',
      'text-amber-100': severity === 'warn',
      'border-[color:var(--majik-line)]': severity === 'info',
      'bg-black/70': severity === 'info',
      'text-white': severity === 'info',
    };
  }
}
