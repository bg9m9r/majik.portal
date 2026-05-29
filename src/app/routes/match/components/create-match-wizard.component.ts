import { Component, computed, effect, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BotArchetypeDto } from '../../../core/api';
import { DecksStore } from '../../../core/deck/deck.store';
import { MatchService } from '../../../core/match/match.service';
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

      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" name="vsBot"
               [checked]="vsBot()" (change)="vsBot.set($any($event.target).checked)" />
        <span>Play vs Bot</span>
      </label>
      @if (vsBot()) {
        <div class="flex flex-col gap-1 text-sm">
          <span class="majik-micro">Bot archetype</span>
          <select name="botArchetype" class="rounded border border-[color:var(--majik-line)] bg-black/30 px-3 py-2"
                  [ngModel]="botArchetype()" (ngModelChange)="botArchetype.set($event)">
            @for (a of botArchetypes(); track a.key) {
              <option [value]="a.key">{{ a.label }}</option>
            }
          </select>
        </div>
      }

      @if (!vsBot()) {
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
      }

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
        {{ vsBot() ? 'Play vs Bot' : 'Create match' }}
      </button>
    </form>
  `,
})
export class CreateMatchWizardComponent {
  readonly decks = inject(DecksStore);
  private readonly matches = inject(MatchService);
  readonly create = output<CreateMatchRequest>();

  readonly visibilities: MatchVisibility[] = ['Public', 'Invite'];
  readonly clockOptions: ClockMinutes[] = [15, 20, 25, 30];

  readonly deckId = signal<string>('');
  readonly visibility = signal<MatchVisibility>('Public');
  readonly clockMinutes = signal<ClockMinutes>(20);
  readonly vsBot = signal(false);
  readonly botArchetype = signal<string>('Burn');
  // Populated from GET /matches/archetypes on init (key + spaced label).
  // Seeded with a minimal fallback so the dropdown is never empty if the
  // request is in flight or fails.
  readonly botArchetypes = signal<BotArchetypeDto[]>([
    { key: 'Burn', label: 'Burn' },
  ]);

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

    // Load the full archetype list (with spaced labels) from the server.
    // Keeps the dropdown in sync with BotDeckCatalog; on failure we keep
    // the fallback so the form still works.
    void this.loadArchetypes();
  }

  private async loadArchetypes(): Promise<void> {
    const res = await this.matches.listBotArchetypes();
    if (res.ok && res.value.length > 0) {
      this.botArchetypes.set(res.value);
      if (!res.value.some(a => a.key === this.botArchetype())) {
        this.botArchetype.set(res.value[0].key);
      }
    }
  }

  submit(evt: Event): void {
    evt.preventDefault();
    if (!this.canSubmit()) return;
    const bot = this.vsBot();
    this.create.emit({
      format: 'constructed',
      visibility: bot ? 'Invite' : this.visibility(),
      deckId: this.deckId(),
      clockMinutes: this.clockMinutes(),
      ...(bot ? { botOpponent: { archetype: this.botArchetype() } } : {}),
    });
  }
}
