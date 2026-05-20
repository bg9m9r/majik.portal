import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CanDeactivateOwner } from '../../../core/guards/can-deactivate.guard';
import { DeckEditorStore } from '../../../core/deck/deck-editor.store';
import { CardPoolComponent } from './components/card-pool.component';
import { DeckInfoPanelComponent } from './components/deck-info-panel.component';
import { ZoneEditorComponent } from './components/zone-editor.component';

@Component({
  selector: 'app-deck-editor',
  standalone: true,
  imports: [CardPoolComponent, ZoneEditorComponent, DeckInfoPanelComponent],
  providers: [DeckEditorStore],
  template: `
    <main class="mx-auto grid min-w-[1280px] max-w-[1600px] grid-cols-[360px_minmax(0,1fr)_320px] gap-6 p-6">
      <app-card-pool (add)="store.add($event)" [connectedDropLists]="['zone-drop']" />
      <app-zone-editor />
      <app-deck-info-panel (save)="onSave()" (cancel)="onCancel()" />
    </main>
  `,
})
export class DeckEditorComponent implements OnInit, CanDeactivateOwner {
  readonly store = inject(DeckEditorStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

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
}
