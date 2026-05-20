import { Routes } from '@angular/router';
import { canDeactivateDirty } from '../../core/guards/can-deactivate.guard';

export const DECKS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./list/decks-list').then(m => m.DecksListComponent),
  },
  {
    path: 'new',
    loadComponent: () => import('./editor/deck-editor').then(m => m.DeckEditorComponent),
    canDeactivate: [canDeactivateDirty],
  },
  {
    path: ':id',
    loadComponent: () => import('./editor/deck-editor').then(m => m.DeckEditorComponent),
    canDeactivate: [canDeactivateDirty],
  },
];
