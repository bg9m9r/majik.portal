import { Component, ElementRef, effect, input, signal, viewChild } from '@angular/core';
import { LogLine } from '../../../core/match/log.types';

// Collapsible right-edge action-log drawer. Closed by default; the tab
// toggles it open. Rows are color-coded by actor (self / foe) and
// turn/phase "meta" lines are dimmed. Auto-scrolls to the newest entry
// while open. Bound by the board to GameStore.logEntries() +
// GameStore.selfPlayerIds().
@Component({
  selector: 'app-game-log',
  standalone: true,
  template: `
    <div class="game-log" [class.game-log--open]="open()">
      <button type="button" class="game-log__tab" (click)="toggle()"
              [attr.aria-expanded]="open()" aria-label="Toggle action log">
        {{ open() ? '›' : '‹' }} Log
      </button>
      @if (open()) {
        <div #scroll class="game-log__scroll" role="log" aria-live="off">
          @for (e of entries(); track e.seq) {
            <div data-log-row class="game-log__row"
                 [class.is-self]="isSelf(e)" [class.is-foe]="isFoe(e)"
                 [class.is-meta]="e.kind === 'turn' || e.kind === 'phase'">
              {{ e.text }}
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class GameLogComponent {
  readonly entries = input<LogLine[]>([]);
  readonly selfIds = input<readonly string[]>([]);
  readonly open = signal(false);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  toggle(): void { this.open.update(o => !o); }

  isSelf(e: LogLine): boolean { return e.actorId != null && this.selfIds().includes(e.actorId); }
  isFoe(e: LogLine): boolean { return e.actorId != null && !this.selfIds().includes(e.actorId); }

  constructor() {
    // Auto-scroll to the newest entry when the log grows and is open.
    effect(() => {
      this.entries();               // track
      if (!this.open()) return;
      const el = this.scroll()?.nativeElement;
      if (el) queueMicrotask(() => { el.scrollTop = el.scrollHeight; });
    });
  }
}
