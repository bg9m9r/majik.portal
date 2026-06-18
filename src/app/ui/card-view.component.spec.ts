import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { CardViewComponent } from './card-view.component';
import { CardPopoverService } from './card-popover.service';
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
    producedManaColors: '',
    ...overrides,
  };
}

function makePopoverStub() {
  return {
    show: vi.fn(),
    hide: vi.fn(),
    current: () => null,
  };
}

function render(
  snapshot: CardSnapshot | null,
  hidden: boolean,
  cache: ReturnType<typeof makeCacheStub> = makeCacheStub(),
  zone?: 'battlefield' | 'hand' | 'stack' | 'other',
  options: { castable?: boolean; popover?: ReturnType<typeof makePopoverStub> } = {},
) {
  const popover = options.popover ?? makePopoverStub();
  TestBed.configureTestingModule({
    imports: [CardViewComponent],
    providers: [
      { provide: ScryfallImageCache, useValue: cache },
      { provide: CardPopoverService, useValue: popover },
    ],
  });
  const fixture = TestBed.createComponent(CardViewComponent);
  fixture.componentRef.setInput('snapshot', snapshot);
  fixture.componentRef.setInput('hidden', hidden);
  if (zone !== undefined) fixture.componentRef.setInput('zone', zone);
  if (options.castable !== undefined) fixture.componentRef.setInput('castable', options.castable);
  fixture.detectChanges();
  return { fixture, cache, popover };
}

function renderAffordance(inputs: Record<string, unknown>) {
  TestBed.configureTestingModule({
    imports: [CardViewComponent],
    providers: [
      { provide: ScryfallImageCache, useValue: makeCacheStub() },
      { provide: CardPopoverService, useValue: makePopoverStub() },
    ],
  });
  const fixture = TestBed.createComponent(CardViewComponent);
  fixture.componentRef.setInput('snapshot', makeSnapshot());
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return fixture.nativeElement.querySelector('.card') as HTMLElement;
}

describe('CardViewComponent selection affordance', () => {
  it('marks a targetable card', () => {
    const el = renderAffordance({ targetable: true });
    expect(el.getAttribute('data-targetable')).toBe('true');
  });
  it('marks a dimmed card', () => {
    const el = renderAffordance({ dimmed: true });
    expect(el.getAttribute('data-dimmed')).toBe('true');
  });
  it('marks a selected card', () => {
    const el = renderAffordance({ selectedForTarget: true });
    expect(el.getAttribute('data-selected')).toBe('true');
  });
  it('omits the attributes when no affordance is active (default)', () => {
    const el = renderAffordance({});
    expect(el.getAttribute('data-targetable')).toBeNull();
    expect(el.getAttribute('data-dimmed')).toBeNull();
    expect(el.getAttribute('data-selected')).toBeNull();
  });
});

describe('CardViewComponent', () => {
  it('does not open the detail popover on hover (hover removed)', () => {
    const popover = makePopoverStub();
    const { fixture } = render(makeSnapshot(), false, makeCacheStub(), 'battlefield', { popover });
    const card = fixture.nativeElement.querySelector('.card') as HTMLElement;
    card.dispatchEvent(new MouseEvent('mouseenter'));
    card.dispatchEvent(new MouseEvent('mouseleave'));
    expect(popover.show).not.toHaveBeenCalled();
  });

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

  it('renders card-back image and no ? when hidden', () => {
    const cache = makeCacheStub({ 'Grizzly Bears': 'https://img.example/bears.png' });
    const { fixture } = render(makeSnapshot(), true, cache);
    const img = fixture.nativeElement.querySelector('img.card-back') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('/card-back.svg');
    expect(fixture.nativeElement.textContent).not.toContain('?');
    expect(cache.request).not.toHaveBeenCalled();
  });

  describe('CardViewComponent hidden render', () => {
    it('renders the card-back image when hidden', () => {
      const { fixture } = render(null, true);
      const img = fixture.nativeElement.querySelector('img.card-back') as HTMLImageElement | null;
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src')).toBe('/card-back.svg');
    });

    it('falls back to "?" if the back image errors', () => {
      const { fixture } = render(null, true);
      fixture.componentInstance.onBackError();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('?');
    });
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

  describe('summoning sickness ring', () => {
    // Sickness is signalled via the `.is-sick` class on the root .card
    // element (drives an inset box-shadow ring). The dot variant was
    // removed because dense battlefield rows obscured the corner.
    const SICK = '.card.is-sick';

    it('rings a sick creature on the battlefield', () => {
      const { fixture } = render(
        makeSnapshot({ summoningSickness: true, types: ['Creature'] }),
        false, makeCacheStub(), 'battlefield');
      expect(fixture.nativeElement.querySelector(SICK)).not.toBeNull();
    });

    it('suppresses the ring in hand even when the snapshot flag is true', () => {
      const { fixture } = render(
        makeSnapshot({ summoningSickness: true, types: ['Creature'] }),
        false, makeCacheStub(), 'hand');
      expect(fixture.nativeElement.querySelector(SICK)).toBeNull();
    });

    it('suppresses the ring for non-creature permanents (e.g. lands, artifacts)', () => {
      const { fixture } = render(
        makeSnapshot({
          summoningSickness: true,
          types: ['Land'],
          power: null,
          toughness: null,
        }),
        false, makeCacheStub(), 'battlefield');
      expect(fixture.nativeElement.querySelector(SICK)).toBeNull();
    });

    it('rings an animated land that is currently a creature', () => {
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
      expect(fixture.nativeElement.querySelector(SICK)).not.toBeNull();
    });

    it('defaults zone to non-battlefield so the ring is opt-in', () => {
      const { fixture } = render(
        makeSnapshot({ summoningSickness: true, types: ['Creature'] }),
        false, makeCacheStub() /* no zone */);
      expect(fixture.nativeElement.querySelector(SICK)).toBeNull();
    });
  });

  describe('castable input', () => {
    it('applies .card--castable when castable=true on a hand card', () => {
      const { fixture } = render(
        makeSnapshot({ types: ['Creature'] }),
        false, makeCacheStub(), 'hand',
        { castable: true });
      expect(fixture.nativeElement.querySelector('.card.card--castable')).not.toBeNull();
    });

    it('omits .card--castable when castable=false (default)', () => {
      const { fixture } = render(
        makeSnapshot({ types: ['Creature'] }),
        false, makeCacheStub(), 'hand');
      expect(fixture.nativeElement.querySelector('.card.card--castable')).toBeNull();
    });
  });

  describe('tap pin', () => {
    it('renders the TAP pin when the card is tapped on the battlefield', () => {
      const { fixture } = render(
        makeSnapshot({ tapped: true, types: ['Creature'] }),
        false, makeCacheStub(), 'battlefield');
      const pin = fixture.nativeElement.querySelector('.card__tap-pin');
      expect(pin).not.toBeNull();
      expect(pin?.textContent).toContain('TAP');
    });

    it('omits the TAP pin when the card is untapped', () => {
      const { fixture } = render(
        makeSnapshot({ tapped: false, types: ['Creature'] }),
        false, makeCacheStub(), 'battlefield');
      expect(fixture.nativeElement.querySelector('.card__tap-pin')).toBeNull();
    });

    it('omits the TAP pin on a face-down (hidden) card', () => {
      const { fixture } = render(
        makeSnapshot({ tapped: true }),
        true, makeCacheStub(), 'battlefield');
      expect(fixture.nativeElement.querySelector('.card__tap-pin')).toBeNull();
    });
  });

  describe('imprinted cards (Agatha\'s Soul Cauldron)', () => {
    it('renders a chip per imprinted card beneath the permanent', () => {
      const { fixture } = render(
        makeSnapshot({
          name: "Agatha's Soul Cauldron",
          types: ['Artifact'],
          power: null,
          toughness: null,
          imprintedCards: [
            makeSnapshot({ instanceId: 'im1', name: 'Grizzly Bears', types: ['Creature'] }),
            makeSnapshot({ instanceId: 'im2', name: 'Llanowar Elves', types: ['Creature'] }),
          ],
        }),
        false, makeCacheStub(), 'battlefield');
      const chips = fixture.nativeElement.querySelectorAll('.card__imprint-chip');
      expect(chips.length).toBe(2);
      const names = Array.from(chips as NodeListOf<Element>).map((c) => c.textContent?.trim());
      expect(names).toContain('Grizzly Bears');
      expect(names).toContain('Llanowar Elves');
    });

    it('exposes an aria-label naming the exiled cards', () => {
      const { fixture } = render(
        makeSnapshot({
          name: "Agatha's Soul Cauldron",
          imprintedCards: [makeSnapshot({ instanceId: 'im1', name: 'Grizzly Bears' })],
        }),
        false, makeCacheStub(), 'battlefield');
      const strip = fixture.nativeElement.querySelector('.card__imprints');
      expect(strip).not.toBeNull();
      expect(strip.getAttribute('aria-label')).toContain('Grizzly Bears');
    });

    it('renders no imprint strip for an ordinary permanent', () => {
      const { fixture } = render(
        makeSnapshot({ types: ['Creature'] }),
        false, makeCacheStub(), 'battlefield');
      expect(fixture.nativeElement.querySelector('.card__imprints')).toBeNull();
    });

    it('renders no imprint strip when imprintedCards is empty', () => {
      const { fixture } = render(
        makeSnapshot({ types: ['Artifact'], imprintedCards: [] }),
        false, makeCacheStub(), 'battlefield');
      expect(fixture.nativeElement.querySelector('.card__imprints')).toBeNull();
    });
  });

  describe('counters', () => {
    it('renders a green +1/+1 pip with the count', () => {
      const { fixture } = render(
        makeSnapshot({ power: 4, toughness: 4, counters: { '+1/+1': 2 } }),
        false, makeCacheStub(), 'battlefield');
      const pip = fixture.nativeElement.querySelector('.card__counter-pip--plus');
      expect(pip).not.toBeNull();
      expect(pip.textContent).toContain('+1/+1');
      expect(pip.textContent).toContain('2');
    });

    it('renders a red -1/-1 pip distinct from +1/+1', () => {
      const { fixture } = render(
        makeSnapshot({ power: 1, toughness: 1, counters: { '-1/-1': 1 } }),
        false, makeCacheStub(), 'battlefield');
      expect(fixture.nativeElement.querySelector('.card__counter-pip--minus')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.card__counter-pip--plus')).toBeNull();
    });

    it('renders a loyalty pip with the bare loyalty number', () => {
      const { fixture } = render(
        makeSnapshot({
          name: 'Liliana of the Veil',
          types: ['Planeswalker'],
          power: null, toughness: null,
          counters: { Loyalty: 3 },
        }),
        false, makeCacheStub(), 'battlefield');
      const pip = fixture.nativeElement.querySelector('.card__counter-pip--loyalty');
      expect(pip).not.toBeNull();
      expect(pip.textContent?.trim()).toBe('3');
    });

    it('renders a generic "Name ×N" pip for other counter types (e.g. charge)', () => {
      const { fixture } = render(
        makeSnapshot({ types: ['Artifact'], power: null, toughness: null, counters: { Charge: 4 } }),
        false, makeCacheStub(), 'battlefield');
      const pip = fixture.nativeElement.querySelector('.card__counter-pip--other');
      expect(pip).not.toBeNull();
      expect(pip.textContent).toContain('Charge');
      expect(pip.textContent).toContain('4');
    });

    it('renders one pip per distinct counter type', () => {
      const { fixture } = render(
        makeSnapshot({ counters: { '+1/+1': 1, Charge: 2 } }),
        false, makeCacheStub(), 'battlefield');
      expect(fixture.nativeElement.querySelectorAll('.card__counter-pip').length).toBe(2);
    });

    it('drops zeroed-out counter entries', () => {
      const { fixture } = render(
        makeSnapshot({ counters: { '+1/+1': 0 } }),
        false, makeCacheStub(), 'battlefield');
      expect(fixture.nativeElement.querySelector('.card__counters')).toBeNull();
    });

    it('renders no counter strip when there are no counters', () => {
      const { fixture } = render(
        makeSnapshot(), false, makeCacheStub(), 'battlefield');
      expect(fixture.nativeElement.querySelector('.card__counters')).toBeNull();
    });

    it('suppresses counters on a hidden (face-down) card', () => {
      const { fixture } = render(
        makeSnapshot({ counters: { '+1/+1': 2 } }),
        true, makeCacheStub(), 'battlefield');
      expect(fixture.nativeElement.querySelector('.card__counters')).toBeNull();
    });

    it('keeps the authoritative P/T badge alongside the counter pips', () => {
      const cache = makeCacheStub({ 'Grizzly Bears': 'https://img.example/bears.png' });
      const { fixture } = render(
        makeSnapshot({ power: 4, toughness: 4, counters: { '+1/+1': 2 } }),
        false, cache, 'battlefield');
      // counter-inclusive P/T still shown in addition to the pips
      expect(fixture.nativeElement.textContent).toContain('4/4');
      expect(fixture.nativeElement.querySelector('.card__counter-pip--plus')).not.toBeNull();
    });

    it('exposes a counters group aria-label naming the counter state', () => {
      const { fixture } = render(
        makeSnapshot({ counters: { '+1/+1': 2 } }),
        false, makeCacheStub(), 'battlefield');
      const group = fixture.nativeElement.querySelector('.card__counters');
      expect(group.getAttribute('aria-label')).toContain('+1/+1');
    });

    it('includes counters in the root card aria-label', () => {
      const { fixture } = render(
        makeSnapshot({ counters: { '+1/+1': 2 } }),
        false, makeCacheStub(), 'battlefield');
      const card = fixture.nativeElement.querySelector('.card');
      expect(card.getAttribute('aria-label')).toContain('+1/+1');
    });
  });
});
