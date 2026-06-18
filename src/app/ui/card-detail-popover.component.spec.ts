import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Router, NavigationStart, Event as RouterEvent } from '@angular/router';
import { Subject } from 'rxjs';
import { CardDetailPopoverComponent } from './card-detail-popover.component';
import { CardPopoverService } from './card-popover.service';
import { Card } from '../core/card/card.types';

const card: Card = {
  name: 'Forest',
  manaCost: '',
  types: ['Basic', 'Land'],
  power: null,
  toughness: null,
  isImplemented: true,
  cmc: null,
  colors: [],
  oracleText: null,
};

const rect = () => new DOMRect(0, 0, 100, 140);

describe('CardDetailPopoverComponent', () => {
  let fixture: ComponentFixture<CardDetailPopoverComponent>;
  let popover: CardPopoverService;
  let routerEvents: Subject<RouterEvent>;

  beforeEach(() => {
    routerEvents = new Subject<RouterEvent>();
    TestBed.configureTestingModule({
      imports: [CardDetailPopoverComponent],
      providers: [
        CardPopoverService,
        { provide: Router, useValue: { events: routerEvents.asObservable() } },
      ],
    });
    fixture = TestBed.createComponent(CardDetailPopoverComponent);
    popover = TestBed.inject(CardPopoverService);
    fixture.detectChanges();
  });

  it('renders the popover (tooltip + image) when a card is shown', () => {
    popover.show(card, rect());
    fixture.detectChanges();
    const tip = fixture.nativeElement.querySelector('[role="tooltip"]');
    expect(tip).not.toBeNull();
    expect(fixture.nativeElement.querySelector('img')).not.toBeNull();
    expect(tip.textContent).toContain('Forest');
  });

  it('Escape keydown hides the popover', () => {
    popover.show(card, rect());
    fixture.detectChanges();
    expect(popover.current()).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(popover.current()).toBeNull();
  });

  it('a document click hides the popover AFTER it is armed (next tick)', () => {
    vi.useFakeTimers();
    try {
      popover.show(card, rect());
      fixture.detectChanges();
      // Advance past the setTimeout(0) arm gate.
      vi.advanceTimersByTime(1);
      fixture.detectChanges();

      document.dispatchEvent(new MouseEvent('click'));
      fixture.detectChanges();

      expect(popover.current()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT self-close on the same click that opened it (race guard)', () => {
    vi.useFakeTimers();
    try {
      // Simulate the "View details" flow: show() then the opening click fires
      // within the SAME synchronous turn, before the arm tick elapses.
      popover.show(card, rect());
      fixture.detectChanges();
      document.dispatchEvent(new MouseEvent('click'));
      fixture.detectChanges();

      // Still open — the opening click must not dismiss it.
      expect(popover.current()).not.toBeNull();

      // And it remains open even after the arm tick until a NEW click arrives.
      vi.advanceTimersByTime(1);
      fixture.detectChanges();
      expect(popover.current()).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears on router NavigationStart (e.g. match → lobby)', () => {
    popover.show(card, rect());
    fixture.detectChanges();
    expect(popover.current()).not.toBeNull();

    routerEvents.next(new NavigationStart(1, '/lobby'));
    fixture.detectChanges();

    expect(popover.current()).toBeNull();
  });
});
