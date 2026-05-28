import { Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Match, CreateMatchRequest } from '../../core/match/match.types';
import { LobbyStore } from '../../core/lobby/lobby.store';
import { CreateMatchWizardComponent } from '../match/components/create-match-wizard.component';

@Component({
  selector: 'app-lobby',
  standalone: true,
  imports: [CreateMatchWizardComponent],
  template: `
    <main class="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header class="flex items-center justify-between">
        <h1 class="majik-display-2">Lobby</h1>
      </header>

      <section class="rounded border border-[color:var(--majik-line)] p-4">
        <h2 class="majik-h3 opacity-60">Public matches</h2>
        @if (store.loading()) {
          <p class="opacity-60 text-sm">Loading…</p>
        } @else if (store.error()) {
          <div class="flex flex-col gap-2">
            <p class="text-red-300/80 text-sm">Couldn’t load matches.</p>
            <button type="button"
                    class="self-start rounded border border-[color:var(--majik-line)] px-2 py-1 text-xs hover:border-[color:var(--majik-accent)]"
                    (click)="store.load()">Retry</button>
          </div>
        } @else if (store.matches().length === 0) {
          <p class="opacity-30 text-sm">— no public matches —</p>
        } @else {
          <ul class="flex flex-col gap-2">
            @for (m of store.matches(); track m.id) {
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
        @if (store.createError(); as e) { <p class="text-red-300/80 text-xs mt-2">{{ e.code }}</p> }
      </section>
    </main>
  `,
})
export class LobbyPage {
  readonly store = inject(LobbyStore);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const id = this.store.createdMatchId();
      if (id) {
        this.router.navigate(['/match', id]);
        this.store.clearCreatedMatchId();
      }
    });
  }

  open(m: Match): void {
    this.router.navigate(['/match', m.id]);
  }

  onCreate(body: CreateMatchRequest): void {
    this.store.create(body);
  }
}
