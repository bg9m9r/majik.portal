import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { StackListComponent, StackItemView } from './stack-list.component';

function view(over: Partial<StackItemView> & Pick<StackItemView, 'id' | 'kind'>): StackItemView {
  return {
    id: over.id,
    kind: over.kind,
    description: over.description ?? '',
    controllerId: over.controllerId ?? null,
    cardName: over.cardName ?? null,
    mine: over.mine ?? false,
    isOpponent: over.isOpponent ?? false,
    controllerName: over.controllerName ?? null,
    label: over.label ?? over.cardName ?? over.description ?? over.kind,
  };
}

describe('StackListComponent', () => {
  let fix: ComponentFixture<StackListComponent>;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StackListComponent] });
    fix = TestBed.createComponent(StackListComponent);
  });

  it('renders one row per stack item (newest-first as supplied)', () => {
    fix.componentRef.setInput('items', [
      view({ id: 'a', kind: 'Spell', label: 'Lightning Bolt' }),
      view({ id: 'b', kind: 'Spell', label: 'Brainstorm' }),
    ]);
    fix.detectChanges();
    const rows = fix.nativeElement.querySelectorAll('.stack-item');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Lightning Bolt');
  });

  it('marks the top-of-stack (first) item with stack-item--top + a "next" badge', () => {
    fix.componentRef.setInput('items', [
      view({ id: 'a', kind: 'Spell', label: 'Top' }),
      view({ id: 'b', kind: 'Spell', label: 'Below' }),
    ]);
    fix.detectChanges();
    const rows = fix.nativeElement.querySelectorAll('.stack-item');
    expect(rows[0].classList.contains('stack-item--top')).toBe(true);
    expect(rows[1].classList.contains('stack-item--top')).toBe(false);
    expect(rows[0].querySelector('.stack-item__badge')?.textContent).toContain('next');
  });

  it('marks triggered abilities and opponent objects', () => {
    fix.componentRef.setInput('items', [
      view({ id: 't', kind: 'TriggeredAbility', label: 'ETB', isOpponent: true }),
      view({ id: 's', kind: 'Spell', label: 'Mine', mine: true }),
    ]);
    fix.detectChanges();
    const rows = Array.from(
      fix.nativeElement.querySelectorAll('.stack-item'),
    ) as HTMLElement[];
    const trig = rows.find(r => r.getAttribute('data-stack-kind') === 'TriggeredAbility')!;
    const mine = rows.find(r => r.getAttribute('data-stack-kind') === 'Spell')!;
    expect(trig.classList.contains('stack-item--trigger')).toBe(true);
    expect(trig.classList.contains('stack-item--opponent')).toBe(true);
    expect(mine.classList.contains('stack-item--mine')).toBe(true);
  });

  it('shows an empty placeholder when the stack is empty', () => {
    fix.componentRef.setInput('items', []);
    fix.detectChanges();
    expect(fix.nativeElement.querySelectorAll('.stack-item').length).toBe(0);
    expect(fix.nativeElement.textContent.toLowerCase()).toContain('empty');
  });
});
