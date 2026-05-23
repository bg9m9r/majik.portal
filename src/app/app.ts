import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastComponent } from './ui/toast.component';
import { CardDetailPopoverComponent } from './ui/card-detail-popover.component';
import { NavShellComponent } from './ui/nav-shell.component';
import { DevErrorToastContainerComponent } from './core/dev-error/dev-error-toast-container.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastComponent, CardDetailPopoverComponent, NavShellComponent, DevErrorToastContainerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {}
