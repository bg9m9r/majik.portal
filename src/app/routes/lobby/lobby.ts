import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../../core/api/api';
import { healthCheck } from '../../core/api/fn/meta/health-check';
import { createGame } from '../../core/api/fn/games/create-game';
import { AuthService } from '../../core/auth/auth.service';
import { ProfileService } from '../../core/profile/profile.service';

type HealthStatus = 'idle' | 'checking' | 'ok' | 'down';

@Component({
  selector: 'app-lobby',
  standalone: true,
  imports: [FormsModule],
  template: `
    <main class="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header class="flex items-center justify-between">
        <h1 class="majik-display-2">Lobby</h1>
        <span class="text-sm opacity-70">{{ profile.handle() ?? auth.principal()?.sub }}</span>
      </header>

      <section class="rounded border border-white/10 p-4">
        <div class="flex items-center justify-between">
          <h2 class="text-sm uppercase tracking-wider opacity-60">Server</h2>
          <span
            class="rounded px-2 py-0.5 text-xs"
            [class.bg-emerald-700]="health() === 'ok'"
            [class.bg-amber-700]="health() === 'checking' || health() === 'idle'"
            [class.bg-red-800]="health() === 'down'">
            {{ healthLabel() }}
          </span>
        </div>
        @if (healthError()) {
          <p class="mt-2 text-xs text-red-300/80">{{ healthError() }}</p>
        }
      </section>

      <section class="rounded border border-white/10 p-4">
        <h2 class="mb-3 text-sm uppercase tracking-wider opacity-60">New game</h2>
        <form class="flex flex-col gap-3" (submit)="onCreate($event)">
          <label class="flex flex-col gap-1 text-sm">
            <span class="opacity-70">Alice</span>
            <input
              class="rounded border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-[color:var(--majik-accent)]"
              name="aliceName"
              [(ngModel)]="aliceName"
              required />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span class="opacity-70">Bob</span>
            <input
              class="rounded border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-[color:var(--majik-accent)]"
              name="bobName"
              [(ngModel)]="bobName"
              required />
          </label>
          <div class="flex items-center gap-3">
            <button
              type="submit"
              class="rounded border border-[color:var(--majik-accent)] px-4 py-2 text-[color:var(--majik-accent)] hover:bg-[color:var(--majik-accent)]/10 disabled:opacity-40"
              [disabled]="creating()">
              {{ creating() ? 'Creating…' : 'Create game' }}
            </button>
            @if (createError()) {
              <span class="text-xs text-red-300/80">{{ createError() }}</span>
            }
          </div>
        </form>
      </section>
    </main>
  `
})
export class LobbyPage implements OnInit {
  readonly auth = inject(AuthService);
  readonly profile = inject(ProfileService);
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  readonly health = signal<HealthStatus>('idle');
  readonly healthError = signal<string | null>(null);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);

  aliceName = 'Alice';
  bobName = 'Bob';

  ngOnInit(): void {
    this.checkHealth();
  }

  healthLabel(): string {
    switch (this.health()) {
      case 'ok': return 'reachable';
      case 'checking': return 'checking…';
      case 'down': return 'unreachable';
      default: return 'idle';
    }
  }

  async checkHealth(): Promise<void> {
    this.health.set('checking');
    this.healthError.set(null);
    try {
      const resp = await this.api.invoke$Response(healthCheck);
      this.health.set(resp.ok ? 'ok' : 'down');
    } catch (err: unknown) {
      this.health.set('down');
      this.healthError.set(err instanceof Error ? err.message : String(err));
    }
  }

  async onCreate(evt: Event): Promise<void> {
    evt.preventDefault();
    if (!this.aliceName.trim() || !this.bobName.trim()) {
      return;
    }
    this.creating.set(true);
    this.createError.set(null);
    try {
      const res = await this.api.invoke(createGame, {
        body: { aliceName: this.aliceName.trim(), bobName: this.bobName.trim() }
      });
      this.router.navigate(['/game', res.gameId]);
    } catch (err: unknown) {
      this.createError.set(stringifyHttpError(err));
    } finally {
      this.creating.set(false);
    }
  }
}

function stringifyHttpError(err: unknown): string {
  if (!err) return 'unknown error';
  const e = err as { status?: number; statusText?: string; message?: string; error?: unknown };
  if (typeof e.status === 'number') {
    const detail = typeof e.error === 'string' ? e.error : JSON.stringify(e.error ?? '');
    return `HTTP ${e.status} ${e.statusText ?? ''} ${detail}`.trim();
  }
  return e.message ?? String(err);
}
