import { Component, input, output } from '@angular/core';
import { Match } from '../../../core/match/match.types';

@Component({
  selector: 'app-play-draw-prompt',
  standalone: true,
  template: `
    <div class="mx-auto flex max-w-sm flex-col items-center gap-4 rounded border border-[color:var(--majik-line)] p-6">
      <p class="majik-h3">You won the roll!</p>
      <p class="text-sm opacity-70">Choose to play first or draw an extra card.</p>
      <div class="flex w-full gap-3">
        <button
          type="button"
          class="flex-1 rounded border border-[color:var(--majik-accent)] px-4 py-3 text-sm text-[color:var(--majik-accent)] hover:bg-[color:var(--majik-accent)]/10"
          (click)="choose.emit('play')">
          Play
        </button>
        <button
          type="button"
          class="flex-1 rounded border border-[color:var(--majik-line)] px-4 py-3 text-sm hover:bg-white/5"
          (click)="choose.emit('draw')">
          Draw
        </button>
      </div>
    </div>
  `,
})
export class PlayDrawPromptComponent {
  readonly match = input.required<Match>();
  readonly choose = output<'play' | 'draw'>();
}
