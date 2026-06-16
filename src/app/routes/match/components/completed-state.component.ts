import { Component, inject, input, signal } from '@angular/core';
import { MatchService } from '../../../core/match/match.service';
import { Match } from '../../../core/match/match.types';

@Component({
  selector: 'app-completed-state',
  standalone: true,
  template: `
    <div class="mx-auto flex max-w-xl flex-col items-center gap-6 p-8">
      <h2 class="majik-display-2">{{ match().state === 'Errored' ? 'Match aborted' : match().state === 'Abandoned' ? 'Abandoned' : 'Match over' }}</h2>

      @if (match().state === 'Errored') {
        <p class="text-sm text-amber-300/80">
          An engine error ended this match. It was aborted by the server —
          this isn't a loss for either player.
        </p>
      }

      @if (winnerHandle(); as w) {
        <p class="majik-h3 text-[color:var(--majik-accent)]">{{ w }} wins</p>
      }

      <dl class="flex flex-col gap-2 text-sm">
        @if (reason(); as r) {
          <div class="flex items-center justify-between gap-8">
            <dt class="opacity-60">Reason</dt>
            <dd class="majik-mono">{{ r }}</dd>
          </div>
        }
        <div class="flex items-center justify-between gap-8">
          <dt class="opacity-60">State</dt>
          <dd class="majik-mono">{{ match().state }}</dd>
        </div>
      </dl>

      <!--
        Replay download — fetches /matches/:id/replay (captured in-memory
        on the server while the match was live) and saves the JSON to
        disk. Visible on both Completed and Abandoned terminal states;
        the server seals the buffer at terminal-state Detach so the
        download reflects the full stream up to that point. If the
        buffer was already evicted (LRU under
        MatchReplayBuffer.MaxRetainedMatches) the GET 404s and we
        surface a friendly inline message.
      -->
      <div class="flex flex-col items-center gap-2">
        <button
          type="button"
          class="rounded border border-[color:var(--majik-line)] px-4 py-2 text-sm hover:bg-[color:var(--majik-line)]/30 disabled:opacity-50 disabled:cursor-wait"
          [disabled]="downloading()"
          (click)="onDownloadReplay()">
          {{ downloading() ? 'Preparing…' : 'Download replay' }}
        </button>
        @if (downloadError(); as err) {
          <p class="text-xs text-red-300/80">{{ err }}</p>
        }
      </div>
    </div>
  `,
})
export class CompletedStateComponent {
  readonly match = input.required<Match>();
  protected readonly downloading = signal(false);
  protected readonly downloadError = signal<string | null>(null);

  private readonly matchSvc = inject(MatchService);

  winnerHandle(): string | null {
    const m = this.match();
    if (!m.winnerSub) return null;
    if (m.winnerSub === m.creator.sub) return m.creator.handle;
    if (m.opponent && m.winnerSub === m.opponent.sub) return m.opponent.handle;
    return m.winnerSub;
  }

  reason(): string | null {
    const m = this.match();
    if (m.timeoutLoserSub) return 'timeout';
    if (m.state === 'Errored') return 'engine-error';
    if (m.state === 'Abandoned') return 'abandoned';
    if (m.winnerSub) return 'engine';
    return null;
  }

  /**
   * Fetch the replay JSON and save it as a file. The blob is built from
   * the DTO returned by the API (we re-serialize rather than streaming
   * the raw response body so the saved file has stable formatting and
   * matches the shape the API claims to return).
   *
   * Failures show inline rather than via a toast — the button is a
   * single-shot UI affordance on the terminal-state screen, so the user
   * is already focused here. We deliberately do NOT retry: a 404 means
   * the buffer was evicted (LRU), which a retry can't fix.
   */
  protected async onDownloadReplay(): Promise<void> {
    if (this.downloading()) return;
    this.downloading.set(true);
    this.downloadError.set(null);
    try {
      const result = await this.matchSvc.getReplay(this.match().id);
      if (!result.ok) {
        // match-not-found here typically means "buffer evicted" or
        // "the server never captured this match" — show the raw code
        // so user can hand it to support if they care, otherwise just
        // see that the download isn't available.
        this.downloadError.set(`Replay unavailable (${result.error.code}).`);
        return;
      }
      saveJsonFile(`majik-replay-${this.match().id}.json`, result.value);
    } catch (err) {
      // Defensive — saveJsonFile uses URL.createObjectURL + an anchor
      // click, which can fail in unusual browser sandboxes. Surface
      // something rather than silently doing nothing.
      this.downloadError.set('Failed to start download.');
      console.warn('replay download failed', err);
    } finally {
      this.downloading.set(false);
    }
  }
}

/**
 * Save `data` as a UTF-8 JSON file named `filename`. Uses the
 * createObjectURL + anchor-click pattern so the save dialog fires
 * client-side (no extra round-trip). The object URL is revoked on the
 * next tick to avoid leaking — browsers GC unreferenced blob URLs
 * eventually, but we clean up deterministically.
 */
function saveJsonFile(filename: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
