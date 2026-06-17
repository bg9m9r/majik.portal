import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InfoDrawerComponent } from './info-drawer.component';
import { LayoutPrefsService, LAYOUT_PREFS_KEY } from '../layout-prefs.service';
import { StackItemView } from './stack-list.component';
import { LogLine } from '../../../core/match/log.types';
import { BotDecision } from '../../../core/match/match.types';

beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const mem = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
      clear: () => mem.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  }
});

function stackView(id: string, label: string): StackItemView {
  return {
    id, kind: 'Spell', description: label, controllerId: null, cardName: label,
    mine: true, isOpponent: false, controllerName: null, label,
  };
}

const logLine = (seq: number): LogLine => ({ text: `e${seq}`, kind: 'cast', actorId: 'p1', seq });

function botDecision(chosen: string): BotDecision {
  return { decisionType: 'Priority', chosen, chosenScore: 1, alternatives: [], context: {}, receivedAt: seqId++ };
}
let seqId = 1;

function mount() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [InfoDrawerComponent] });
  const fix = TestBed.createComponent(InfoDrawerComponent);
  const prefs = TestBed.inject(LayoutPrefsService);
  return { fix, prefs };
}

describe('InfoDrawerComponent', () => {
  let fix: ComponentFixture<InfoDrawerComponent>;
  let prefs: LayoutPrefsService;

  beforeEach(() => {
    localStorage.removeItem(LAYOUT_PREFS_KEY);
    const m = mount();
    fix = m.fix;
    prefs = m.prefs;
    prefs.reset();
    fix.componentRef.setInput('stack', []);
    fix.componentRef.setInput('logEntries', []);
    fix.componentRef.setInput('selfIds', ['p1']);
    fix.componentRef.setInput('botDecisions', []);
    fix.detectChanges();
  });

  it('always renders the Stack pane (top) in the open drawer, regardless of bottom tab', () => {
    prefs.setInfoDrawerOpen(true);
    fix.componentRef.setInput('stack', [stackView('a', 'Bolt')]);
    fix.detectChanges();
    expect(fix.nativeElement.querySelector('app-stack-list')).toBeTruthy();
    // Stack stays mounted even when the bottom tab is on Bot Decisions.
    prefs.setInfoDrawerTab('bot');
    fix.detectChanges();
    expect(fix.nativeElement.querySelector('app-stack-list')).toBeTruthy();
  });

  it('toggle opens / closes the drawer and persists the state', () => {
    expect(prefs.infoDrawerOpen()).toBe(false);
    const tab = fix.nativeElement.querySelector('.info-drawer__edge-tab') as HTMLButtonElement;
    expect(tab).toBeTruthy();
    tab.click();
    fix.detectChanges();
    expect(prefs.infoDrawerOpen()).toBe(true);
    expect(fix.nativeElement.querySelector('.info-drawer--open')).toBeTruthy();
    tab.click();
    fix.detectChanges();
    expect(prefs.infoDrawerOpen()).toBe(false);
  });

  it('defaults the bottom tab to Log and renders the game log there', () => {
    prefs.setInfoDrawerOpen(true);
    fix.componentRef.setInput('logEntries', [logLine(0), logLine(1)]);
    fix.detectChanges();
    expect(prefs.infoDrawerTab()).toBe('log');
    expect(fix.nativeElement.querySelector('app-game-log')).toBeTruthy();
    expect(fix.nativeElement.querySelector('app-bot-decisions-list')).toBeNull();
  });

  it('switches the bottom tab to Bot Decisions (persisted) and swaps the content', () => {
    prefs.setInfoDrawerOpen(true);
    fix.componentRef.setInput('botDecisions', [botDecision('Cast Bolt')]);
    fix.detectChanges();
    const botTab = Array.from(
      fix.nativeElement.querySelectorAll('.info-drawer__bottom-tab'),
    ).find(b => (b as HTMLElement).textContent?.includes('Bot')) as HTMLButtonElement;
    expect(botTab).toBeTruthy();
    botTab.click();
    fix.detectChanges();
    expect(prefs.infoDrawerTab()).toBe('bot');
    expect(fix.nativeElement.querySelector('app-bot-decisions-list')).toBeTruthy();
    expect(fix.nativeElement.querySelector('app-game-log')).toBeNull();
  });

  it('the drag handle updates the persisted split ratio', () => {
    prefs.setInfoDrawerOpen(true);
    fix.detectChanges();
    const before = prefs.infoDrawerSplit();
    fix.componentInstance.onSplitResize(120);
    fix.componentInstance.onSplitResizeEnd();
    const after = prefs.infoDrawerSplit();
    expect(after).not.toBe(before);
    // Persisted: a fresh service reads the new value back.
    const reloaded = TestBed.inject(LayoutPrefsService);
    expect(reloaded.infoDrawerSplit()).toBe(after);
  });

  it('shows the bot-decisions empty state under the Bot tab when none received', () => {
    prefs.setInfoDrawerOpen(true);
    prefs.setInfoDrawerTab('bot');
    fix.detectChanges();
    expect(fix.nativeElement.textContent).toContain('No bot decisions yet.');
  });
});
