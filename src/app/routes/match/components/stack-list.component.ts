import { Component, input } from '@angular/core';
import { StackItem } from '../../../core/match/match.types';

/**
 * A `StackItem` enriched with display flags the stack list + the
 * awaiting-priority callout consume. `mine` / `isOpponent` are derived from
 * `controllerId` vs the local seat; `label` is the friendliest available
 * name (card name → description → kind).
 *
 * Lives here (rather than the board) so the presentational StackList owns the
 * shape it renders and the board imports it back without a circular reference.
 */
export interface StackItemView extends StackItem {
  mine: boolean;
  isOpponent: boolean;
  controllerName: string | null;
  label: string;
}

/**
 * Presentational stack list. Renders one row per stack object, newest-first
 * (the caller supplies the reversed projection), with the top-of-stack
 * marked as "next" to resolve. Triggered abilities + opponent-controlled
 * objects get distinctive tints (CSS in board.scss, applied globally).
 *
 * Pure: no state, no store — the InfoDrawer (and any other host) feeds it
 * `items`. Extracted out of the board's old `.stack-chip` aside.
 */
@Component({
  selector: 'app-stack-list',
  standalone: true,
  template: `
    <div class="stack-list" role="list" aria-label="stack">
      @for (item of items(); track item.id; let i = $index) {
        <div
          role="listitem"
          class="stack-item py-1 text-xs"
          [class.stack-item--top]="i === 0"
          [class.stack-item--trigger]="item.kind === 'TriggeredAbility'"
          [class.stack-item--opponent]="item.isOpponent"
          [class.stack-item--mine]="item.mine"
          [attr.data-stack-kind]="item.kind"
          [attr.data-stack-controller]="item.isOpponent ? 'opponent' : (item.mine ? 'self' : null)"
          animate.enter="stack-item-enter"
          animate.leave="stack-item-leave">
          <div class="stack-item__head flex items-center justify-between gap-2">
            <span class="font-semibold">{{ item.label }}</span>
            @if (i === 0) {
              <span class="stack-item__badge">next</span>
            }
          </div>
          <div class="stack-item__meta opacity-70">
            @if (item.controllerName) {
              <span [class.text-amber-300]="item.isOpponent">{{ item.controllerName }}</span>
              <span class="opacity-50"> · </span>
            }
            <span>{{ item.kind }}</span>
          </div>
        </div>
      } @empty {
        <p class="stack-list__empty text-xs opacity-40">empty</p>
      }
    </div>
  `,
  // The visual treatment for .stack-item / .stack-item--* + the
  // enter/leave keyframes live in the GLOBAL board.scss (applied to every
  // component regardless of view encapsulation). Only the list container's
  // own flex/scroll is co-located here so the drawer's top pane scrolls.
  styles: [`
    .stack-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      height: 100%;
      overflow-y: auto;
    }
  `],
})
export class StackListComponent {
  readonly items = input<StackItemView[]>([]);
}
