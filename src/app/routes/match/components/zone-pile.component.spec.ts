import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { ZoneKind, ZonePileComponent } from './zone-pile.component';
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

function mount(
  kind: ZoneKind,
  cards: CardSnapshot[],
  side: 'self' | 'opponent' = 'self',
  ownerName = 'Alice',
) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [ZonePileComponent] });
  const fixture = TestBed.createComponent(ZonePileComponent);
  const ref: ComponentRef<ZonePileComponent> = fixture.componentRef;
  ref.setInput('kind', kind);
  ref.setInput('cards', cards);
  ref.setInput('ownerSide', side);
  ref.setInput('ownerName', ownerName);
  fixture.detectChanges();
  return { component: fixture.componentInstance, fixture };
}

describe('ZonePileComponent — off-battlefield zone tile', () => {
  it('renders the zone label + count for an exile pile', () => {
    const { fixture } = mount('exile', [card({ instanceId: 'a' }), card({ instanceId: 'b' })]);
    const root = fixture.nativeElement.querySelector(
      '[data-testid="zone-pile-exile-self"]',
    ) as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.textContent).toContain('Exile');
    const count = fixture.nativeElement.querySelector(
      '[data-testid="zone-pile-count"]',
    ) as HTMLElement;
    expect(count.textContent?.trim()).toBe('2');
  });

  it('renders a graveyard pile with its count', () => {
    const { fixture } = mount('graveyard', [card({ instanceId: 'a' })]);
    const root = fixture.nativeElement.querySelector(
      '[data-testid="zone-pile-graveyard-self"]',
    ) as HTMLElement;
    expect(root.textContent).toContain('Graveyard');
    expect(
      (fixture.nativeElement.querySelector('[data-testid="zone-pile-count"]') as HTMLElement)
        .textContent?.trim(),
    ).toBe('1');
  });

  it('renders an empty zone sanely (count 0, empty modifier, no thumbnail)', () => {
    const { component, fixture } = mount('exile', []);
    expect(component.count()).toBe(0);
    expect(component.topCard()).toBeNull();
    const root = fixture.nativeElement.querySelector(
      '[data-testid="zone-pile-exile-self"]',
    ) as HTMLElement;
    expect(root.classList.contains('zone-pile--empty')).toBe(true);
    expect(root.querySelector('.zone-pile__thumb')).toBeNull();
    expect(
      (fixture.nativeElement.querySelector('[data-testid="zone-pile-count"]') as HTMLElement)
        .textContent?.trim(),
    ).toBe('0');
  });

  it('shows the most-recently-added card (last in cards[]) as the top thumbnail', () => {
    // CR 404.1 — most-recently-added is at the end of the snapshot list.
    const { component } = mount('graveyard', [
      card({ instanceId: 'old', name: 'Old' }),
      card({ instanceId: 'new', name: 'New' }),
    ]);
    expect(component.topCard()?.instanceId).toBe('new');
  });

  it('browsable graveyard / exile render as a clickable button and emit expand', () => {
    const { component, fixture } = mount('exile', [card({ instanceId: 'a' })]);
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="zone-pile-exile-self"]',
    ) as HTMLButtonElement;
    expect(btn.tagName).toBe('BUTTON');
    let expanded = 0;
    component.expand.subscribe(() => expanded++);
    btn.click();
    expect(expanded).toBe(1);
  });

  it('library is non-browsable — renders as static status, never a button', () => {
    const { fixture } = mount('library', [card({ instanceId: 'a' }), card({ instanceId: 'b' })]);
    const root = fixture.nativeElement.querySelector(
      '[data-testid="zone-pile-library-self"]',
    ) as HTMLElement;
    expect(root.tagName).not.toBe('BUTTON');
    expect(root.getAttribute('role')).toBe('status');
    // Hidden zone — no top-card thumbnail leaking the library.
    expect(root.querySelector('.zone-pile__thumb')).toBeNull();
    expect(root.textContent).toContain('Library');
    expect(root.textContent).toContain('2');
  });

  it('routes data-testid by zone kind + owner side so every tile is reachable', () => {
    const a = [card({ instanceId: 'a' })];
    const { fixture: selfGy } = mount('graveyard', a, 'self');
    const { fixture: oppEx } = mount('exile', a, 'opponent', 'Bob');
    expect(selfGy.nativeElement.querySelector('[data-testid="zone-pile-graveyard-self"]')).not.toBeNull();
    expect(oppEx.nativeElement.querySelector('[data-testid="zone-pile-exile-opponent"]')).not.toBeNull();
  });

  it('aria-label reflects owner, zone, count, and view affordance', () => {
    const { fixture } = mount('exile', [card({ instanceId: 'a' }), card({ instanceId: 'b' })], 'opponent', 'Bob');
    const root = fixture.nativeElement.querySelector(
      '[data-testid="zone-pile-exile-opponent"]',
    ) as HTMLElement;
    const label = root.getAttribute('aria-label') ?? '';
    expect(label).toContain('Bob');
    expect(label).toContain('exile');
    expect(label).toContain('2');
    expect(label).toContain('view');
  });

  it('library aria-label announces the count without a "view" affordance', () => {
    const { fixture } = mount('library', [card({ instanceId: 'a' })], 'self', 'Alice');
    const root = fixture.nativeElement.querySelector(
      '[data-testid="zone-pile-library-self"]',
    ) as HTMLElement;
    const label = root.getAttribute('aria-label') ?? '';
    expect(label).toContain('Alice');
    expect(label).toContain('library');
    expect(label).toContain('1 card');
    expect(label).not.toContain('view');
  });
});
