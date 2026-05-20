import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Match } from '../../core/match/match.types';
import { MatchService } from '../../core/match/match.service';
import { AuthService } from '../../core/auth/auth.service';
import { ProfileService } from '../../core/profile/profile.service';
import { RouterLink } from '@angular/router';
import { CreateMatchWizardComponent } from '../match/components/create-match-wizard.component';

@Component({
  selector: 'app-lobby',
  standalone: true,
  imports: [CreateMatchWizardComponent, RouterLink],
  template: `
    <main class="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header class="flex items-center justify-between">
        <h1 class="majik-display-2">Lobby</h1>
        <nav class="flex items-center gap-4 text-sm">
          <a routerLink="/decks" class="opacity-80 hover:text-[color:var(--majik-accent)]">Decks</a>
          <span class="opacity-70">{{ profile.handle() ?? auth.principal()?.sub }}</span>
        </nav>
      </header>

      <section class="rounded border border-[color:var(--majik-line)] p-4">
        <h2 class="majik-h3 opacity-60">Public matches</h2>
        @if (loading()) {
          <p class="opacity-60 text-sm">Loading…</p>
        } @else if (error()) {
          <p class="text-red-300/80 text-sm">{{ error() }}</p>
        } @else if (matches().length === 0) {
          <p class="opacity-30 text-sm">— no public matches —</p>
        } @else {
          <ul class="flex flex-col gap-2">
            @for (m of matches(); track m.id) {
              <li class="flex items-center justify-between rounded border border-[color:var(--majik-line)] p-3">
                <div>
                  <div class="font-medium">{{ m.creator.handle }}</div>
                  <div class="text-xs opacity-50">{{ m.format }} · {{ m.clockMinutes }} min · {{ m.creator.deckId }}</div>
                </div>
                <button class="rounded border border-[color:var(--majik-accent)] px-3 py-1 text-[color:var(--majik-accent)] hover:bg-[color:var(--majik-accent)]/10"
                        (click)="open(m)">Open</button>
              </li>
            }
          </ul>
        }
      </section>

      <section class="rounded border border-[color:var(--majik-line)] p-4">
        <h2 class="majik-h3 opacity-60">New match</h2>
        <app-create-match-wizard (create)="onCreate($event)" />
        @if (createError(); as e) { <p class="text-red-300/80 text-xs mt-2">{{ e }}</p> }
      </section>
    </main>
  `,
})
export class LobbyPage implements OnInit {
  private readonly matchSvc = inject(MatchService);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  readonly profile = inject(ProfileService);

  readonly matches = signal<Match[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly createError = signal<string | null>(null);

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    const r = await this.matchSvc.list();
    this.loading.set(false);
    if (!r.ok) { this.error.set(r.error.code); return; }
    this.matches.set(r.value);
  }

  open(m: Match): void {
    this.router.navigate(['/match', m.id]);
  }

  async onCreate(body: import('../../core/match/match.types').CreateMatchRequest): Promise<void> {
    this.createError.set(null);
    const r = await this.matchSvc.create(body);
    if (!r.ok) { this.createError.set(r.error.code); return; }
    this.router.navigate(['/match', r.value.id]);
  }
}
