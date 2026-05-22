import { NgClass } from '@angular/common';
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
  imports: [NgClass, CardPoolComponent, ZoneEditorComponent, DeckInfoPanelComponent, DeckImportDialogComponent],
  providers: [DeckEditorStore],
  template: `
    <main class="mx-auto flex min-w-[1024px] max-w-[1600px] flex-col gap-4 p-6">
      <header class="flex items-center justify-between">
        <h1 class="majik-display-2">{{ store.id() ? 'Edit deck' : 'New deck' }}</h1>
        <div class="flex gap-2">
          <button type="button"
                  class="rounded border px-3 py-1 text-sm"
                  [ngClass]="poolOpen()
                    ? 'border-amber-400 text-amber-300'
                    : 'border-[color:var(--majik-line)] hover:border-[color:var(--majik-accent)]'"
                  [attr.aria-pressed]="poolOpen()"
                  data-testid="toggle-card-pool"
                  (click)="poolOpen.set(!poolOpen())">{{ poolOpen() ? 'Close cards' : 'Add cards' }}</button>
          <button type="button"
                  class="rounded border border-[color:var(--majik-line)] px-3 py-1 text-sm hover:border-[color:var(--majik-accent)]"
                  (click)="importOpen.set(true)">Import</button>
          <button type="button"
                  class="rounded border border-[color:var(--majik-line)] px-3 py-1 text-sm hover:border-[color:var(--majik-accent)]"
                  (click)="onExport()">Export</button>
        </div>
      </header>

      <div class="grid grid-cols-[minmax(0,1fr)_320px] gap-6">
        <app-zone-editor />
        <app-deck-info-panel (save)="onSave()" (cancel)="onCancel()" />
      </div>

      @if (poolOpen()) {
        <div class="fixed inset-y-0 left-0 z-40 flex w-[400px] max-w-[80vw] flex-col gap-3 overflow-y-auto border-r border-[color:var(--majik-line)] bg-[color:var(--majik-bg)]/95 p-5 shadow-[var(--shadow-modal)] backdrop-blur"
             role="dialog"
             aria-label="Card pool"
             data-testid="card-pool-drawer">
          <div class="flex items-center justify-between">
            <h2 class="majik-h3 opacity-80">Add cards</h2>
            <button type="button"
                    class="rounded border border-[color:var(--majik-line)] px-2 py-1 text-xs hover:border-[color:var(--majik-accent)]"
                    aria-label="Close card pool"
                    (click)="poolOpen.set(false)">Close</button>
          </div>
          <app-card-pool (add)="store.add($event)" [connectedDropLists]="['zone-drop']" />
        </div>
      }

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
  readonly poolOpen = signal(false);

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
