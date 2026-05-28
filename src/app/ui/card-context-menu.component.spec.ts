import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { CardContextMenuComponent } from './card-context-menu.component';
import { CardSnapshot } from '../core/match/match.types';

function makeCard(name = 'Lightning Bolt'): CardSnapshot {
  return {
    instanceId: 'i1',
    name,
    manaCost: '{R}',
    types: ['Instant'],
    power: null,
    toughness: null,
    tapped: false,
    summoningSickness: false,
    producedManaColors: '',
  };
}

function render(card: CardSnapshot | null, position: { x: number; y: number } | null, canTap = false) {
  TestBed.configureTestingModule({ imports: [CardContextMenuComponent] });
  const fixture = TestBed.createComponent(CardContextMenuComponent);
  fixture.componentRef.setInput('card', card);
  fixture.componentRef.setInput('position', position);
  fixture.componentRef.setInput('canTap', canTap);
  fixture.detectChanges();
  return fixture;
}

describe('CardContextMenuComponent', () => {
  it('renders nothing when card is null', () => {
    const fixture = render(null, { x: 10, y: 10 });
    expect(fixture.nativeElement.querySelector('ul')).toBeNull();
  });

  it('renders nothing when position is null', () => {
    const fixture = render(makeCard(), null);
    expect(fixture.nativeElement.querySelector('ul')).toBeNull();
  });

  it('renders details + scryfall buttons by default', () => {
    const fixture = render(makeCard(), { x: 50, y: 60 });
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const labels = buttons.map(b => b.textContent?.trim());
    expect(labels).toContain('View details');
    expect(labels).toContain('Open on Scryfall');
    expect(labels).not.toContain('Tap / Untap');
  });

  it('renders the Tap / Untap entry when canTap is true', () => {
    const fixture = render(makeCard(), { x: 50, y: 60 }, true);
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const labels = buttons.map(b => b.textContent?.trim());
    expect(labels).toContain('Tap / Untap');
  });

  it('emits the matching action token on click', () => {
    const fixture = render(makeCard(), { x: 0, y: 0 }, true);
    const emitted: string[] = [];
    fixture.componentInstance.action.subscribe(a => emitted.push(a));
    const closeSpy: boolean[] = [];
    fixture.componentInstance.closed.subscribe(() => closeSpy.push(true));
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    for (const b of buttons) b.click();
    expect(emitted).toEqual(['tap', 'details', 'scryfall']);
    // Every action emit also closes the menu.
    expect(closeSpy.length).toBe(3);
  });

  it('positions the menu at the supplied coords (when within viewport)', () => {
    const fixture = render(makeCard(), { x: 30, y: 40 });
    const ul = fixture.nativeElement.querySelector('ul') as HTMLElement;
    expect(ul.style.left).toBe('30px');
    expect(ul.style.top).toBe('40px');
  });

  it('clamps the menu inside the viewport when the click lands at the edge', () => {
    const fixture = render(makeCard(), { x: window.innerWidth - 4, y: window.innerHeight - 4 });
    const ul = fixture.nativeElement.querySelector('ul') as HTMLElement;
    expect(parseInt(ul.style.left, 10)).toBeLessThan(window.innerWidth - 4);
    expect(parseInt(ul.style.top, 10)).toBeLessThan(window.innerHeight - 4);
  });
});
