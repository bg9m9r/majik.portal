import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { GameLogComponent } from './game-log.component';
import { LogLine } from '../../../core/match/log.types';

const lines = (n: number): LogLine[] =>
  Array.from({ length: n }, (_, i) => ({ text: `line ${i}`, kind: 'cast' as const, actorId: 'p1', seq: i }));

describe('GameLogComponent', () => {
  let fix: ComponentFixture<GameLogComponent>;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [GameLogComponent] });
    fix = TestBed.createComponent(GameLogComponent);
  });

  it('renders one row per entry when open', () => {
    fix.componentRef.setInput('entries', lines(3));
    fix.componentRef.setInput('selfIds', ['p1']);
    fix.componentInstance.open.set(true);
    fix.detectChanges();
    expect(fix.nativeElement.querySelectorAll('[data-log-row]').length).toBe(3);
  });

  it('is closed by default (no rows rendered)', () => {
    fix.componentRef.setInput('entries', lines(2));
    fix.detectChanges();
    expect(fix.componentInstance.open()).toBe(false);
    expect(fix.nativeElement.querySelectorAll('[data-log-row]').length).toBe(0);
  });

  it('toggles open/closed', () => {
    fix.componentRef.setInput('entries', lines(1));
    fix.detectChanges();
    expect(fix.componentInstance.open()).toBe(false);
    fix.componentInstance.toggle();
    expect(fix.componentInstance.open()).toBe(true);
  });

  it('color-codes rows by actor (self / foe)', () => {
    fix.componentRef.setInput('entries', [
      { text: 'you', kind: 'cast' as const, actorId: 'p1', seq: 0 },
      { text: 'foe', kind: 'cast' as const, actorId: 'p2', seq: 1 },
    ]);
    fix.componentRef.setInput('selfIds', ['p1']);
    fix.componentInstance.open.set(true);
    fix.detectChanges();
    const rows = fix.nativeElement.querySelectorAll('[data-log-row]');
    expect(rows[0].classList.contains('is-self')).toBe(true);
    expect(rows[1].classList.contains('is-foe')).toBe(true);
  });
});
