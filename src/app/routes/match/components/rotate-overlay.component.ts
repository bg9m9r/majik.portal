import { Component, computed, inject } from '@angular/core';
import { ViewportService } from '../../../core/ui/viewport.service';

@Component({
  selector: 'app-rotate-overlay',
  standalone: true,
  template: `
    @if (show()) {
      <div data-testid="rotate-overlay"
           class="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-[color:var(--majik-bg)] p-8 text-center">
        <div class="rotate-icon text-5xl" aria-hidden="true">⟳</div>
        <h2 class="majik-display-3">Rotate to play</h2>
        <p class="text-sm opacity-70">The match board needs landscape. Turn your device sideways.</p>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .rotate-icon { animation: rotate-hint 2s ease-in-out infinite; }
    @keyframes rotate-hint { 0%,100% { transform: rotate(0); } 50% { transform: rotate(90deg); } }
  `],
})
export class RotateOverlayComponent {
  private readonly viewport = inject(ViewportService);
  readonly show = computed(() => this.viewport.isMobileBoard() && this.viewport.isPortrait());
}
