import { Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastComponent } from './ui/toast.component';
import { CardDetailPopoverComponent } from './ui/card-detail-popover.component';
import { NavShellComponent } from './ui/nav-shell.component';
import { DevErrorToastContainerComponent } from './core/dev-error/dev-error-toast-container.component';
import { NotificationsService } from './core/notifications/notifications.service';
import { AuthUserStore } from './core/auth/auth-user.store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastComponent, CardDetailPopoverComponent, NavShellComponent, DevErrorToastContainerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly notifications = inject(NotificationsService);
  private readonly auth = inject(AuthUserStore);

  constructor() {
    // Open the app-wide notifications hub once the user is authenticated, on
    // every route. NotificationsService.start() is idempotent and self-guards
    // until a principal exists, so re-firing this effect is harmless.
    effect(() => {
      if (this.auth.isAuthenticated()) {
        void this.notifications.start();
      }
    });
  }
}
