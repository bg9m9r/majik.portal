import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { GameLogComponent } from './game-log.component';
import { LogLine } from '../../../core/match/log.types';

const lines = (n: number): LogLine[] =>
  Array.from({ length: n }, (_, i) => ({ text: `line ${i}`, kind: 'cast' as const, actorId: 'p1', seq: i }));

describe('GameLogComponent (list-only)', () => {
  let fix: ComponentFixture<GameLogComponent>;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [GameLogComponent] });
    fix = TestBed.createComponent(GameLogComponent);
  });

  it('renders one row per entry (always — host owns visibility now)', () => {
    fix.componentRef.setInput('entries', lines(3));
    fix.componentRef.setInput('selfIds', ['p1']);
    fix.detectChanges();
    expect(fix.nativeElement.querySelectorAll('[data-log-row]').length).toBe(3);
  });

  it('carries no drawer chrome (no own tab / no .game-log wrapper)', () => {
    fix.componentRef.setInput('entries', lines(1));
    fix.detectChanges();
    expect(fix.nativeElement.querySelector('.game-log__tab')).toBeNull();
    expect(fix.nativeElement.querySelector('.game-log')).toBeNull();
  });

  it('color-codes rows by actor (self / foe)', () => {
    fix.componentRef.setInput('entries', [
      { text: 'you', kind: 'cast' as const, actorId: 'p1', seq: 0 },
      { text: 'foe', kind: 'cast' as const, actorId: 'p2', seq: 1 },
    ]);
    fix.componentRef.setInput('selfIds', ['p1']);
    fix.detectChanges();
    const rows = fix.nativeElement.querySelectorAll('[data-log-row]');
    expect(rows[0].classList.contains('is-self')).toBe(true);
    expect(rows[1].classList.contains('is-foe')).toBe(true);
  });

  it('dims turn/phase meta rows', () => {
    fix.componentRef.setInput('entries', [
      { text: 'Turn 1', kind: 'turn' as const, actorId: null, seq: 0 },
    ]);
    fix.detectChanges();
    const row = fix.nativeElement.querySelector('[data-log-row]');
    expect(row.classList.contains('is-meta')).toBe(true);
  });
});
