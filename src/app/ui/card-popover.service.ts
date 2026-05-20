import { Injectable, signal } from '@angular/core';
import { Card } from '../core/card/card.types';

export interface PopoverAnchor {
  card: Card;
  rect: DOMRect;
}

@Injectable({ providedIn: 'root' })
export class CardPopoverService {
  private readonly _current = signal<PopoverAnchor | null>(null);
  readonly current = this._current.asReadonly();

  show(card: Card, rect: DOMRect): void {
    this._current.set({ card, rect });
  }

  hide(): void {
    this._current.set(null);
  }
}
