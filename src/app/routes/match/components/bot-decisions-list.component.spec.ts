import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { BotDecisionsListComponent } from './bot-decisions-list.component';
import { BotDecision } from '../../../core/match/match.types';

function decision(over: Partial<BotDecision> = {}): BotDecision {
  return {
    decisionType: over.decisionType ?? 'Priority',
    chosen: over.chosen ?? 'Cast Lightning Bolt',
    chosenScore: over.chosenScore ?? 1.5,
    alternatives: over.alternatives ?? [],
    context: over.context ?? {},
    receivedAt: over.receivedAt ?? Date.now(),
  };
}

describe('BotDecisionsListComponent', () => {
  let fix: ComponentFixture<BotDecisionsListComponent>;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BotDecisionsListComponent] });
    fix = TestBed.createComponent(BotDecisionsListComponent);
  });

  it('renders one row per decision', () => {
    fix.componentRef.setInput('decisions', [
      decision({ chosen: 'A', receivedAt: 1 }),
      decision({ chosen: 'B', receivedAt: 2 }),
    ]);
    fix.detectChanges();
    expect(fix.nativeElement.querySelectorAll('li').length).toBe(2);
    expect(fix.nativeElement.textContent).toContain('A');
    expect(fix.nativeElement.textContent).toContain('B');
  });

  it('renders a top-alternative line when present', () => {
    fix.componentRef.setInput('decisions', [
      decision({ chosen: 'Cast', alternatives: [{ name: 'Hold', score: 0.2 }] }),
    ]);
    fix.detectChanges();
    expect(fix.nativeElement.textContent).toContain('Hold');
  });

  it('shows an empty placeholder when there are no decisions', () => {
    fix.componentRef.setInput('decisions', []);
    fix.detectChanges();
    expect(fix.nativeElement.querySelectorAll('li').length).toBe(0);
    expect(fix.nativeElement.textContent).toContain('No bot decisions yet.');
  });

  it('carries no fixed-position chrome / toggle button', () => {
    fix.componentRef.setInput('decisions', []);
    fix.detectChanges();
    expect(fix.nativeElement.querySelector('button')).toBeNull();
    expect(fix.nativeElement.querySelector('.fixed')).toBeNull();
  });
});
