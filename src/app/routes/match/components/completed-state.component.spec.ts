import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CompletedStateComponent } from './completed-state.component';
import { Match } from '../../../core/match/match.types';

// CompletedStateComponent owns the "Download replay" affordance. The
// click path is end-to-end-ish: it calls MatchService.getReplay (an
// HttpClient round-trip) and on success synthesizes a blob + anchor
// click. These tests stub the anchor side at the document layer so we
// can assert filename + payload without actually saving anything.

function buildMatch(over: Partial<Match> = {}): Match {
  return {
    id: 'match-123',
    state: 'Completed',
    visibility: 'Invite',
    format: 'constructed',
    clockMinutes: 20,
    creator: { sub: 'sub-alice', handle: 'Alice', deckId: 'd-1', deckSnapshot: [] },
    opponent: { sub: 'sub-bob', handle: 'Bob', deckId: 'd-2', deckSnapshot: [] },
    creatorMillisRemaining: 1000,
    opponentMillisRemaining: 1000,
    winnerSub: 'sub-alice',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:01:00Z',
    ...over,
  } as Match;
}

function mount(match: Match) {
  TestBed.configureTestingModule({
    imports: [CompletedStateComponent],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(CompletedStateComponent);
  const ref: ComponentRef<CompletedStateComponent> = fixture.componentRef;
  ref.setInput('match', match);
  fixture.detectChanges();
  return { fixture, http: TestBed.inject(HttpTestingController) };
}

describe('CompletedStateComponent — replay download', () => {
  let savedFilename: string | null;
  let savedJson: string | null;
  let clickedAnchor = false;

  beforeEach(() => {
    savedFilename = null;
    savedJson = null;
    clickedAnchor = false;

    // Stub the anchor + URL plumbing so click() doesn't try to navigate.
    // We intercept createObjectURL to capture the JSON payload (read
    // back from the Blob synchronously via FileReader-less text() — but
    // text() is async, so we capture from the Blob constructor instead).
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      // jsdom Blob exposes .text(); resolve synchronously isn't possible,
      // but we don't need to — the constructor argument is what we want.
      // Capture the JSON via Blob.text() and await it in the test.
      void blob.text().then(t => { savedJson = t; });
      return 'blob:fake';
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();

    // Spy anchor.click so the test process doesn't open new tabs.
    // We don't override document.createElement (that recurses through
    // vi.spyOn); instead, hook prototype methods on the anchor returned
    // from the real createElement.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedAnchor = true;
      savedFilename = this.getAttribute('download');
    });

    void origCreateObjectURL; // keep ref alive
  });

  it('button renders with default label', () => {
    const { fixture } = mount(buildMatch());
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent?.trim()).toBe('Download replay');
    expect(btn.disabled).toBe(false);
  });

  it('clicking the button fetches /replay and triggers a JSON file download', async () => {
    const { fixture, http } = mount(buildMatch({ id: 'match-xyz' }));
    const component = fixture.componentInstance as unknown as { onDownloadReplay(): Promise<void> };
    const downloadPromise = component.onDownloadReplay();
    fixture.detectChanges();

    const req = http.expectOne(r => r.method === 'GET' && r.url.endsWith('/matches/match-xyz/replay'));
    const payload = {
      matchId: 'match-xyz',
      sealedAt: '2025-01-01T00:01:00Z',
      truncated: false,
      entryCount: 1,
      entries: [{ seq: 1, at: '2025-01-01T00:00:00Z', kind: 'event', event: { type: 'TurnStartedEvent' }, decision: null }],
    };
    req.flush(payload);
    await downloadPromise;
    // Blob.text() resolves on the next microtask; the stub uses void on
    // its promise so we need one extra spin to let it settle.
    await new Promise<void>(r => setTimeout(r, 0));

    expect(clickedAnchor).toBe(true);
    expect(savedFilename).toBe('majik-replay-match-xyz.json');
    expect(savedJson).toBeTruthy();
    expect(JSON.parse(savedJson!)).toEqual(payload);
  });

  it('renders the aborted header (not "Match over") for an Errored match', () => {
    const { fixture } = mount(buildMatch({ state: 'Errored', winnerSub: undefined }));
    const h2 = fixture.nativeElement.querySelector('h2') as HTMLElement;
    expect(h2.textContent?.trim()).toBe('Match aborted');
    expect(h2.textContent?.trim()).not.toBe('Match over');
  });

  it('explains the engine error in a sub-line for an Errored match', () => {
    const { fixture } = mount(buildMatch({ state: 'Errored', winnerSub: undefined }));
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('engine error');
    expect(text).toContain("isn't a loss");
  });

  it('keeps "Match over" header for a Completed match', () => {
    const { fixture } = mount(buildMatch({ state: 'Completed' }));
    const h2 = fixture.nativeElement.querySelector('h2') as HTMLElement;
    expect(h2.textContent?.trim()).toBe('Match over');
  });

  it('surfaces inline error and does NOT download when server returns 404', async () => {
    const { fixture, http } = mount(buildMatch({ id: 'gone' }));
    const component = fixture.componentInstance as unknown as { onDownloadReplay(): Promise<void> };
    const downloadPromise = component.onDownloadReplay();
    fixture.detectChanges();

    const req = http.expectOne(r => r.url.endsWith('/matches/gone/replay'));
    req.flush({ error: 'match-not-found' }, { status: 404, statusText: 'Not Found' });
    await downloadPromise;
    fixture.detectChanges();

    expect(clickedAnchor).toBe(false);
    const err = fixture.nativeElement.querySelector('p.text-xs') as HTMLElement;
    expect(err?.textContent ?? '').toContain('match-not-found');
  });
});
