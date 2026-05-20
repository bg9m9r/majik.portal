import { Component, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClockMinutes, CreateMatchRequest, MatchVisibility } from '../../../core/match/match.types';

@Component({
  selector: 'app-create-match-wizard',
  standalone: true,
  imports: [FormsModule],
  template: `
    <form class="flex flex-col gap-4" (submit)="submit($event)">
      <label class="flex flex-col gap-1 text-sm">
        <span class="majik-micro">Deck</span>
        <input class="rounded border border-[color:var(--majik-line)] bg-black/30 px-3 py-2"
               [(ngModel)]="deckId" name="deckId" placeholder="e.g. starter-burn" required />
      </label>
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
              class="self-start rounded border border-[color:var(--majik-accent)] px-4 py-2 text-[color:var(--majik-accent)] hover:bg-[color:var(--majik-accent)]/10">
        Create match
      </button>
    </form>
  `,
})
export class CreateMatchWizardComponent {
  readonly create = output<CreateMatchRequest>();

  readonly visibilities: MatchVisibility[] = ['Public', 'Invite'];
  readonly clockOptions: ClockMinutes[] = [15, 20, 25, 30];

  deckId = '';
  readonly visibility = signal<MatchVisibility>('Public');
  readonly clockMinutes = signal<ClockMinutes>(20);

  submit(evt: Event): void {
    evt.preventDefault();
    if (!this.deckId.trim()) return;
    this.create.emit({
      format: 'constructed',
      visibility: this.visibility(),
      deckId: this.deckId.trim(),
      clockMinutes: this.clockMinutes(),
    });
  }
}
