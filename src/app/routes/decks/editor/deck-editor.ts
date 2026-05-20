import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CanDeactivateOwner } from '../../../core/guards/can-deactivate.guard';
import { DeckEditorStore } from '../../../core/deck/deck-editor.store';
import { DeckCardEntry } from '../../../core/deck/deck.types';
import { formatDeckArena } from '../../../core/deck/deck-format';
import { ToastService } from '../../../ui/toast.service';
import { CardPoolComponent } from './components/card-pool.component';
import { DeckImportDialogComponent } from './components/deck-import-dialog.component';
import { DeckInfoPanelComponent } from './components/deck-info-panel.component';
import { ZoneEditorComponent } from './components/zone-editor.component';

@Component({
  selector: 'app-deck-editor',
  standalone: true,
  imports: [CardPoolComponent, ZoneEditorComponent, DeckInfoPanelComponent, DeckImportDialogComponent],
  providers: [DeckEditorStore],
  template: `
    <main class="mx-auto flex min-w-[1280px] max-w-[1600px] flex-col gap-4 p-6">
      <header class="flex items-center justify-between">
        <h1 class="majik-display-2">{{ store.id() ? 'Edit deck' : 'New deck' }}</h1>
        <div class="flex gap-2">
          <button type="button"
                  class="rounded border border-[color:var(--majik-line)] px-3 py-1 text-sm hover:border-[color:var(--majik-accent)]"
                  (click)="importOpen.set(true)">Import</button>
          <button type="button"
                  class="rounded border border-[color:var(--majik-line)] px-3 py-1 text-sm hover:border-[color:var(--majik-accent)]"
                  (click)="onExport()">Export</button>
        </div>
      </header>

      <div class="grid grid-cols-[360px_minmax(0,1fr)_320px] gap-6">
        <app-card-pool (add)="store.add($event)" [connectedDropLists]="['zone-drop']" />
        <app-zone-editor />
        <app-deck-info-panel (save)="onSave()" (cancel)="onCancel()" />
      </div>

      @if (importOpen()) {
        <app-deck-import-dialog
          (apply)="onImportApply($event)"
          (cancel)="importOpen.set(false)" />
      }
    </main>
  `,
})
export class DeckEditorComponent implements OnInit, CanDeactivateOwner {
  readonly store = inject(DeckEditorStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly importOpen = signal(false);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.store.loadFor(id);
  }

  onSave(): void {
    this.store.save();
  }

  onCancel(): void {
    if (!this.store.dirty() || confirm('Discard changes?')) {
      this.router.navigate(['/decks']);
    }
  }

  canDeactivate(): boolean {
    return !this.store.dirty();
  }

  onImportApply(payload: { mainboard: DeckCardEntry[]; sideboard: DeckCardEntry[] }): void {
    this.store.replaceContents(payload.mainboard, payload.sideboard);
    this.importOpen.set(false);
    this.toast.info('Imported deck contents.');
  }

  async onExport(): Promise<void> {
    const text = formatDeckArena({
      name: this.store.name(),
      mainboard: this.store.mainboard(),
      sideboard: this.store.sideboard(),
    });
    try {
      await navigator.clipboard.writeText(text);
      this.toast.info('Copied to clipboard');
    } catch {
      this.toast.error('Copy failed — clipboard unavailable');
    }
  }
}
