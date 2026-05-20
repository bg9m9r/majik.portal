import { Injectable, signal } from '@angular/core';

export type ToastSeverity = 'info' | 'error';

export interface Toast {
  message: string;
  severity: ToastSeverity;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _current = signal<Toast | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;
  readonly current = this._current.asReadonly();

  info(message: string): void {
    this.show({ message, severity: 'info' });
  }

  error(message: string): void {
    this.show({ message, severity: 'error' });
  }

  private show(toast: Toast): void {
    if (this.timer) clearTimeout(this.timer);
    this._current.set(toast);
    this.timer = setTimeout(() => this._current.set(null), 3000);
  }
}
