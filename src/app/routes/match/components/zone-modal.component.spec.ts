import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { ZoneModalComponent } from './zone-modal.component';
import { ZoneKind } from './zone-pile.component';
import { CardSnapshot } from '../../../core/match/match.types';

function card(id: string): CardSnapshot {
  return {
    instanceId: id,
    name: id,
    manaCost: '1G',
    types: ['Creature'],
    power: 2,
    toughness: 2,
    tapped: false,
    summoningSickness: false,
    producedManaColors: '',
  };
}

function mount(kind: ZoneKind, cards: CardSnapshot[], ownerName = 'Alice') {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [ZoneModalComponent] });
  const fixture = TestBed.createComponent(ZoneModalComponent);
  const ref: ComponentRef<ZoneModalComponent> = fixture.componentRef;
  ref.setInput('kind', kind);
  ref.setInput('cards', cards);
  ref.setInput('ownerName', ownerName);
  fixture.detectChanges();
  return { component: fixture.componentInstance, fixture };
}

describe('ZoneModalComponent — zone browse overlay (CR 406.3 / 706.2)', () => {
  it('titles the dialog by owner + zone for the graveyard', () => {
    const { fixture } = mount('graveyard', [card('a')], 'Alice');
    const heading = fixture.nativeElement.querySelector('h2') as HTMLElement;
    expect(heading.textContent).toContain("Alice's graveyard");
    expect(heading.textContent).toContain('(1)');
  });

  it('titles the dialog by owner + zone for exile', () => {
    const { fixture } = mount('exile', [card('a'), card('b')], 'Bob');
    const heading = fixture.nativeElement.querySelector('h2') as HTMLElement;
    expect(heading.textContent).toContain("Bob's exile");
    expect(heading.textContent).toContain('(2)');
  });

  it('renders one card tile per card in zone order', () => {
    const { fixture } = mount('exile', [card('a'), card('b'), card('c')]);
    const grid = fixture.nativeElement.querySelector('[data-testid="zone-modal-grid"]');
    expect(grid).not.toBeNull();
    expect(grid.querySelectorAll('app-card-view').length).toBe(3);
  });

  it('shows a zone-specific empty message when the zone is empty', () => {
    const { fixture } = mount('exile', [], 'Alice');
    const empty = fixture.nativeElement.querySelector('[data-testid="zone-modal-empty"]') as HTMLElement;
    expect(empty).not.toBeNull();
    expect(empty.textContent).toContain("Alice's exile is empty");
    expect(fixture.nativeElement.querySelector('[data-testid="zone-modal-grid"]')).toBeNull();
  });

  it('emits closed on Close button + backdrop click', () => {
    const { component, fixture } = mount('graveyard', [card('a')]);
    let closed = 0;
    component.closed.subscribe(() => closed++);

    (fixture.nativeElement.querySelector('[data-testid="zone-modal-close"]') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('[data-testid="zone-modal-backdrop"]') as HTMLElement).click();
    expect(closed).toBe(2);
  });

  it('carries the zone kind on the dialog body for styling hooks', () => {
    const { fixture } = mount('exile', [card('a')]);
    const body = fixture.nativeElement.querySelector('[data-zone-kind="exile"]');
    expect(body).not.toBeNull();
  });
});
