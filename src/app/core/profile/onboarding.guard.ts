import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ProfileService } from './profile.service';

/** Paired with authGuard on protected routes. Redirects to /onboarding
 *  when authed + bootstrap done + no profile. Allows through during
 *  the bootstrap window so the lobby flicker is at most one frame. */
export const onboardingGuard: CanActivateFn = () => {
  const profile = inject(ProfileService);
  const router = inject(Router);

  if (!profile.isReady()) return true;
  if (profile.profile()) return true;
  return router.createUrlTree(['/onboarding']);
};
