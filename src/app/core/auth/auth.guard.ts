import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthUserStore } from './auth-user.store';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthUserStore);
  const router = inject(Router);
  if (auth.isAuthenticated()) {
    return true;
  }
  return router.createUrlTree(['/login']);
};
