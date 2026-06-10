import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  ActivatableAbility,
  CardContextMenuComponent,
} from './card-context-menu.component';
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

function render(
  card: CardSnapshot | null,
  position: { x: number; y: number } | null,
  canTap = false,
  activatableAbilities: ActivatableAbility[] = [],
) {
  TestBed.configureTestingModule({ imports: [CardContextMenuComponent] });
  const fixture = TestBed.createComponent(CardContextMenuComponent);
  fixture.componentRef.setInput('card', card);
  fixture.componentRef.setInput('position', position);
  fixture.componentRef.setInput('canTap', canTap);
  fixture.componentRef.setInput('activatableAbilities', activatableAbilities);
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

  // -------------------------------------------------------------------------
  // CardContextMenuComponent — Activate entries (per-ability)
  //
  // Discoverable activation for non-mana activated abilities. Today the
  // engine surfaces ActivateAbilityCommand only via a double-click in the
  // board; users intuitively right-click a card (e.g. Misty Rainforest)
  // expecting an Activate entry, find only "tap / details / scryfall", try
  // "tap", and get a visual-only tap. The fix: one menu entry per
  // activated ability with a non-null id on the owner's self battlefield,
  // each emitting that ability's id.
  //
  // The CONTEXT MENU stays presentational: the parent (BoardComponent)
  // filters abilities (owner === 'self', kind === 'Activated', id != null)
  // and passes the result as `activatableAbilities`. The menu renders one
  // <button>Activate {description}</button> per entry and emits the id
  // via `activateAbilityRequested`. Clicking also closes the menu, just
  // like every other entry.
  // -------------------------------------------------------------------------
  it('renders one Activate entry per activatable ability, labelled with the description', () => {
    const fixture = render(makeCard(), { x: 0, y: 0 }, true, [
      { id: 'abil-1', description: '{T}, Pay 1 life, Sacrifice: search' },
      { id: 'abil-2', description: '+1: scry 1' },
    ]);
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const labels = buttons.map(b => b.textContent?.trim());
    expect(labels).toContain('Activate {T}, Pay 1 life, Sacrifice: search');
    expect(labels).toContain('Activate +1: scry 1');
  });

  it('falls back to "Activate ability" when the ability has no description', () => {
    const fixture = render(makeCard(), { x: 0, y: 0 }, true, [
      { id: 'abil-1', description: '' },
    ]);
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const labels = buttons.map(b => b.textContent?.trim());
    expect(labels).toContain('Activate ability');
  });

  it('emits activateAbilityRequested with the full ability descriptor on click + closes the menu', () => {
    const fixture = render(makeCard(), { x: 0, y: 0 }, true, [
      { id: 'abil-1', description: 'search', kind: 'activated' },
      { id: 'abil-2', description: '+1', kind: 'loyalty' },
    ]);
    const emitted: ActivatableAbility[] = [];
    fixture.componentInstance.activateAbilityRequested.subscribe(a => emitted.push(a));
    const closeSeen: boolean[] = [];
    fixture.componentInstance.closed.subscribe(() => closeSeen.push(true));

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const activateButtons = buttons.filter(b => b.textContent?.trim().startsWith('Activate '));
    expect(activateButtons.length).toBe(2);

    activateButtons[0].click();
    activateButtons[1].click();

    // The menu re-emits the descriptor verbatim so the parent can route
    // on `kind` (activated → ActivateAbilityCommand, loyalty → loyalty cmd).
    expect(emitted).toEqual([
      { id: 'abil-1', description: 'search', kind: 'activated' },
      { id: 'abil-2', description: '+1', kind: 'loyalty' },
    ]);
    // Each activate click also closes the menu, same as every other entry.
    expect(closeSeen.length).toBe(2);
  });

  it('shows no Activate entries when activatableAbilities is empty', () => {
    const fixture = render(makeCard(), { x: 0, y: 0 }, true, []);
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const labels = buttons.map(b => b.textContent?.trim());
    expect(labels.find(l => l?.startsWith('Activate '))).toBeUndefined();
  });

  it('shows Activate entries alongside (not in place of) the existing tap / details / scryfall entries', () => {
    const fixture = render(makeCard(), { x: 0, y: 0 }, true, [
      { id: 'abil-1', description: 'search' },
    ]);
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const labels = buttons.map(b => b.textContent?.trim());
    expect(labels).toContain('Tap / Untap');
    expect(labels).toContain('View details');
    expect(labels).toContain('Open on Scryfall');
    expect(labels).toContain('Activate search');
  });
});
