import { CanDeactivateFn } from '@angular/router';

export interface CanDeactivateOwner {
  canDeactivate(): boolean;
}

export const canDeactivateDirty: CanDeactivateFn<CanDeactivateOwner> = (cmp) => {
  if (!cmp || cmp.canDeactivate()) return true;
  return confirm('You have unsaved changes. Leave anyway?');
};
