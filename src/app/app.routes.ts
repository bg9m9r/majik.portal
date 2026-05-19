import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { onboardingGuard } from './core/profile/onboarding.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'lobby' },
  {
    path: 'login',
    loadComponent: () => import('./routes/login/login').then(m => m.LoginPage)
  },
  {
    path: 'onboarding',
    canActivate: [authGuard],
    loadComponent: () => import('./routes/onboarding/onboarding').then(m => m.OnboardingPage)
  },
  {
    path: 'lobby',
    canActivate: [authGuard, onboardingGuard],
    loadComponent: () => import('./routes/lobby/lobby').then(m => m.LobbyPage)
  },
  {
    path: 'game/:id',
    canActivate: [authGuard, onboardingGuard],
    loadComponent: () => import('./routes/game/game').then(m => m.GamePage)
  },
  { path: '**', redirectTo: 'lobby' }
];
