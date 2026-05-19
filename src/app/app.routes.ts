import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'lobby' },
  {
    path: 'login',
    loadComponent: () => import('./routes/login/login').then(m => m.LoginPage)
  },
  {
    path: 'lobby',
    canActivate: [authGuard],
    loadComponent: () => import('./routes/lobby/lobby').then(m => m.LobbyPage)
  },
  {
    path: 'game/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./routes/game/game').then(m => m.GamePage)
  },
  { path: '**', redirectTo: 'lobby' }
];
