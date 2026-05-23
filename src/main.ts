import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { applyDevToastUrlParam } from './app/core/dev-error/dev-error-toast.service';

// `?devToast=on|off` flips the localStorage flag at boot so the user can
// toggle verbose error popups from a bookmarklet / URL without a redeploy.
// We strip the param + reload so the URL stays clean and the new flag is
// picked up by the service's constructor on the next pass.
if (applyDevToastUrlParam()) {
  const url = new URL(window.location.href);
  url.searchParams.delete('devToast');
  window.history.replaceState({}, '', url.toString());
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
