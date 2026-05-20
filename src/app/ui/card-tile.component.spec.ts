import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { CardTileComponent } from './card-tile.component';
import { CardPopoverService } from './card-popover.service';
import { Card } from '../core/card/card.types';

describe('CardTileComponent', () => {
  function render(props: { name: string; count?: number }) {
    TestBed.configureTestingModule({ imports: [CardTileComponent] });
    const fixture = TestBed.createComponent(CardTileComponent);
    fixture.componentRef.setInput('name', props.name);
    if (props.count !== undefined) fixture.componentRef.setInput('count', props.count);
    fixture.detectChanges();
    return fixture;
  }

  it('renders Scryfall image URL with exact name', () => {
    const fx = render({ name: 'Grizzly Bears' });
    const img = fx.nativeElement.querySelector('img');
    expect(img.getAttribute('src')).toBe('https://api.scryfall.com/cards/named?exact=Grizzly+Bears&format=image&version=small');
    expect(img.getAttribute('alt')).toBe('Grizzly Bears');
  });

  it('shows count badge when count > 0', () => {
    const fx = render({ name: 'Forest', count: 4 });
    expect(fx.nativeElement.textContent).toContain('4');
  });

  it('hides count badge when count is 0', () => {
    const fx = render({ name: 'Forest', count: 0 });
    expect(fx.nativeElement.querySelector('[data-count-badge]')).toBeNull();
  });

  it('mouseenter sets popover after 200ms delay', () => {
    vi.useFakeTimers();
    const show = vi.fn();
    const hide = vi.fn();
    TestBed.configureTestingModule({
      imports: [CardTileComponent],
      providers: [{ provide: CardPopoverService, useValue: { show, hide, current: () => null } }],
    });
    const fx = TestBed.createComponent(CardTileComponent);
    const card: Card = {
      name: 'Bolt', manaCost: '{R}', types: ['Instant'], power: null, toughness: null,
      isImplemented: true, cmc: 1, colors: ['R'], oracleText: 'Bolt deals 3.',
    };
    fx.componentRef.setInput('name', 'Bolt');
    fx.componentRef.setInput('card', card);
    fx.detectChanges();

    const host = fx.nativeElement.querySelector('div') as HTMLElement;
    host.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(199);
    expect(show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('mouseleave cancels timer and hides popover', () => {
    vi.useFakeTimers();
    const show = vi.fn();
    const hide = vi.fn();
    TestBed.configureTestingModule({
      imports: [CardTileComponent],
      providers: [{ provide: CardPopoverService, useValue: { show, hide, current: () => null } }],
    });
    const fx = TestBed.createComponent(CardTileComponent);
    fx.componentRef.setInput('name', 'X');
    fx.detectChanges();
    const host = fx.nativeElement.querySelector('div') as HTMLElement;
    host.dispatchEvent(new MouseEvent('mouseenter'));
    host.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(500);
    expect(show).not.toHaveBeenCalled();
    expect(hide).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
