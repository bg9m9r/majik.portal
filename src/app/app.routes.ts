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
    path: 'auth/callback',
    loadComponent: () =>
      import('./routes/auth-callback/auth-callback').then(m => m.AuthCallbackPage)
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
    path: 'decks',
    canActivate: [authGuard, onboardingGuard],
    loadChildren: () => import('./routes/decks/decks.routes').then(m => m.DECKS_ROUTES)
  },
  {
    path: 'match/:id',
    canActivate: [authGuard, onboardingGuard],
    loadComponent: () => import('./routes/match/match').then(m => m.MatchPage)
  },
  { path: '**', redirectTo: 'lobby' }
];
