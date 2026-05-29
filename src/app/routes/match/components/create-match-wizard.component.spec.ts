import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach } from 'vitest';
import { DecksStore } from '../../../core/deck/deck.store';
import { Deck } from '../../../core/deck/deck.types';
import { MatchService } from '../../../core/match/match.service';
import { CreateMatchRequest } from '../../../core/match/match.types';
import { CreateMatchWizardComponent } from './create-match-wizard.component';

const d = (id: string, name: string): Deck => ({
  id, ownerSub: 'u', name, mainboard: [], sideboard: [], createdAt: 't', updatedAt: 't',
});

const ARCHETYPES = [
  { key: 'Burn', label: 'Burn' },
  { key: 'Prowess', label: 'Prowess' },
  { key: 'BorosEnergy', label: 'Boros Energy' },
];

// Flush the constructor's async archetype load (microtask + Promise chain).
const flush = () => new Promise(r => setTimeout(r, 0));

function render(decks: Deck[]) {
  TestBed.configureTestingModule({
    imports: [CreateMatchWizardComponent],
    providers: [
      provideRouter([]),
      { provide: DecksStore, useValue: { all: () => decks, count: () => decks.length } },
      { provide: MatchService, useValue: { listBotArchetypes: async () => ({ ok: true, value: ARCHETYPES }) } },
    ],
  });
  const fx = TestBed.createComponent(CreateMatchWizardComponent);
  fx.detectChanges();
  return fx;
}

describe('CreateMatchWizardComponent (deck dropdown)', () => {
  it('shows empty state link when no decks', () => {
    const fx = render([]);
    expect(fx.nativeElement.textContent).toContain('No decks yet');
    const link = fx.nativeElement.querySelector('a[href="/decks/new"]');
    expect(link).not.toBeNull();
  });

  it('auto-selects first deck so submit is enabled immediately', () => {
    const fx = render([d('a', 'Alpha'), d('b', 'Beta')]);
    expect(fx.componentInstance.deckId()).toBe('a');
    const btn = fx.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('emits create event with selected deckId', () => {
    const fx = render([d('a', 'Alpha'), d('b', 'Beta')]);
    let captured: CreateMatchRequest | undefined;
    fx.componentInstance.create.subscribe(e => { captured = e; });
    fx.componentInstance.deckId.set('b');
    fx.detectChanges();
    const btn = fx.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(captured?.deckId).toBe('b');
  });

  it('shows bot archetype dropdown with spaced labels when vsBot toggled on', async () => {
    const fx = render([d('a', 'Alpha')]);
    await flush();
    fx.componentInstance.vsBot.set(true);
    fx.detectChanges();
    const sel = fx.nativeElement.querySelector('select[name="botArchetype"]') as HTMLSelectElement;
    expect(sel).not.toBeNull();
    expect(sel.options.length).toBeGreaterThanOrEqual(3);
    // Server-supplied label is rendered (spaced), key is the option value.
    const boros = Array.from(sel.options).find(o => o.value === 'BorosEnergy');
    expect(boros?.text).toBe('Boros Energy');
  });

  it('emits create event with botOpponent set when vsBot is on', () => {
    const fx = render([d('a', 'Alpha')]);
    let captured: CreateMatchRequest | undefined;
    fx.componentInstance.create.subscribe((e: CreateMatchRequest) => { captured = e; });
    fx.componentInstance.vsBot.set(true);
    fx.componentInstance.botArchetype.set('Burn');
    fx.detectChanges();
    const btn = fx.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    btn.click();
    expect(captured?.botOpponent?.archetype).toBe('Burn');
    expect(captured?.visibility).toBe('Invite');
  });
});
