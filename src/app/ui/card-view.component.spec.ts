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

function render(
  snapshot: CardSnapshot | null,
  hidden: boolean,
  cache: ReturnType<typeof makeCacheStub> = makeCacheStub(),
  zone?: 'battlefield' | 'hand' | 'stack' | 'other',
) {
  TestBed.configureTestingModule({
    imports: [CardViewComponent],
    providers: [{ provide: ScryfallImageCache, useValue: cache }],
  });
  const fixture = TestBed.createComponent(CardViewComponent);
  fixture.componentRef.setInput('snapshot', snapshot);
  fixture.componentRef.setInput('hidden', hidden);
  if (zone !== undefined) fixture.componentRef.setInput('zone', zone);
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

  describe('summoning sickness dot', () => {
    function sickness(title = 'Summoning sickness') {
      return `[title="${title}"]`;
    }

    it('renders the dot on a sick creature on the battlefield', () => {
      const { fixture } = render(
        makeSnapshot({ summoningSickness: true, types: ['Creature'] }),
        false, makeCacheStub(), 'battlefield');
      expect(fixture.nativeElement.querySelector(sickness())).not.toBeNull();
    });

    it('suppresses the dot in hand even when the snapshot flag is true', () => {
      const { fixture } = render(
        makeSnapshot({ summoningSickness: true, types: ['Creature'] }),
        false, makeCacheStub(), 'hand');
      expect(fixture.nativeElement.querySelector(sickness())).toBeNull();
    });

    it('suppresses the dot for non-creature permanents (e.g. lands, artifacts)', () => {
      const { fixture } = render(
        makeSnapshot({
          summoningSickness: true,
          types: ['Land'],
          power: null,
          toughness: null,
        }),
        false, makeCacheStub(), 'battlefield');
      expect(fixture.nativeElement.querySelector(sickness())).toBeNull();
    });

    it('renders the dot for an animated land that is currently a creature', () => {
      // Animated land mid-turn — the engine flips the type bit on
      // activation, so types includes both 'Land' and 'Creature'. Per
      // CR 302.1 it now has summoning sickness for the rest of the
      // turn it became a creature.
      const { fixture } = render(
        makeSnapshot({
          name: 'Mutavault',
          summoningSickness: true,
          types: ['Land', 'Creature'],
          power: 2, toughness: 2,
        }),
        false, makeCacheStub(), 'battlefield');
      expect(fixture.nativeElement.querySelector(sickness())).not.toBeNull();
    });

    it('defaults zone to non-battlefield so the dot is opt-in', () => {
      const { fixture } = render(
        makeSnapshot({ summoningSickness: true, types: ['Creature'] }),
        false, makeCacheStub() /* no zone */);
      expect(fixture.nativeElement.querySelector(sickness())).toBeNull();
    });
  });
});
