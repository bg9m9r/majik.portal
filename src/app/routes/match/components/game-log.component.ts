import { Component, ElementRef, effect, input, viewChild } from '@angular/core';
import { LogLine } from '../../../core/match/log.types';

// Presentational action-log list. Rows are color-coded by actor
// (self / foe); turn/phase "meta" lines are dimmed. Auto-scrolls to the
// newest entry as the log grows. Visibility + positioning are owned by the
// host (the InfoDrawer's bottom pane) — this component is list-only.
// Bound by the drawer to GameStore.logEntries() + GameStore.selfPlayerIds().
@Component({
  selector: 'app-game-log',
  standalone: true,
  template: `
    <div #scroll class="game-log__scroll" role="log" aria-live="off">
      @for (e of entries(); track e.seq) {
        <div data-log-row class="game-log__row"
             [class.is-self]="isSelf(e)" [class.is-foe]="isFoe(e)"
             [class.is-meta]="e.kind === 'turn' || e.kind === 'phase'">
          {{ e.text }}
        </div>
      } @empty {
        <p class="game-log__empty text-xs opacity-40">No actions yet.</p>
      }
    </div>
  `,
  // .game-log__scroll / __row colour treatment lives in the GLOBAL
  // board.scss; the drawer's bottom pane sizes this container. Only the
  // fill-height + scroll behaviour is co-located so the list fills its pane.
  styles: [`
    .game-log__scroll {
      height: 100%;
      overflow-y: auto;
    }
  `],
})
export class GameLogComponent {
  readonly entries = input<LogLine[]>([]);
  readonly selfIds = input<readonly string[]>([]);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  isSelf(e: LogLine): boolean { return e.actorId != null && this.selfIds().includes(e.actorId); }
  isFoe(e: LogLine): boolean { return e.actorId != null && !this.selfIds().includes(e.actorId); }

  constructor() {
    // Auto-scroll to the newest entry whenever the log grows.
    effect(() => {
      this.entries();               // track
      const el = this.scroll()?.nativeElement;
      if (el) queueMicrotask(() => { el.scrollTop = el.scrollHeight; });
    });
  }
}
