import { Component, ElementRef, computed, inject, input, viewChild } from '@angular/core';
import { LayoutPrefsService } from '../layout-prefs.service';
import { ResizeHandleDirective } from './resize-handle.directive';
import { StackListComponent, StackItemView } from './stack-list.component';
import { GameLogComponent } from './game-log.component';
import { BotDecisionsListComponent } from './bot-decisions-list.component';
import { LogLine } from '../../../core/match/log.types';
import { BotDecision } from '../../../core/match/match.types';

/**
 * Right-edge slide-out drawer consolidating the match's three diagnostic
 * surfaces:
 *   - Stack (top pane, ALWAYS rendered — never miss a cast);
 *   - a draggable vertical split (ResizeHandleDirective); then
 *   - a tabbed bottom pane [ Log | Bot Decisions ].
 *
 * The drawer owns all chrome (edge tab, split, bottom tabs) and the
 * persistence of open/tab/split via LayoutPrefsService; its three children
 * (StackList, GameLog list, BotDecisions list) are purely presentational.
 *
 * Overlays from the right edge (does NOT displace the zone rail / board).
 * Auto-open on cast is driven by the BOARD (an effect that flips
 * LayoutPrefsService.infoDrawerOpen when an object hits the stack) so the
 * drawer stays a dumb shell over its persisted state.
 */
@Component({
  selector: 'app-info-drawer',
  standalone: true,
  imports: [
    ResizeHandleDirective,
    StackListComponent,
    GameLogComponent,
    BotDecisionsListComponent,
  ],
  template: `
    <aside
      class="info-drawer"
      [class.info-drawer--open]="open()"
      aria-label="match info">
      <!--
        Edge tab — the only affordance visible while the drawer is closed.
        Protrudes left from the right edge; click slides the panel in/out.
      -->
      <button
        type="button"
        class="info-drawer__edge-tab"
        [attr.aria-expanded]="open()"
        aria-label="Toggle info drawer"
        (click)="toggle()">
        <span class="info-drawer__edge-glyph" aria-hidden="true">{{ open() ? '›' : '‹' }}</span>
        <span class="info-drawer__edge-label">Info</span>
        @if (stack().length > 0) {
          <span class="info-drawer__edge-count" aria-hidden="true">{{ stack().length }}</span>
        }
      </button>

      @if (open()) {
        <div #panel class="info-drawer__panel">
          <!-- Top pane — Stack (always visible). Sized to the split ratio. -->
          <section
            class="info-drawer__stack-pane"
            [style.flex-basis.%]="splitPct()"
            aria-label="stack">
            <header class="info-drawer__pane-head">
              <span class="info-drawer__pane-title">Stack</span>
              <span class="info-drawer__pane-count">{{ stack().length }}</span>
            </header>
            <div class="info-drawer__pane-body">
              <app-stack-list [items]="stack()" />
            </div>
          </section>

          <!-- Draggable split between the Stack and the bottom pane. -->
          <div
            class="info-drawer__split"
            appResizeHandle
            aria-label="resize stack / log split"
            (resizeDelta)="onSplitResize($event)"
            (resizeEnd)="onSplitResizeEnd()"></div>

          <!-- Bottom pane — tabbed [ Log | Bot Decisions ]. -->
          <section class="info-drawer__bottom-pane" aria-label="log and bot decisions">
            <header class="info-drawer__tab-strip" role="tablist">
              <button
                type="button"
                role="tab"
                class="info-drawer__bottom-tab"
                [class.info-drawer__bottom-tab--active]="tab() === 'log'"
                [attr.aria-selected]="tab() === 'log'"
                (click)="selectTab('log')">
                Log
              </button>
              <button
                type="button"
                role="tab"
                class="info-drawer__bottom-tab"
                [class.info-drawer__bottom-tab--active]="tab() === 'bot'"
                [attr.aria-selected]="tab() === 'bot'"
                (click)="selectTab('bot')">
                Bot Decisions
                @if (botDecisions().length > 0) {
                  <span class="info-drawer__tab-count">{{ botDecisions().length }}</span>
                }
              </button>
            </header>
            <div class="info-drawer__pane-body">
              @if (tab() === 'log') {
                <app-game-log [entries]="logEntries()" [selfIds]="selfIds()" />
              } @else {
                <app-bot-decisions-list [decisions]="botDecisions()" />
              }
            </div>
          </section>
        </div>
      }
    </aside>
  `,
  // Layout/visual chrome co-located in inline styles[] so the drawer is
  // self-contained (it overlays the board; no dependency on board.scss for
  // its own shell). // comments only (jsdom doesn't load external scss, and
  // the @ts/SCSS // form is what the test env tolerates).
  styles: [`
    .info-drawer {
      position: absolute;
      top: 0;
      right: 0;
      height: 100%;
      display: flex;
      align-items: flex-start;
      z-index: 20;
      pointer-events: none; // tab + panel re-enable below
    }
    .info-drawer__edge-tab {
      pointer-events: auto;
      align-self: flex-start;
      margin-top: var(--majik-space-2, 8px);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      writing-mode: vertical-rl;
      padding: var(--majik-space-2, 8px) var(--majik-space-1, 4px);
      background: rgba(0, 0, 0, 0.6);
      border: 1px solid var(--majik-line-faint, rgba(255,255,255,0.12));
      border-right: 0;
      border-radius: var(--majik-radius-panel, 8px) 0 0 var(--majik-radius-panel, 8px);
      color: var(--majik-fg-muted, rgba(255,255,255,0.7));
      font-size: 11px;
      letter-spacing: 0.06em;
      cursor: pointer;
      transition: border-color 200ms ease-out, color 200ms ease-out, background-color 200ms ease-out;
    }
    .info-drawer__edge-tab:hover,
    .info-drawer__edge-tab:focus-visible {
      border-color: var(--majik-accent, rgba(202,167,90,0.7));
      color: var(--majik-accent-strong, #caa75a);
      outline: none;
    }
    .info-drawer__edge-count {
      display: inline-block;
      min-width: 16px;
      padding: 1px 4px;
      border-radius: var(--majik-radius-pill, 999px);
      background: var(--majik-accent-strong, #caa75a);
      color: #1a1a1a;
      font-weight: 700;
      font-size: 10px;
      text-align: center;
      writing-mode: horizontal-tb;
    }
    .info-drawer__panel {
      pointer-events: auto;
      width: 280px;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: rgba(0, 0, 0, 0.78);
      border-left: 1px solid var(--majik-line-faint, rgba(255,255,255,0.12));
      backdrop-filter: blur(4px);
      // Slide-in beat — translates from off the right edge into place.
      animation: info-drawer-slide-in 220ms ease-out both;
    }
    @keyframes info-drawer-slide-in {
      0%   { transform: translateX(16px); opacity: 0; }
      100% { transform: translateX(0); opacity: 1; }
    }
    .info-drawer__stack-pane {
      flex: 0 0 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .info-drawer__bottom-pane {
      flex: 1 1 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .info-drawer__pane-head,
    .info-drawer__tab-strip {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: var(--majik-space-2, 8px);
      padding: 6px var(--majik-space-2, 8px);
      border-bottom: 1px solid var(--majik-line-faint, rgba(255,255,255,0.12));
    }
    .info-drawer__pane-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--majik-fg-muted, rgba(255,255,255,0.7));
    }
    .info-drawer__pane-count,
    .info-drawer__tab-count {
      min-width: 16px;
      padding: 0 5px;
      border-radius: var(--majik-radius-pill, 999px);
      background: rgba(255,255,255,0.08);
      color: var(--majik-fg-muted, rgba(255,255,255,0.7));
      font-size: 10px;
      font-weight: 700;
      text-align: center;
    }
    .info-drawer__pane-body {
      flex: 1 1 0;
      min-height: 0;
      padding: var(--majik-space-2, 8px);
      overflow: hidden;
    }
    .info-drawer__split {
      flex: 0 0 6px;
      cursor: row-resize;
      background: var(--majik-line-faint, rgba(255,255,255,0.08));
      transition: background-color 150ms ease-out;
    }
    .info-drawer__split:hover,
    .info-drawer__split:focus-visible {
      background: var(--majik-accent, rgba(202,167,90,0.6));
      outline: none;
    }
    .info-drawer__bottom-tab {
      appearance: none;
      background: transparent;
      border: 0;
      border-bottom: 2px solid transparent;
      padding: 2px 6px 4px;
      color: var(--majik-fg-muted, rgba(255,255,255,0.55));
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      cursor: pointer;
      transition: color 160ms ease-out, border-color 160ms ease-out;
    }
    .info-drawer__bottom-tab:hover { color: var(--majik-fg, #fff); }
    .info-drawer__bottom-tab--active {
      color: var(--majik-accent-strong, #caa75a);
      border-bottom-color: var(--majik-accent-strong, #caa75a);
    }
  `],
})
export class InfoDrawerComponent {
  readonly stack = input<StackItemView[]>([]);
  readonly logEntries = input<LogLine[]>([]);
  readonly selfIds = input<string[]>([]);
  readonly botDecisions = input<BotDecision[]>([]);

  private readonly prefs = inject(LayoutPrefsService);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  readonly open = this.prefs.infoDrawerOpen;
  readonly tab = this.prefs.infoDrawerTab;
  readonly splitPct = computed(() => this.prefs.infoDrawerSplit() * 100);

  toggle(): void {
    this.prefs.setInfoDrawerOpen(!this.open());
  }

  selectTab(t: 'log' | 'bot'): void {
    this.prefs.setInfoDrawerTab(t);
  }

  // Drag-resize base captured on the first delta of a gesture so the
  // cumulative handle delta applies against a stable start ratio (mirrors
  // the board's centerline handler). Dragging DOWN (positive deltaY) gives
  // the Stack pane MORE height.
  private splitBase: number | null = null;

  onSplitResize(deltaY: number): void {
    const h = this.panel()?.nativeElement.getBoundingClientRect().height || 600;
    this.splitBase ??= this.prefs.infoDrawerSplit();
    this.prefs.setInfoDrawerSplit(this.splitBase + deltaY / h);
  }

  onSplitResizeEnd(): void {
    this.splitBase = null;
  }
}
