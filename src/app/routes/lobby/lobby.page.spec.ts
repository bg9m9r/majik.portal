import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { LobbyPage } from './lobby';
import { LobbyStore } from '../../core/lobby/lobby.store';
import { Match, CreateMatchRequest } from '../../core/match/match.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const m = (id: string): Match => ({
  id,
  state: 'Open',
  visibility: 'Public',
  format: 'constructed',
  clockMinutes: 25,
  creator: { sub: 'u1', handle: 'alice', deckId: 'd1' },
  opponent: null,
  roll: null,
  firstChoice: null,
  gameId: null,
  creatorMillisRemaining: 1500000,
  opponentMillisRemaining: 1500000,
  priorityHolderSub: null,
  priorityStartedAt: null,
  winnerSub: null,
  timeoutLoserSub: null,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
});

const req: CreateMatchRequest = {
  format: 'constructed',
  visibility: 'Public',
  deckId: 'd1',
  clockMinutes: 25,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LobbyPage — createdMatchId navigation', () => {
  let createdMatchIdSig: ReturnType<typeof signal<string | null>>;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let storeStub: any;

  function init() {
    createdMatchIdSig = signal<string | null>(null);
    router = { navigate: vi.fn(() => Promise.resolve(true)) };

    storeStub = {
      matches: () => [] as Match[],
      loading: () => false,
      error: () => null,
      createError: () => null,
      createdMatchId: createdMatchIdSig.asReadonly(),
      load: vi.fn(),
      create: vi.fn(),
      clearCreatedMatchId: vi.fn(),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        LobbyPage,
        { provide: LobbyStore, useValue: storeStub },
        { provide: Router, useValue: router },
      ],
    });

    return TestBed.inject(LobbyPage);
  }

  it('does NOT navigate when createdMatchId is null on construction', () => {
    init();
    TestBed.tick();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('navigates to /match/:id when createdMatchId becomes non-null', () => {
    init();
    TestBed.tick(); // flush initial effect (null → no-op)

    createdMatchIdSig.set('match-abc');
    TestBed.tick(); // flush effect after signal change

    expect(router.navigate).toHaveBeenCalledWith(['/match', 'match-abc']);
  });

  it('calls store.clearCreatedMatchId() after navigation', () => {
    init();
    TestBed.tick();

    createdMatchIdSig.set('match-abc');
    TestBed.tick();

    expect(storeStub.clearCreatedMatchId).toHaveBeenCalledTimes(1);
  });

  it('onCreate delegates to store.create', () => {
    const page = init();
    page.onCreate(req);
    expect(storeStub.create).toHaveBeenCalledWith(req);
  });

  it('open() navigates to /match/:id directly', () => {
    const page = init();
    page.open(m('direct-id'));
    expect(router.navigate).toHaveBeenCalledWith(['/match', 'direct-id']);
  });

  it('navigates once per unique non-null id (does not re-navigate after clear)', () => {
    init();
    TestBed.tick();

    createdMatchIdSig.set('match-xyz');
    TestBed.tick();
    expect(router.navigate).toHaveBeenCalledTimes(1);

    // Simulate what clearCreatedMatchId() would do in the real store:
    // the effect cleared it to null, so resetting to null here verifies
    // the guard works.
    createdMatchIdSig.set(null);
    TestBed.tick();
    expect(router.navigate).toHaveBeenCalledTimes(1); // still 1, no new call
  });
});
