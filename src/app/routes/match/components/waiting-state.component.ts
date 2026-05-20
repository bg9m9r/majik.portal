import { Component, input } from '@angular/core';
import { Match } from '../../../core/match/match.types';

@Component({
  selector: 'app-waiting-state',
  standalone: true,
  template: `
    <div class="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <h2 class="majik-h3">Waiting for opponent</h2>

      <div class="flex flex-col gap-2 rounded border border-[color:var(--majik-line)] p-4">
        <div class="text-xs opacity-60">Share this link</div>
        <code class="majik-code break-all text-[color:var(--majik-accent)]">{{ shareUrl() }}</code>
      </div>

      <dl class="flex flex-col gap-2 text-sm">
        <div class="flex items-center justify-between">
          <dt class="opacity-60">Format</dt>
          <dd class="majik-mono">{{ match().format }}</dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="opacity-60">Clock</dt>
          <dd class="majik-mono">{{ match().clockMinutes }} min</dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="opacity-60">Visibility</dt>
          <dd class="majik-mono">{{ match().visibility }}</dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="opacity-60">Creator</dt>
          <dd class="majik-mono">{{ match().creator.handle }}</dd>
        </div>
      </dl>
    </div>
  `,
})
export class WaitingStateComponent {
  readonly match = input.required<Match>();

  shareUrl(): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/match/${this.match().id}`;
  }
}
