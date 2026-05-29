import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { GraveyardPileComponent } from './graveyard-pile.component';
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

function mount(cards: CardSnapshot[], side: 'self' | 'opponent' = 'self', ownerName = 'Alice') {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [GraveyardPileComponent] });
  const fixture = TestBed.createComponent(GraveyardPileComponent);
  const ref: ComponentRef<GraveyardPileComponent> = fixture.componentRef;
  ref.setInput('cards', cards);
  ref.setInput('ownerSide', side);
  ref.setInput('ownerName', ownerName);
  fixture.detectChanges();
  return { component: fixture.componentInstance, fixture };
}

describe('GraveyardPileComponent — strip thumbnail (CR 706.2)', () => {
  it('renders count badge with the supplied cards length', () => {
    const a = card({ instanceId: 'a', name: 'A' });
    const b = card({ instanceId: 'b', name: 'B' });
    const c = card({ instanceId: 'c', name: 'C' });
    const { fixture } = mount([a, b, c]);

    const root = fixture.nativeElement.querySelector('[data-testid="graveyard-pile-self"]') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.textContent).toContain('Graveyard: 3');
  });

  it('shows the most-recently-added card (last in cards[]) as the top card', () => {
    // CR 404.1 — most-recently-added is at the end of the snapshot list.
    const a = card({ instanceId: 'a', name: 'Old' });
    const b = card({ instanceId: 'b', name: 'New' });
    const { component } = mount([a, b]);

    expect(component.topCard()?.instanceId).toBe('b');
  });

  it('renders the empty placeholder + "0" when graveyard is empty', () => {
    const { component, fixture } = mount([]);
    expect(component.topCard()).toBeNull();
    expect(component.count()).toBe(0);

    const placeholder = fixture.nativeElement.querySelector('.graveyard-pile__empty');
    expect(placeholder).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Graveyard: 0');
  });

  it('emits expand on click', () => {
    const a = card({ instanceId: 'a' });
    const { component, fixture } = mount([a]);

    let expanded = 0;
    component.expand.subscribe(() => expanded++);

    const btn = fixture.nativeElement.querySelector('[data-testid="graveyard-pile-self"]') as HTMLButtonElement;
    btn.click();
    expect(expanded).toBe(1);
  });

  it('routes data-testid by ownerSide so both seats are reachable', () => {
    const a = card({ instanceId: 'a' });
    const { fixture: selfFix } = mount([a], 'self');
    const { fixture: oppFix } = mount([a], 'opponent', 'Bob');

    expect(selfFix.nativeElement.querySelector('[data-testid="graveyard-pile-self"]')).not.toBeNull();
    expect(oppFix.nativeElement.querySelector('[data-testid="graveyard-pile-opponent"]')).not.toBeNull();
  });

  it('aria-label reflects owner name + card count for screen readers', () => {
    const a = card({ instanceId: 'a' });
    const b = card({ instanceId: 'b' });
    const { fixture } = mount([a, b], 'opponent', 'Bob');

    const btn = fixture.nativeElement.querySelector('[data-testid="graveyard-pile-opponent"]') as HTMLElement;
    expect(btn.getAttribute('aria-label')).toContain('Bob');
    expect(btn.getAttribute('aria-label')).toContain('2');
  });
});
