import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { VisualStacksZoneComponent } from './visual-stacks-zone.component';
import { DeckEditorStore } from '../../../../core/deck/deck-editor.store';
import { CardSearchStore } from '../../../../core/card/card-search.store';
import { Card } from '../../../../core/card/card.types';

function card(name: string, cmc: number | null, types: string[]): Card {
  return {
    name,
    cmc,
    types,
    manaCost: '',
    power: null,
    toughness: null,
    isImplemented: true,
    colors: [],
    oracleText: null,
  };
}

interface Setup {
  mainboard: { name: string; count: number }[];
  byName: Record<string, Card>;
  activeZone?: 'main' | 'side';
  sideboard?: { name: string; count: number }[];
}

function setup(s: Setup) {
  const storeStub = {
    activeZone: () => s.activeZone ?? 'main',
    mainboard: () => s.mainboard,
    sideboard: () => s.sideboard ?? [],
    inc: vi.fn(),
    dec: vi.fn(),
    remove: vi.fn(),
    add: vi.fn(),
  };
  TestBed.configureTestingModule({
    imports: [VisualStacksZoneComponent],
    providers: [
      { provide: DeckEditorStore, useValue: storeStub },
      { provide: CardSearchStore, useValue: { byName: () => s.byName } },
    ],
  });
  const fx = TestBed.createComponent(VisualStacksZoneComponent);
  fx.detectChanges();
  return { fx, storeStub };
}

describe('VisualStacksZoneComponent', () => {
  it('groups cards into columns by CMC bucket, lands last (before Other)', () => {
    const { fx } = setup({
      mainboard: [
        { name: 'Bolt', count: 4 },
        { name: 'Bears', count: 4 },
        { name: 'Forest', count: 24 },
        { name: 'Wrath', count: 2 },
        { name: 'Jace', count: 1 },
      ],
      byName: {
        Bolt: card('Bolt', 1, ['Instant']),
        Bears: card('Bears', 2, ['Creature']),
        Forest: card('Forest', null, ['Basic', 'Land']),
        Wrath: card('Wrath', 4, ['Sorcery']),
        Jace: card('Jace', 4, ['Planeswalker']),
      },
    });
    const cols = fx.componentInstance.columns();
    expect(cols.map((c) => c.label)).toEqual(['1', '2', '4', 'Lands']);
    expect(cols.find((c) => c.type === 'Land')!.total).toBe(24);
    expect(cols.find((c) => c.type === '4')!.total).toBe(3);
    expect(cols.find((c) => c.type === '1')!.total).toBe(4);
  });

  it('buckets cmc 0 in the 0 column, including artifacts with 0 cost', () => {
    const { fx } = setup({
      mainboard: [{ name: 'Walking Ballista', count: 2 }],
      byName: {
        'Walking Ballista': card('Walking Ballista', 0, ['Artifact', 'Creature']),
      },
    });
    const cols = fx.componentInstance.columns();
    expect(cols).toHaveLength(1);
    expect(cols[0].type).toBe('0');
  });

  it('buckets cmc >= 7 into the 7+ column', () => {
    const { fx } = setup({
      mainboard: [
        { name: 'Emrakul', count: 1 },
        { name: 'Big Spell', count: 1 },
      ],
      byName: {
        Emrakul: card('Emrakul', 15, ['Creature']),
        'Big Spell': card('Big Spell', 7, ['Sorcery']),
      },
    });
    const cols = fx.componentInstance.columns();
    expect(cols).toHaveLength(1);
    expect(cols[0].type).toBe('7+');
    expect(cols[0].total).toBe(2);
  });

  it('routes any Land-type card to the Lands column regardless of cmc', () => {
    const { fx } = setup({
      mainboard: [
        { name: 'Forest', count: 4 },
        { name: "Mishra's Workshop", count: 1 },
      ],
      byName: {
        Forest: card('Forest', null, ['Basic', 'Land']),
        "Mishra's Workshop": card("Mishra's Workshop", 0, ['Land']),
      },
    });
    const cols = fx.componentInstance.columns();
    expect(cols).toHaveLength(1);
    expect(cols[0].type).toBe('Land');
    expect(cols[0].total).toBe(5);
  });

  it('places entries without cached card metadata into the Other column', () => {
    const { fx } = setup({
      mainboard: [
        { name: 'UnknownCard', count: 1 },
        { name: 'Bears', count: 1 },
      ],
      byName: { Bears: card('Bears', 2, ['Creature']) },
    });
    const cols = fx.componentInstance.columns();
    const other = cols.find((c) => c.type === 'Other');
    expect(other).toBeDefined();
    expect(other!.entries[0].name).toBe('UnknownCard');
  });

  it('sorts entries within a column by name when cmc ties', () => {
    const { fx } = setup({
      mainboard: [
        { name: 'B Bear', count: 1 },
        { name: 'A Bear', count: 1 },
      ],
      byName: {
        'B Bear': card('B Bear', 3, ['Creature']),
        'A Bear': card('A Bear', 3, ['Creature']),
      },
    });
    const col = fx.componentInstance.columns().find((c) => c.type === '3')!;
    expect(col.entries.map((e) => e.name)).toEqual(['A Bear', 'B Bear']);
  });

  it('renders the empty placeholder when active zone has no entries', () => {
    const { fx } = setup({ mainboard: [], byName: {} });
    expect(fx.nativeElement.textContent).toContain('drop cards here');
    expect(fx.nativeElement.querySelector('app-card-tile')).toBeNull();
  });

  it('renders count card tiles per entry (stack depth = count)', () => {
    const { fx } = setup({
      mainboard: [{ name: 'Bears', count: 3 }],
      byName: { Bears: card('Bears', 2, ['Creature']) },
    });
    expect(fx.nativeElement.querySelectorAll('app-card-tile').length).toBe(3);
  });

  it('hover controls call store inc/dec/remove for the entry', () => {
    const { fx, storeStub } = setup({
      mainboard: [{ name: 'Bears', count: 2 }],
      byName: { Bears: card('Bears', 2, ['Creature']) },
    });
    const entry = fx.nativeElement.querySelector('[data-entry="Bears"]') as HTMLElement;
    const inc = entry.querySelector('[aria-label="Increment Bears"]') as HTMLButtonElement;
    const dec = entry.querySelector('[aria-label="Decrement Bears"]') as HTMLButtonElement;
    const rm = entry.querySelector('[aria-label="Remove Bears"]') as HTMLButtonElement;
    inc.click();
    dec.click();
    rm.click();
    expect(storeStub.inc).toHaveBeenCalledWith('Bears');
    expect(storeStub.dec).toHaveBeenCalledWith('Bears');
    expect(storeStub.remove).toHaveBeenCalledWith('Bears');
  });

  it('keeps cdkDropList with id zone-drop for card-pool drag-add', () => {
    const { fx } = setup({ mainboard: [], byName: {} });
    expect(fx.nativeElement.querySelector('#zone-drop')).not.toBeNull();
  });

  it('onDropped with Card object adds the card to the store', () => {
    const { fx, storeStub } = setup({ mainboard: [], byName: {} });
    const c = card('Bolt', 1, ['Instant']);
    fx.componentInstance.onDropped({ item: { data: c } });
    expect(storeStub.add).toHaveBeenCalledWith('Bolt');
  });

  it('onDropped with string data is a no-op (reorder)', () => {
    const { fx, storeStub } = setup({
      mainboard: [{ name: 'Bears', count: 1 }],
      byName: { Bears: card('Bears', 2, ['Creature']) },
    });
    fx.componentInstance.onDropped({ item: { data: 'Bears' } });
    expect(storeStub.add).not.toHaveBeenCalled();
  });

  it('reflects active sideboard zone when activeZone is "side"', () => {
    const { fx } = setup({
      mainboard: [{ name: 'Bolt', count: 4 }],
      sideboard: [{ name: 'Bears', count: 2 }],
      activeZone: 'side',
      byName: {
        Bolt: card('Bolt', 1, ['Instant']),
        Bears: card('Bears', 2, ['Creature']),
      },
    });
    const cols = fx.componentInstance.columns();
    expect(cols.map((c) => c.label)).toEqual(['2']);
    expect(cols[0].entries[0].name).toBe('Bears');
  });
});
