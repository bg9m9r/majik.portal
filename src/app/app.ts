import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastComponent } from './ui/toast.component';
import { CardDetailPopoverComponent } from './ui/card-detail-popover.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastComponent, CardDetailPopoverComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {}
