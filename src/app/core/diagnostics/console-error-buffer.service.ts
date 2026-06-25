import { Injectable } from '@angular/core';

const CAP = 20;

/** Bounded ring buffer of recent client error strings, for report telemetry. */
@Injectable({ providedIn: 'root' })
export class ConsoleErrorBuffer {
  private readonly entries: string[] = [];

  record(message: string): void {
    this.entries.push(`${new Date().toISOString()} ${message}`);
    if (this.entries.length > CAP) this.entries.splice(0, this.entries.length - CAP);
  }

  recent(): readonly string[] {
    return [...this.entries];
  }
}
