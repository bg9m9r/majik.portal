import { Injectable, signal } from '@angular/core';

export type ToastSeverity = 'info' | 'warn' | 'error';

/** An inline action button rendered on a toast (e.g. "Reload"). */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  message: string;
  severity: ToastSeverity;
  action?: ToastAction;
}

export interface ToastOptions {
  severity?: ToastSeverity;
  /** Auto-dismiss delay in ms. Defaults to 3000. */
  durationMs?: number;
  /** When true the toast does NOT auto-dismiss; it stays until dismissed. */
  sticky?: boolean;
  /** Optional inline action button (label + handler). */
  action?: ToastAction;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _current = signal<Toast | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;
  readonly current = this._current.asReadonly();

  info(message: string): void {
    this.show(message, { severity: 'info' });
  }

  warn(message: string): void {
    this.show(message, { severity: 'warn' });
  }

  error(message: string): void {
    this.show(message, { severity: 'error' });
  }

  /**
   * Display a transient toast. Accepts either a plain string (info,
   * default 3000ms) or a string + options bag with a `severity` and an
   * explicit `durationMs`. Used by the match page for bot-decision
   * highlights (info, 3500ms) without needing dedicated wrapper methods.
   */
  show(message: string, options: ToastOptions = {}): void {
    const severity = options.severity ?? 'info';
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this._current.set({ message, severity, action: options.action });
    // A sticky toast persists until dismissed (or replaced) — it does not
    // schedule an auto-dismiss timer. Used for the fix-live "Reload" toast.
    if (!options.sticky) {
      const duration = options.durationMs ?? 3000;
      this.timer = setTimeout(() => this._current.set(null), duration);
    }
  }

  /** Clear the current toast (and cancel any pending auto-dismiss timer). */
  dismiss(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this._current.set(null);
  }
}
