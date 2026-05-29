import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { GraveyardModalComponent } from './graveyard-modal.component';
import { CardSnapshot } from '../../../core/match/match.types';

function card(over: Partial<CardSnapshot>): CardSnapshot {
  return {
    instanceId: over.instanceId ?? `id-${Math.random()}`,
    name: over.name ?? 'Bear',
    manaCost: over.manaCost ?? '1G',
    types: over.types ?? ['Creature'],
    power: over.power ?? 2,
    toughness: over.toughness ?? 2,
    tapped: over.tapped ?? false,
    summoningSickness: over.summoningSickness ?? false,
    producedManaColors: over.producedManaColors ?? '',
  };
}

function mount(cards: CardSnapshot[], ownerName = 'Alice') {
  TestBed.configureTestingModule({ imports: [GraveyardModalComponent] });
  const fixture = TestBed.createComponent(GraveyardModalComponent);
  const ref: ComponentRef<GraveyardModalComponent> = fixture.componentRef;
  ref.setInput('cards', cards);
  ref.setInput('ownerName', ownerName);
  fixture.detectChanges();
  return { component: fixture.componentInstance, fixture };
}

describe('GraveyardModalComponent — browse modal (CR 706.2)', () => {
  it('renders the title with the owner name + card count', () => {
    const a = card({ instanceId: 'a', name: 'A' });
    const b = card({ instanceId: 'b', name: 'B' });
    const { fixture } = mount([a, b], 'Alice');

    const heading = fixture.nativeElement.querySelector('h2');
    expect(heading).not.toBeNull();
    expect(heading.textContent).toContain("Alice's graveyard");
    expect(heading.textContent).toContain('(2)');
  });

  it('renders one grid tile per card', () => {
    const a = card({ instanceId: 'a', name: 'Llanowar Elves' });
    const b = card({ instanceId: 'b', name: 'Birds of Paradise' });
    const c = card({ instanceId: 'c', name: 'Mountain' });
    const { fixture } = mount([a, b, c]);

    const grid = fixture.nativeElement.querySelector(
      '[data-testid="graveyard-modal-grid"]') as HTMLElement | null;
    expect(grid).not.toBeNull();
    const tiles = grid!.querySelectorAll('[role="listitem"]');
    expect(tiles.length).toBe(3);
    expect(grid!.textContent).toContain('Llanowar Elves');
    expect(grid!.textContent).toContain('Birds of Paradise');
    expect(grid!.textContent).toContain('Mountain');
  });

  it('renders the empty-state body when the graveyard has no cards', () => {
    const { fixture } = mount([]);

    const empty = fixture.nativeElement.querySelector(
      '[data-testid="graveyard-modal-empty"]');
    expect(empty).not.toBeNull();
    expect(empty.textContent.toLowerCase()).toContain('empty');
  });

  it('emits closed when the Close button is clicked', () => {
    const { component, fixture } = mount([card({})]);
    let closed = 0;
    component.closed.subscribe(() => closed++);

    const btn = fixture.nativeElement.querySelector(
      '[data-testid="graveyard-modal-close"]') as HTMLButtonElement;
    btn.click();
    expect(closed).toBe(1);
  });

  it('emits closed when the backdrop is clicked', () => {
    const { component, fixture } = mount([card({})]);
    let closed = 0;
    component.closed.subscribe(() => closed++);

    const backdrop = fixture.nativeElement.querySelector(
      '[data-testid="graveyard-modal-backdrop"]') as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(closed).toBe(1);
  });
});
