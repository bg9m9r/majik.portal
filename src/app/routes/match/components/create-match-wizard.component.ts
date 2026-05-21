import { Component, computed, effect, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DecksStore } from '../../../core/deck/deck.store';
import { ClockMinutes, CreateMatchRequest, MatchVisibility } from '../../../core/match/match.types';

@Component({
  selector: 'app-create-match-wizard',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <form class="flex flex-col gap-4" (submit)="submit($event)">
      <div class="flex flex-col gap-1 text-sm">
        <span class="majik-micro">Deck</span>
        @if (decks.count() === 0) {
          <p class="text-xs opacity-60">
            No decks yet.
            <a routerLink="/decks/new" class="text-[color:var(--majik-accent)] underline">Build a deck</a>
          </p>
        } @else {
          <select class="rounded border border-[color:var(--majik-line)] bg-black/30 px-3 py-2"
                  [ngModel]="deckId()" (ngModelChange)="deckId.set($event)"
                  name="deckId" required>
            @for (d of decks.all(); track d.id) {
              <option [value]="d.id">{{ d.name }}</option>
            }
          </select>
        }
      </div>

      <div class="flex flex-col gap-1 text-sm">
        <span class="majik-micro">Visibility</span>
        <div class="flex gap-2">
          @for (v of visibilities; track v) {
            <button type="button"
                    class="rounded border px-3 py-1"
                    [class.border-amber-400]="visibility() === v"
                    [class.text-amber-300]="visibility() === v"
                    [class.border-white]="visibility() !== v"
                    [class.text-white]="visibility() !== v"
                    (click)="visibility.set(v)">{{ v }}</button>
          }
        </div>
      </div>

      <div class="flex flex-col gap-1 text-sm">
        <span class="majik-micro">Clock</span>
        <div class="flex gap-2">
          @for (m of clockOptions; track m) {
            <button type="button"
                    class="rounded border px-3 py-1"
                    [class.border-amber-400]="clockMinutes() === m"
                    [class.text-amber-300]="clockMinutes() === m"
                    [class.border-white]="clockMinutes() !== m"
                    [class.text-white]="clockMinutes() !== m"
                    (click)="clockMinutes.set(m)">{{ m }} min</button>
          }
        </div>
      </div>

      <button type="submit"
              class="self-start rounded border border-[color:var(--majik-accent)] px-4 py-2 text-[color:var(--majik-accent)] hover:bg-[color:var(--majik-accent)]/10 disabled:opacity-40"
              [disabled]="!canSubmit()">
        Create match
      </button>
    </form>
  `,
})
export class CreateMatchWizardComponent {
  readonly decks = inject(DecksStore);
  readonly create = output<CreateMatchRequest>();

  readonly visibilities: MatchVisibility[] = ['Public', 'Invite'];
  readonly clockOptions: ClockMinutes[] = [15, 20, 25, 30];

  readonly deckId = signal<string>('');
  readonly visibility = signal<MatchVisibility>('Public');
  readonly clockMinutes = signal<ClockMinutes>(20);

  readonly canSubmit = computed(() => this.deckId().trim().length > 0);

  constructor() {
    // Auto-select first deck when decks load + user hasn't picked one yet.
    // Re-runs only when the decks list changes; manual selection sticks
    // because deckId is no longer blank after the user picks.
    effect(() => {
      const all = this.decks.all();
      if (!this.deckId() && all.length > 0) {
        this.deckId.set(all[0].id);
      }
    });
  }

  submit(evt: Event): void {
    evt.preventDefault();
    if (!this.canSubmit()) return;
    this.create.emit({
      format: 'constructed',
      visibility: this.visibility(),
      deckId: this.deckId(),
      clockMinutes: this.clockMinutes(),
    });
  }
}
