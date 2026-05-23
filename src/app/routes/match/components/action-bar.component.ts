import { Component, computed, input, output, signal } from '@angular/core';
import { detectKind, PromptKind } from './prompt-overlay.component';

interface PromptSummary {
  expectedKinds?: string[];
  recipientPlayerId?: string;
  description?: string;
}

// How long the "Confirm concede?" hot-window lasts before the button
// snaps back to its idle "Concede" label. Two seconds matches the
// muscle-memory window for a follow-up click without giving the user
// time to forget they armed it.
const CONCEDE_CONFIRM_MS = 2000;

// Window after the user's most recent Pass during which the Undo
// button is interactive. Past this it dims and disables.
const UNDO_WINDOW_MS = 2000;

@Component({
  selector: 'app-action-bar',
  standalone: true,
  template: `
    <div
      class="flex items-center justify-between gap-3 border-t border-white/10 bg-black/40 px-3 py-2"
      role="toolbar"
      aria-label="game actions">
      <div class="text-xs flex items-center gap-3">
        @if (currentPrompt(); as p) {
          <span class="prompt-readout" [attr.data-kind]="kind()">
            <span class="prompt-readout__label">prompt:</span>
            <span class="prompt-readout__text">{{ p.description ?? p.expectedKinds?.join(', ') ?? 'awaiting input' }}</span>
          </span>
        } @else {
          <span class="opacity-50">no active prompt</span>
        }
        <!-- Keyboard hints. Collapsible — the legend lives in
             the bottom-left of the action bar so it stays unobtrusive
             but discoverable for keyboard users. -->
        <details class="kbd-hints">
          <summary class="kbd-hints__summary opacity-60 hover:opacity-100">keys</summary>
          <ul class="kbd-hints__list">
            <li><kbd>Space</kbd> pass</li>
            <li><kbd>Esc</kbd> cancel prompt</li>
            <li><kbd>Enter</kbd> confirm</li>
            <li><kbd>1</kbd>-<kbd>9</kbd> play hand card</li>
          </ul>
        </details>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="action-btn-concede"
          [class.action-btn-concede--confirm]="concedeArmed()"
          (click)="onConcedeClick()">
          {{ concedeArmed() ? 'Confirm concede?' : 'Concede' }}
        </button>
        <button
          type="button"
          class="action-btn-undo"
          [disabled]="!undoEnabled()"
          (click)="onUndoClick()">
          Undo
        </button>
        <button
          type="button"
          class="rounded border border-[color:var(--majik-accent)] px-4 py-1.5 text-sm text-[color:var(--majik-accent)] hover:bg-[color:var(--majik-accent)]/10 disabled:opacity-40"
          [disabled]="!canPass() || submitting()"
          (click)="onPass()">
          {{ submitting() ? 'Passing…' : 'Pass priority' }}
        </button>
      </div>
    </div>
  `
})
export class ActionBarComponent {
  readonly canPass = input<boolean>(false);
  readonly currentPrompt = input<PromptSummary | null>(null);
  readonly submitting = signal(false);
  readonly pass = output<void>();
  readonly concede = output<void>();
  // TODO(undo): wire up to a real engine-side undo once the server
  // exposes a CancelPass / Undo command. Today this is a UI stub — the
  // parent (match.ts) is expected to log/observe and decide what (if
  // anything) to do on the wire.
  readonly undoRequested = output<void>();

  // Concede flow: first click arms a 2s confirmation window; second
  // click within that window fires `concede`. Outside the window the
  // button reverts and a fresh click re-arms. Window timer is held in
  // a ref so a re-click before the deadline is cheap to reset.
  readonly concedeArmed = signal(false);
  private concedeTimer: ReturnType<typeof setTimeout> | null = null;

  // Undo button is enabled only while we're inside the post-pass hot
  // window. Drive it off a wall-clock tick signal so the disabled
  // state recomputes without a setInterval per render.
  private readonly lastPassAt = signal<number | null>(null);
  private readonly now = signal<number>(Date.now());
  private undoTickTimer: ReturnType<typeof setTimeout> | null = null;

  readonly undoEnabled = computed<boolean>(() => {
    if (this.submitting()) return true; // abort window is always live
    const t = this.lastPassAt();
    if (t == null) return false;
    return this.now() - t < UNDO_WINDOW_MS;
  });

  // Echo the prompt-overlay color cue down to the action bar so the
  // bar carries the same kind signal even when the overlay isn't
  // mounted (e.g. waiting on opponent's combat declaration).
  readonly kind = computed<PromptKind>(() =>
    detectKind(this.currentPrompt()?.expectedKinds));

  async onPass(): Promise<void> {
    this.submitting.set(true);
    this.lastPassAt.set(Date.now());
    this.armUndoTick();
    try {
      this.pass.emit();
    } finally {
      this.submitting.set(false);
    }
  }

  onConcedeClick(): void {
    if (this.concedeArmed()) {
      // Confirmed — fire upstream and reset.
      if (this.concedeTimer) clearTimeout(this.concedeTimer);
      this.concedeTimer = null;
      this.concedeArmed.set(false);
      this.concede.emit();
      return;
    }
    // Arm the confirmation window.
    this.concedeArmed.set(true);
    if (this.concedeTimer) clearTimeout(this.concedeTimer);
    this.concedeTimer = setTimeout(() => {
      this.concedeArmed.set(false);
      this.concedeTimer = null;
    }, CONCEDE_CONFIRM_MS);
  }

  onUndoClick(): void {
    if (!this.undoEnabled()) return;
    // Close the local window immediately — second emission would be
    // confusing UX, and the parent decides what to actually do.
    this.lastPassAt.set(null);
    this.undoRequested.emit();
  }

  // Keep `now()` ticking while the undo window is open so the
  // computed `undoEnabled` flips false at the right moment. We stop
  // the tick once the window has elapsed to avoid a background timer
  // bleeding across the entire match.
  private armUndoTick(): void {
    if (this.undoTickTimer) clearTimeout(this.undoTickTimer);
    const tick = (): void => {
      this.now.set(Date.now());
      const t = this.lastPassAt();
      if (t == null) {
        this.undoTickTimer = null;
        return;
      }
      if (Date.now() - t >= UNDO_WINDOW_MS) {
        this.undoTickTimer = null;
        // Trigger one last recompute so the button visibly dims.
        this.now.set(Date.now());
        return;
      }
      this.undoTickTimer = setTimeout(tick, 100);
    };
    this.undoTickTimer = setTimeout(tick, 100);
  }
}
