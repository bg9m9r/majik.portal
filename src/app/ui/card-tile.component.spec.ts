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

  it('mouseenter sets popover after 200ms delay', () => {
    vi.useFakeTimers();
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
      providers: [
        { provide: CardPopoverService, useValue: { show, hide, current: () => null } },
        { provide: ScryfallImageCache, useValue: makeCacheStub() },
      ],
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
