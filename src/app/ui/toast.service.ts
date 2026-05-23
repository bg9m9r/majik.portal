import { Injectable, signal } from '@angular/core';

export type ToastSeverity = 'info' | 'warn' | 'error';

export interface Toast {
  message: string;
  severity: ToastSeverity;
}

export interface ToastOptions {
  severity?: ToastSeverity;
  /** Auto-dismiss delay in ms. Defaults to 3000. */
  durationMs?: number;
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
    const duration = options.durationMs ?? 3000;
    if (this.timer) clearTimeout(this.timer);
    this._current.set({ message, severity });
    this.timer = setTimeout(() => this._current.set(null), duration);
  }
}
