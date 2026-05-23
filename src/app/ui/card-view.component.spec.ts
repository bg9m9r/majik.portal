import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { CardViewComponent } from './card-view.component';
import { ScryfallImageCache } from '../core/card/scryfall-image-cache.service';
import { CardSnapshot } from '../core/match/match.types';

function makeCacheStub(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  const version = signal(0);
  const request = vi.fn((_names: string[]) => { /* no-op */ });
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

function makeSnapshot(overrides: Partial<CardSnapshot> = {}): CardSnapshot {
  return {
    instanceId: 'i1',
    name: 'Grizzly Bears',
    manaCost: '{1}{G}',
    types: ['Creature'],
    power: 2,
    toughness: 2,
    tapped: false,
    summoningSickness: false,
    ...overrides,
  };
}

function render(snapshot: CardSnapshot | null, hidden: boolean, cache: ReturnType<typeof makeCacheStub> = makeCacheStub()) {
  TestBed.configureTestingModule({
    imports: [CardViewComponent],
    providers: [{ provide: ScryfallImageCache, useValue: cache }],
  });
  const fixture = TestBed.createComponent(CardViewComponent);
  fixture.componentRef.setInput('snapshot', snapshot);
  fixture.componentRef.setInput('hidden', hidden);
  fixture.detectChanges();
  return { fixture, cache };
}

describe('CardViewComponent', () => {
  it('renders cached Scryfall image when URL is available', () => {
    const cache = makeCacheStub({ 'Grizzly Bears': 'https://img.example/bears.png' });
    const { fixture } = render(makeSnapshot(), false, cache);
    const img = fixture.nativeElement.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('https://img.example/bears.png');
    expect(img.getAttribute('alt')).toBe('Grizzly Bears');
  });

  it('requests image and falls back to text on cache miss', () => {
    const cache = makeCacheStub();
    const { fixture } = render(makeSnapshot({ name: 'Lightning Bolt', power: null, toughness: null, types: ['Instant'] }), false, cache);
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Lightning Bolt');
    expect(cache.request).toHaveBeenCalledWith(['Lightning Bolt']);
  });

  it('renders face-down marker and no img when hidden', () => {
    const cache = makeCacheStub({ 'Grizzly Bears': 'https://img.example/bears.png' });
    const { fixture } = render(makeSnapshot(), true, cache);
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('?');
    expect(cache.request).not.toHaveBeenCalled();
  });

  it('shows P/T overlay alongside image', () => {
    const cache = makeCacheStub({ 'Grizzly Bears': 'https://img.example/bears.png' });
    const { fixture } = render(makeSnapshot(), false, cache);
    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('2/2');
  });

  it('reacts to cache resolving after mount', () => {
    const cache = makeCacheStub();
    const { fixture } = render(makeSnapshot({ name: 'Llanowar Elves' }), false, cache);
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    cache._set('Llanowar Elves', 'https://img.example/elves.png');
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('https://img.example/elves.png');
  });
});
