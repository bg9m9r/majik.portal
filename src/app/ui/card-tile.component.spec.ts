import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { CardTileComponent } from './card-tile.component';
import { CardPopoverService } from './card-popover.service';
import { ScryfallImageCache } from '../core/card/scryfall-image-cache.service';
import { Card } from '../core/card/card.types';

function makeCacheStub(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  const version = signal(0);
  const request = vi.fn((names: string[]) => {
    for (const n of names) { void n; }
  });
  return {
    version,
    request,
    get: (n: string) => map.get(n) ?? null,
    _set(name: string, url: string) {
      map.set(name, url);
      version.update((v) => v + 1);
    },
  };
}

describe('CardTileComponent', () => {
  function render(props: { name: string; count?: number }, cache: ReturnType<typeof makeCacheStub> = makeCacheStub()) {
    TestBed.configureTestingModule({
      imports: [CardTileComponent],
      providers: [{ provide: ScryfallImageCache, useValue: cache }],
    });
    const fixture = TestBed.createComponent(CardTileComponent);
    fixture.componentRef.setInput('name', props.name);
    if (props.count !== undefined) fixture.componentRef.setInput('count', props.count);
    fixture.detectChanges();
    return { fixture, cache };
  }

  it('renders cached Scryfall image URL when available', () => {
    const cache = makeCacheStub({ 'Grizzly Bears': 'https://img.example/bears.png' });
    const { fixture } = render({ name: 'Grizzly Bears' }, cache);
    const img = fixture.nativeElement.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('https://img.example/bears.png');
    expect(img.getAttribute('alt')).toBe('Grizzly Bears');
  });

  it('renders placeholder and requests image when cache miss', () => {
    const cache = makeCacheStub();
    const { fixture } = render({ name: 'Lightning Bolt' }, cache);
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    const placeholder = fixture.nativeElement.querySelector('[data-image-placeholder]');
    expect(placeholder).not.toBeNull();
    expect(placeholder.textContent).toContain('Lightning Bolt');
    expect(cache.request).toHaveBeenCalledWith(['Lightning Bolt']);
  });

  it('shows count badge when count > 0', () => {
    const fx = render({ name: 'Forest', count: 4 }).fixture;
    expect(fx.nativeElement.textContent).toContain('4');
  });

  it('hides count badge when count is 0', () => {
    const fx = render({ name: 'Forest', count: 0 }).fixture;
    expect(fx.nativeElement.querySelector('[data-count-badge]')).toBeNull();
  });

  function renderWithPopover(card: Card | null) {
    const show = vi.fn();
    const hide = vi.fn();
    TestBed.configureTestingModule({
      imports: [CardTileComponent],
      providers: [
        { provide: CardPopoverService, useValue: { show, hide, current: () => null } },
        { provide: ScryfallImageCache, useValue: makeCacheStub() },
      ],
    });
    const fx = TestBed.createComponent(CardTileComponent);
    fx.componentRef.setInput('name', card?.name ?? 'X');
    fx.componentRef.setInput('card', card);
    fx.detectChanges();
    const tile = fx.nativeElement.querySelector('[aria-label]') as HTMLElement;
    return { fx, show, hide, tile };
  }

  const BOLT: Card = {
    name: 'Lightning Bolt', manaCost: '{R}', types: ['Instant'], power: null, toughness: null,
    isImplemented: true, cmc: 1, colors: ['R'], oracleText: 'Bolt deals 3.',
  };

  it('does not open the popover on hover (hover removed)', () => {
    const { fx, show } = renderWithPopover(BOLT);
    const tile = fx.nativeElement.querySelector('[aria-label]') as HTMLElement;
    tile.dispatchEvent(new MouseEvent('mouseenter'));
    tile.dispatchEvent(new MouseEvent('mouseleave'));
    fx.detectChanges();
    expect(show).not.toHaveBeenCalled();
  });

  it('right-click with a card opens the menu and View details shows the popover', () => {
    const { fx, show, tile } = renderWithPopover(BOLT);
    tile.dispatchEvent(new MouseEvent('contextmenu', { clientX: 10, clientY: 20 }));
    fx.detectChanges();
    const menu = fx.nativeElement.querySelector('[role="menu"]') as HTMLElement | null;
    expect(menu).not.toBeNull();

    const buttons = Array.from(menu!.querySelectorAll('button')) as HTMLButtonElement[];
    const details = buttons.find((b) => b.textContent?.includes('View details'))!;
    details.click();
    fx.detectChanges();
    expect(show).toHaveBeenCalled();
    // menu closes after the action
    expect(fx.nativeElement.querySelector('[role="menu"]')).toBeNull();
  });

  it('right-click with a null card shows no menu and no popover', () => {
    const { fx, show, tile } = renderWithPopover(null);
    tile.dispatchEvent(new MouseEvent('contextmenu', { clientX: 10, clientY: 20 }));
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('[role="menu"]')).toBeNull();
    expect(show).not.toHaveBeenCalled();
  });

  it('Open on Scryfall opens an exact-name search tab', () => {
    const openSpy = vi.fn();
    const orig = window.open;
    window.open = openSpy as unknown as typeof window.open;
    try {
      const { fx, tile } = renderWithPopover(BOLT);
      tile.dispatchEvent(new MouseEvent('contextmenu', { clientX: 10, clientY: 20 }));
      fx.detectChanges();
      const scry = Array.from(fx.nativeElement.querySelectorAll('[role="menu"] button') as NodeListOf<HTMLButtonElement>)
        .find((b) => b.textContent?.includes('Scryfall'))!;
      scry.click();
      expect(openSpy).toHaveBeenCalled();
      expect((openSpy.mock.calls[0][0] as string)).toContain('scryfall.com/search');
      expect((openSpy.mock.calls[0][0] as string)).toContain('Lightning%20Bolt');
    } finally {
      window.open = orig;
    }
  });

  it('outside-click dismisses the open menu', () => {
    const { fx, tile } = renderWithPopover(BOLT);
    tile.dispatchEvent(new MouseEvent('contextmenu', { clientX: 10, clientY: 20 }));
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('[role="menu"]')).not.toBeNull();
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('[role="menu"]')).toBeNull();
  });

  it('Escape dismisses the open menu', () => {
    const { fx, tile } = renderWithPopover(BOLT);
    tile.dispatchEvent(new MouseEvent('contextmenu', { clientX: 10, clientY: 20 }));
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('[role="menu"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('[role="menu"]')).toBeNull();
  });
});
